// Shared "unlock" flow used by every page that needs score-entry or
// admin access. See the big comment at the top of firestore.rules for
// the full design — this file is the client half of that pattern.
//
// The short version: every visitor gets signed in anonymously (so
// Firestore can tell "this browser" apart from others), then the app
// asks once for a code. We try to WRITE that code to a document only
// this browser can read (/unlocks/{our-uid}). Firestore's rules check
// the code server-side against the real secret and either accept the
// write (code was right) or reject it (code was wrong) — we never get
// to see the real code either way.

import { auth, db } from "./firebase-init.js";
import {
  signInAnonymously,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js";
import {
  doc,
  setDoc,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";

// localStorage key we use to remember "this browser already unlocked
// at level X" so we don't have to show the code prompt on every single
// page load. This is purely a UI convenience, NOT a security boundary
// — someone could edit it by hand to fake a higher level, but any
// actual write they try to make would still be rejected by Firestore's
// rules (which check the real /unlocks/{uid} doc, not localStorage).
const STORAGE_KEY = "rydercup_unlock_level";

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

// 'admin' unlocks everything 'score' does (see firestore.rules), so a
// page that only needs 'score' should also accept an 'admin' unlock.
function levelSatisfies(cachedLevel, requiredLevel) {
  if (cachedLevel === "admin") return true;
  return cachedLevel === requiredLevel;
}

// Tries to unlock at the given level with the given code. Resolves to
// true/false — true means Firestore accepted the code as correct.
async function attemptUnlock(level, code) {
  const user = await ensureSignedIn();
  try {
    await setDoc(doc(db, "unlocks", user.uid), { level, code });
    localStorage.setItem(STORAGE_KEY, level);
    return true;
  } catch (err) {
    // A wrong code makes Firestore reject the write with
    // 'permission-denied' — that's the expected failure case, not a
    // real error, so we just report "wrong code" rather than throwing.
    if (err.code === "permission-denied") return false;
    throw err;
  }
}

// The main thing pages call. Give it a container element, the level
// the page requires ('score' or 'admin'), and a callback to run once
// unlocked (called immediately if we're already unlocked from a past
// visit). It injects a small code-entry form when locked, and a
// "switch code" link when already unlocked.
//
// Usage from a page:
//   import { renderUnlockBar } from './js/auth.js';
//   renderUnlockBar(document.getElementById('unlock'), 'score', () => {
//     // show/enable the score-entry form here
//   });
export function renderUnlockBar(container, requiredLevel, onUnlocked) {
  const cached = getCachedLevel();

  if (levelSatisfies(cached, requiredLevel)) {
    container.innerHTML = `
      <div class="unlock-bar">
        <span class="status-msg ok">Unlocked (${cached})</span>
        <button class="secondary" type="button" id="unlock-switch">Use a different code</button>
      </div>
    `;
    container
      .querySelector("#unlock-switch")
      .addEventListener("click", () => {
        localStorage.removeItem(STORAGE_KEY);
        renderUnlockBar(container, requiredLevel, onUnlocked);
      });
    onUnlocked();
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

    const ok = await attemptUnlock(requiredLevel, code);

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
