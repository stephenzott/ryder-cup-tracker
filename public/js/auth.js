// Shared "unlock" flow used by every page that needs score-entry or
// admin access. See the big comment at the top of firestore.rules for
// the full design — this file is the client half of that pattern.
//
// The short version: every visitor gets signed in anonymously (so
// Firestore can tell "this browser" apart from others). Then:
//   - For score entry, the app asks "Who are you?" and the visitor
//     picks their own name off the roster -- no code to type or
//     forget. That picked player ID is what firestore.rules checks
//     against a match's sideA/sideB to decide which matches THIS
//     browser can actually enter scores for.
//   - For admin actions (pairings, roster), it's still a shared code,
//     since those are rare enough that sharing one code isn't the
//     friction point the score code was.
// Either way, the attempt gets WRITTEN to a document only this browser
// can read (/unlocks/{our-uid}), and Firestore's rules decide server-
// side whether to accept it -- we never get to see the real admin code
// either way.

import { auth, db } from "./firebase-init.js";
import {
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js";
import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";

// localStorage keys we use to remember "this browser already unlocked
// at level X (as player Y)" so we don't have to show the unlock prompt
// on every single page load. This is purely a UI convenience, NOT a
// security boundary — someone could edit it by hand to fake a higher
// level or a different player, but any actual write they try to make
// would still be rejected by Firestore's rules (which check the real
// /unlocks/{uid} doc, not localStorage).
const STORAGE_KEY = "rydercup_unlock_level";
const PLAYER_ID_STORAGE_KEY = "rydercup_unlock_player_id";
const PLAYER_NAME_STORAGE_KEY = "rydercup_unlock_player_name";

// Firebase's anonymous sign-in is asynchronous and only needs to
// happen once per browser session. We keep a single shared promise so
// every caller on the page waits for the same sign-in instead of each
// kicking off their own.
let signInPromise = null;

function ensureSignedIn() {
  if (!signInPromise) {
    signInPromise = new Promise((resolve, reject) => {
      // onAuthStateChanged fires once immediately with whatever the
      // current state is, then again any time it changes. If nobody's
      // signed in yet, we kick off an anonymous sign-in; once Firebase
      // confirms it, this fires again with the real user.
      const unsubscribe = onAuthStateChanged(auth, (user) => {
        if (user) {
          unsubscribe();
          resolve(user);
        } else {
          signInAnonymously(auth).catch(reject);
        }
      }, reject);
    });
  }
  return signInPromise;
}

// Returns the cached unlock level ('score', 'admin') or null. See the
// localStorage caveat above — this is only ever used to decide what
// the UI shows, never trusted for an actual write.
function getCachedLevel() {
  return localStorage.getItem(STORAGE_KEY);
}

// Exposed for pages that need to tell "score" and "admin" apart in
// their own UI (e.g. a round page showing admin-only pairing controls
// alongside score-entry controls everyone can use) rather than just
// asking "am I unlocked enough for X." Same localStorage-only caveat
// as everywhere else in this file -- real enforcement is server-side.
export function getUnlockLevel() {
  return getCachedLevel();
}

// Which roster player this browser picked on the "Who are you?"
// screen, or null (e.g. an admin-only browser never picked one). Lets
// a page grey out score entry for matches this player isn't actually
// in -- real enforcement of that is server-side in firestore.rules
// (which checks the /unlocks/{uid} doc directly), this is only so the
// page's buttons look locked instead of failing silently on Save.
export function getUnlockPlayerId() {
  return localStorage.getItem(PLAYER_ID_STORAGE_KEY);
}

// 'admin' unlocks everything 'score' does (see firestore.rules), so a
// page that only needs 'score' should also accept an 'admin' unlock.
function levelSatisfies(cachedLevel, requiredLevel) {
  if (cachedLevel === "admin") return true;
  return cachedLevel === requiredLevel;
}

// Tries to unlock at the given level. `extra` carries whatever else
// that level's write needs -- { code } for the admin code-entry form,
// or { playerId, playerName } for the score level's "Who are you?"
// picker. Resolves to true/false -- true means Firestore accepted the
// write (for 'score' that's just picking a real roster player; for
// 'admin' it's still a real code check, see firestore.rules).
async function attemptUnlock(level, extra) {
  const user = await ensureSignedIn();
  try {
    await setDoc(doc(db, "unlocks", user.uid), { level, ...extra });
    localStorage.setItem(STORAGE_KEY, level);
    if (extra.playerId) localStorage.setItem(PLAYER_ID_STORAGE_KEY, extra.playerId);
    if (extra.playerName) localStorage.setItem(PLAYER_NAME_STORAGE_KEY, extra.playerName);
    return true;
  } catch (err) {
    // A wrong code makes Firestore reject the write with
    // 'permission-denied' — that's the expected failure case, not a
    // real error, so we just report "wrong code" rather than throwing.
    if (err.code === "permission-denied") return false;
    throw err;
  }
}

// Basic escaping so a player name can never inject HTML into the page
// -- same reasoning/pattern as roster.js's helper of the same name.
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// One-time read of the roster for the "Who are you?" picker -- not a
// live subscription, since this list only needs to be fresh at the
// moment someone's picking their name, not kept in sync afterward.
async function fetchPlayerOptions() {
  const snapshot = await getDocs(query(collection(db, "players"), orderBy("name")));
  return snapshot.docs.map((d) => ({ id: d.id, name: d.data().name }));
}

// The main thing pages call. Give it a container element, the level
// the page requires ('score' or 'admin'), and a callback to run once
// unlocked (called immediately if we're already unlocked from a past
// visit). For 'score' it injects a "Who are you?" picker of real
// roster names (no code to type or remember); for 'admin' it's still
// the old shared code-entry form, since pairing/roster changes are
// rare enough that sharing one code isn't the friction point. Also
// renders a "switch" link once already unlocked.
//
// Usage from a page:
//   import { renderUnlockBar } from './js/auth.js';
//   renderUnlockBar(document.getElementById('unlock'), 'score', () => {
//     // show/enable the score-entry form here
//   });
export function renderUnlockBar(container, requiredLevel, onUnlocked) {
  const cached = getCachedLevel();

  if (levelSatisfies(cached, requiredLevel)) {
    const cachedName = localStorage.getItem(PLAYER_NAME_STORAGE_KEY);
    const statusText =
      cached === "score" && cachedName ? `Unlocked as ${escapeHtml(cachedName)} (score)` : `Unlocked (${cached})`;
    const switchLabel = cached === "score" ? "Not you? Switch" : "Use a different code";

    container.innerHTML = `
      <div class="unlock-bar">
        <span class="status-msg ok">${statusText}</span>
        <button class="secondary" type="button" id="unlock-switch">${switchLabel}</button>
      </div>
    `;
    container
      .querySelector("#unlock-switch")
      .addEventListener("click", () => {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(PLAYER_ID_STORAGE_KEY);
        localStorage.removeItem(PLAYER_NAME_STORAGE_KEY);
        renderUnlockBar(container, requiredLevel, onUnlocked);
      });
    onUnlocked();
    return;
  }

  if (requiredLevel === "score") {
    container.innerHTML = `
      <div class="unlock-bar">
        <select id="unlock-player">
          <option value="">Who are you?</option>
        </select>
        <span class="status-msg" id="unlock-status"></span>
      </div>
    `;

    const select = container.querySelector("#unlock-player");
    const status = container.querySelector("#unlock-status");

    fetchPlayerOptions().then((players) => {
      select.innerHTML =
        `<option value="">Who are you?</option>` +
        players.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
    });

    select.addEventListener("change", async () => {
      const playerId = select.value;
      if (!playerId) return;
      const playerName = select.options[select.selectedIndex].textContent;
      select.disabled = true;
      status.textContent = "Checking…";
      status.className = "status-msg";

      const ok = await attemptUnlock("score", { playerId, playerName });

      select.disabled = false;
      if (ok) {
        renderUnlockBar(container, requiredLevel, onUnlocked);
      } else {
        status.textContent = "Something went wrong — try again";
        status.className = "status-msg error";
      }
    });
    return;
  }

  container.innerHTML = `
    <div class="unlock-bar">
      <input type="password" inputmode="text" id="unlock-code" placeholder="Enter code" />
      <button type="button" id="unlock-submit">Unlock</button>
      <span class="status-msg" id="unlock-status"></span>
    </div>
  `;

  const input = container.querySelector("#unlock-code");
  const status = container.querySelector("#unlock-status");
  const submit = container.querySelector("#unlock-submit");

  async function trySubmit() {
    const code = input.value.trim();
    if (!code) return;
    submit.disabled = true;
    status.textContent = "Checking…";
    status.className = "status-msg";

    const ok = await attemptUnlock(requiredLevel, { code });

    submit.disabled = false;
    if (ok) {
      renderUnlockBar(container, requiredLevel, onUnlocked);
    } else {
      status.textContent = "Wrong code";
      status.className = "status-msg error";
    }
  }

  submit.addEventListener("click", trySubmit);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") trySubmit();
  });
}
