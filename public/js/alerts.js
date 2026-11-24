// Logic for alerts.html: this phone's push-notification settings.
//
// What it does, top to bottom:
//   1. Checks whether this device CAN get alerts (an iPhone must open
//      the site from its Home Screen icon; some browsers lack push).
//   2. "Who are you?": which roster player this phone belongs to, so
//      the server can work out "my team" when it sends.
//   3. The master switch: asks for notification permission, registers
//      the service worker (firebase-messaging-sw.js), gets this phone's
//      push "token" from Firebase Cloud Messaging (FCM), and saves it.
//   4/5. Level and Scope radios, saved as soon as they change.
//   Plus: Android install/tips cards, and a "Check my setup" card shown
//   only at alerts.html?debug.
//
// Where it's saved: ONE Firestore document per browser,
//   pushSubscriptions/{uid}  (uid = this browser's anonymous sign-in)
//   { enabled, token, playerId, level, scope, platform, installed, updatedAt }
// The team is deliberately NOT stored: the server looks up the
// player's current team each time it sends, so when the admin changes
// teams, alerts follow automatically.
//
// WHAT A "TOKEN" IS: a long random string FCM hands this particular
// browser. Our server (stage 2) gives FCM a token plus a message, and
// FCM delivers it to that browser. No token = no way to reach the phone,
// which is why switching alerts off deletes it.

import { db, auth } from "./firebase-init.js";
import { ensureSignedIn, getUnlockPlayerId } from "./auth.js";
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { connectAuthEmulator } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js";
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported as messagingIsSupported,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-messaging.js";
import { teamKey, teamName, teamPillHtml } from "./match-ui.js";
// Device/browser questions (iPhone? installed? which browser? inside
// Instagram's built-in browser?), kept in their own file.
import {
  browserFamily,
  isAndroid,
  isBrave,
  isInAppBrowser,
  isIOS,
  isStandalone,
  platformKey,
} from "./platform.js";

// ==================================================================
// TODO (you, once): paste the Web Push certificate PUBLIC key here.
//
// Where to get it: Firebase console → your project (golf-tracker-data)
//   → gear icon ⚙ (top left) → Project settings → "Cloud Messaging" tab
//   → scroll to "Web configuration" → "Web Push certificates"
//   → "Generate key pair" (or copy the existing one).
// Direct link: https://console.firebase.google.com/project/golf-tracker-data/settings/cloudmessaging
//
// Copy the long "Key pair" string (starts with "B", ~88 characters).
// It's a PUBLIC key, safe to have in the website's source, like the
// Firebase config. Until it's filled in, the master switch explains
// that alerts aren't set up yet instead of turning on.
// ==================================================================
const VAPID_PUBLIC_KEY = "BBwg72f4Vh80d1L16gt5BfbSdZtzb8pFHiyLX95GjKr_-grgTwWXpiPccvzaCGt8TtoNQlICGtrd7mlJCOwkHkE";
const VAPID_KEY_IS_SET = !VAPID_PUBLIC_KEY.startsWith("PASTE_");

// ------------------------------------------------------------------
// Local testing only: when the page is opened from this computer
// (the Firebase emulator at 127.0.0.1 / localhost), point Firestore
// and Auth at the local emulators so testing NEVER writes to the live
// database. On the real site the hostname is different, so these two
// lines never run there. They have to run before any read or write,
// which is why they sit at the top, before anything else touches
// Firestore. (FCM has no emulator; getting a token always talks to
// Google's real service, but that only registers this browser. It
// sends nothing.)
// ------------------------------------------------------------------
const IS_LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);
if (IS_LOCAL) {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
}

// The defaults for a phone that has never saved anything.
const DEFAULTS = { enabled: false, token: "", playerId: "", level: "segment", scope: "all" };

// How long to wait after the last change before saving (milliseconds).
const SAVE_DELAY_MS = 400;

// ------------------------------------------------------------------
// Page elements (ids from alerts.html).
// ------------------------------------------------------------------
const noticeEl = document.getElementById("al-notice");
const settingsEl = document.getElementById("al-settings");
const playerSelect = document.getElementById("al-player");
const teamEl = document.getElementById("al-team");
const enabledInput = document.getElementById("al-enabled");
const enabledHint = document.getElementById("al-enabled-hint");
const statusEl = document.getElementById("al-status");
const myTeamNameEl = document.getElementById("al-my-team-name");
const levelInputs = [...document.querySelectorAll('input[name="level"]')];
const scopeInputs = [...document.querySelectorAll('input[name="scope"]')];
const installCard = document.getElementById("al-install-card");
const installBtn = document.getElementById("al-install-btn");
const installSteps = document.getElementById("al-install-steps");
const androidTips = document.getElementById("al-android-tips");
const braveHint = document.getElementById("al-brave-hint");
const debugCard = document.getElementById("al-debug");
const debugText = document.getElementById("al-debug-text");
const debugCopy = document.getElementById("al-debug-copy");
const debugStatus = document.getElementById("al-debug-status");

// The "Check my setup" card appears only at alerts.html?debug.
// URLSearchParams reads the part of the address after "?".
const DEBUG = new URLSearchParams(location.search).has("debug");

// ------------------------------------------------------------------
// Page state.
//   settings  what's saved (or about to be) in Firestore
//   players   the roster: [{ id, name, team }]
//   uid       this browser's anonymous sign-in id (the doc's name)
//   canPush   false if this device can't get alerts at all
// ------------------------------------------------------------------
let settings = { ...DEFAULTS };
let players = [];
let uid = null;
let canPush = true;
let messaging = null; // Firebase Messaging handle, created only if supported

// Same escaping helper as roster.js / auth.js: a player name can never
// inject HTML, since parts of the page are built from template strings.
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ==================================================================
// 1. CAN THIS DEVICE GET ALERTS?
// ==================================================================

// (isIOS, isAndroid, isStandalone etc. live in platform.js.)

// The three browser features push needs.
function browserHasPush() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

// Show one of the helper messages in section 1.
function showNotice(html) {
  noticeEl.innerHTML = html;
  noticeEl.hidden = false;
}

function hideNotice() {
  noticeEl.hidden = true;
  noticeEl.innerHTML = "";
}

// The page's own address without any "?debug", for the Copy link button.
const PAGE_LINK = location.origin + location.pathname;

// Inside an app's built-in browser (Instagram, Facebook, Google app...):
// those can't install or receive push, so ask for the real browser by
// name. The address is also shown as text, so it can be long-pressed
// and copied by hand if the Copy button isn't allowed in that app.
function inAppHtml() {
  const browser = isIOS() ? "Safari" : isAndroid() ? "Chrome" : "your browser";
  return `
    <h2 class="al-notice-title">Open this page in ${browser} first</h2>
    <p>This app's built-in browser can't receive alerts. Tap the app's <strong>•••</strong> or <strong>⋮</strong> menu and choose <strong>Open in ${browser === "your browser" ? "browser" : browser}</strong>, or copy the link and paste it into ${browser}.</p>
    <p class="al-link" id="al-link-text">${escapeHtml(PAGE_LINK)}</p>
    <button type="button" id="al-copy-link">Copy link</button>
    <span class="status-msg" id="al-copy-status" aria-live="polite"></span>
  `;
}

// iPhone, not opened from the Home Screen. If it's not Safari (Chrome,
// Firefox, Edge on iPhone), add a line suggesting Safari, because the
// Share button is in a different place in each of those.
function iosInstallHtml() {
  const notSafari = browserFamily() !== "Safari";
  return `
    <h2 class="al-notice-title">Add this site to your Home Screen first</h2>
    <p>iPhones only allow alerts for websites opened from the Home Screen.</p>
    <ol class="al-steps">
      <li>Tap the <strong>Share</strong> button <svg class="al-share-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12"/><path d="M8 7l4-4 4 4"/><path d="M6 11H5v10h14V11h-1"/></svg> in Safari's toolbar.</li>
      <li>Scroll down and tap <strong>Add to Home Screen</strong>, then <strong>Add</strong>.</li>
      <li>Close Safari and open <strong>Cup Tracker</strong> from its new icon, then come back to this page (More → Alerts).</li>
    </ol>
    ${notSafari ? `<p>You're using ${browserFamily()}. These steps are easiest in <strong>Safari</strong>; elsewhere the Share button is in a slightly different place.</p>` : ""}
    <p class="al-notice-small">Needs iOS 16.4 or newer.</p>
  `;
}

// iPhone, opened from the Home Screen, but no push support at all: that
// only happens on iOS older than 16.4.
const IOS_TOO_OLD_HTML = `
  <h2 class="al-notice-title">This iPhone's software is too old for alerts</h2>
  <p>Score alerts need iOS 16.4 or newer. You can update in <strong>Settings → General → Software Update</strong>. Until then, the <a href="scoreboard.html">Scoreboard</a> always has the live scores.</p>
`;

const UNSUPPORTED_HTML = `
  <h2 class="al-notice-title">This browser can't get alerts</h2>
  <p>It doesn't support web push notifications. Try Chrome, Edge or Firefox on a computer or Android phone, or Safari on an iPhone (iOS 16.4 or newer, from the Home Screen).</p>
`;

// "How to turn notifications back on" differs per platform, so there
// are three versions: iPhone/iPad, Android, and everything else.
const DENIED_HTML = isIOS()
  ? `
    <h2 class="al-notice-title">Notifications are turned off for this app</h2>
    <p>To turn them back on:</p>
    <ol class="al-steps">
      <li>Open the iPhone <strong>Settings</strong> app.</li>
      <li>Tap <strong>Notifications</strong>, then <strong>Cup Tracker</strong>.</li>
      <li>Turn on <strong>Allow Notifications</strong>, then come back here and switch alerts on.</li>
    </ol>
  `
  : isAndroid()
  ? `
    <h2 class="al-notice-title">Notifications are blocked for this site</h2>
    <p>To turn them back on:</p>
    <ol class="al-steps">
      <li><strong>In the browser:</strong> tap the icon to the left of the web address, then <strong>Permissions</strong> (or <strong>Site settings</strong>) → <strong>Notifications</strong> → <strong>Allow</strong>.</li>
      <li><strong>If you added it to your Home Screen:</strong> press and hold the <strong>Cup Tracker</strong> icon → <strong>App info</strong> → <strong>Notifications</strong> → turn them on.</li>
      <li>Then reload this page and switch alerts on.</li>
    </ol>
  `
  : `
    <h2 class="al-notice-title">Notifications are blocked for this site</h2>
    <p>Allow notifications for this site in your browser's site settings (usually the icon to the left of the address), then reload this page.</p>
  `;

// Decide whether alerts are possible here, and say why not if they
// aren't. Returns true if the settings below should work.
// The checks run from most specific to least specific.
async function checkDevice() {
  // 1. Inside an app's built-in browser: hide the settings entirely.
  if (isInAppBrowser()) {
    showNotice(inAppHtml());
    settingsEl.hidden = true;
    wireCopyLink();
    return false;
  }
  // 2. iPhone in a browser tab: must add to Home Screen first.
  if (isIOS() && !isStandalone()) {
    showNotice(iosInstallHtml());
    return false;
  }
  // 3. iPhone Home Screen app without push: iOS older than 16.4.
  if (isIOS() && !("PushManager" in window)) {
    showNotice(IOS_TOO_OLD_HTML);
    return false;
  }
  // messagingIsSupported() is Firebase's own fuller check (it also
  // looks at things like IndexedDB and cookies), on top of ours.
  if (!browserHasPush() || !(await messagingIsSupported())) {
    showNotice(UNSUPPORTED_HTML);
    return false;
  }
  return true;
}

// ==================================================================
// 2. LOADING: the roster and this browser's saved settings.
// ==================================================================

// One-time roster read (same query as auth.js's picker), keeping the
// team too, for the pill.
async function loadPlayers() {
  const snap = await getDocs(query(collection(db, "players"), orderBy("name")));
  return snap.docs.map((d) => ({ id: d.id, name: d.data().name, team: d.data().team }));
}

async function loadSettings() {
  const snap = await getDoc(doc(db, "pushSubscriptions", uid));
  return snap.exists() ? { ...DEFAULTS, ...snap.data() } : null;
}

// ==================================================================
// 3. SAVING
// ==================================================================

// Write the whole document. setDoc (without "merge") replaces the doc
// entirely, so it always has exactly these eight keys, which is what
// firestore.rules checks for. An older six-key document (from before
// platform/installed existed) is upgraded by this same full rewrite.
// platform and installed are worked out fresh on every save rather than
// remembered, so they always describe this phone right now.
// serverTimestamp() is a placeholder that Firestore swaps for its own
// clock time when the write arrives.
async function saveNow() {
  clearTimeout(saveTimer);
  setStatus("Saving…");
  try {
    await setDoc(doc(db, "pushSubscriptions", uid), {
      enabled: settings.enabled,
      token: settings.token,
      playerId: settings.playerId,
      level: settings.level,
      scope: settings.scope,
      platform: platformKey(),
      installed: isStandalone(),
      updatedAt: serverTimestamp(),
    });
    setStatus("Saved", "ok");
  } catch (err) {
    console.error("Saving alert settings failed:", err);
    setStatus("Couldn't save. Check your connection and try again.", "error");
    throw err;
  }
}

// "Debouncing" (standard UI practice): when several changes come in
// quickly (say, tapping through radios), wait until they stop for
// SAVE_DELAY_MS and save once, instead of once per tap. Each call
// cancels the previous pending save and restarts the countdown.
let saveTimer = null;
function saveSoon() {
  clearTimeout(saveTimer);
  setStatus("Saving…");
  saveTimer = setTimeout(() => saveNow().catch(() => {}), SAVE_DELAY_MS);
}

// The small status line under the switch. "Saved" clears itself after a
// few seconds; errors stay until the next action.
let statusTimer = null;
function setStatus(text, kind = "") {
  clearTimeout(statusTimer);
  statusEl.textContent = text;
  statusEl.className = `al-status status-msg${kind ? ` ${kind}` : ""}`;
  if (kind === "ok") statusTimer = setTimeout(() => (statusEl.textContent = ""), 2500);
}

// ==================================================================
// 4. PUSH TOKEN PLUMBING
// ==================================================================

// Register (or re-register) our service worker and wait until it's
// running. Registering again when it's already installed is harmless:
// the browser just checks for an updated file. navigator.serviceWorker
// .ready resolves once a worker is active for this page's scope.
async function registerWorker() {
  await navigator.serviceWorker.register("/firebase-messaging-sw.js", { scope: "/" });
  return navigator.serviceWorker.ready;
}

// Get this browser's FCM token. Passing OUR registration matters: if
// Firebase isn't handed one, it quietly registers a second worker of
// its own. If a valid token is already stored in the browser, Firebase
// returns it without a new one being issued.
async function fetchToken() {
  const registration = await registerWorker();
  return getToken(messaging, { vapidKey: VAPID_PUBLIC_KEY, serviceWorkerRegistration: registration });
}

// ==================================================================
// 5. DRAWING THE PAGE FROM `settings`
// ==================================================================

function currentPlayer() {
  return players.find((p) => p.id === settings.playerId) || null;
}

// The team pill under the name, the "no team yet" note, and whether
// My team / Opposing can be picked.
function renderTeam() {
  const player = currentPlayer();
  const key = player ? teamKey(player.team) : "none";
  const hasTeam = key === "usa" || key === "eu";

  if (!player) {
    teamEl.innerHTML = "";
  } else if (hasTeam) {
    teamEl.innerHTML = teamPillHtml(player.team);
  } else {
    teamEl.innerHTML = `
      ${teamPillHtml(player.team)}
      <p class="al-team-note">You don't have a team yet, so you'll get <strong>All scores</strong> until the admin assigns one.</p>
    `;
  }

  // The ⓘ text for "My team's scores" names the team.
  myTeamNameEl.textContent = hasTeam ? teamName(player.team) : "your team";

  // Without a team, "mine" and "opposing" mean nothing, so they're
  // disabled. A saved choice is kept as-is (just shown greyed): if the
  // admin assigns a team later, it takes effect again on its own.
  for (const input of scopeInputs) {
    if (input.value !== "all") {
      input.disabled = !hasTeam;
      input.closest(".al-option").classList.toggle("is-disabled", !hasTeam);
    }
  }
}

// The master switch, its hint, and whether it can be used.
function renderSwitch() {
  enabledInput.checked = settings.enabled;

  if (!canPush) {
    enabledInput.disabled = true;
    enabledHint.textContent = "";
  } else if (Notification.permission === "denied") {
    enabledInput.disabled = true;
    enabledHint.textContent = "Blocked in your notification settings (see above).";
  } else if (!settings.playerId) {
    // Every subscription needs a real player, so name first.
    enabledInput.disabled = true;
    enabledHint.textContent = "Pick your name above first.";
  } else {
    enabledInput.disabled = false;
    enabledHint.textContent = settings.enabled ? "On for this phone." : "Off.";
  }
}

function renderRadios() {
  for (const input of levelInputs) input.checked = input.value === settings.level;
  for (const input of scopeInputs) input.checked = input.value === settings.scope;
}

function renderPlayers() {
  // The first option is a placeholder: shown until a name is picked,
  // but `disabled` so it can't be picked again afterwards.
  playerSelect.innerHTML =
    `<option value="" disabled>Pick your name</option>` +
    players.map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join("");
  playerSelect.value = settings.playerId;
}

function renderAll() {
  renderPlayers();
  renderTeam();
  renderRadios();
  renderSwitch();
}

// ==================================================================
// 6. REACTING TO TAPS
// ==================================================================

playerSelect.addEventListener("change", () => {
  settings.playerId = playerSelect.value;
  renderTeam();
  renderSwitch();
  saveSoon();
});

for (const input of [...levelInputs, ...scopeInputs]) {
  input.addEventListener("change", () => {
    if (!input.checked) return;
    settings[input.name] = input.value; // input.name is "level" or "scope"
    saveSoon();
  });
}

enabledInput.addEventListener("change", () => {
  if (enabledInput.checked) turnOn();
  else turnOff();
});

// Switch ON. The permission request must be the FIRST thing that
// happens after the tap, with nothing awaited before it: iPhones only
// show the permission prompt when it's asked for directly from a
// user's tap, and an earlier `await` can make the browser consider the
// tap "used up". So no async work comes before requestPermission().
function turnOn() {
  if (!VAPID_KEY_IS_SET) {
    enabledInput.checked = false;
    setStatus("Alerts aren't set up yet (the site's push key is missing). Ask the organizer.", "error");
    return;
  }

  const permissionAsked = Notification.requestPermission();
  enabledInput.disabled = true; // no double taps while we work
  setStatus("Turning on…");

  permissionAsked
    .then(async (permission) => {
      if (permission !== "granted") {
        settings.enabled = false;
        if (permission === "denied") showNotice(DENIED_HTML);
        setStatus("Notifications weren't allowed, so alerts are off.", "error");
        return;
      }
      settings.token = await fetchToken();
      settings.enabled = true;
      await saveNow();
    })
    .catch((err) => {
      console.error("Turning alerts on failed:", err);
      settings.enabled = false;
      settings.token = "";
      setStatus("Couldn't turn alerts on. Check your connection and try again.", "error");
    })
    .finally(renderSwitch);
}

// Switch OFF. Saving enabled=false comes first, because that alone
// stops the server from sending. Then the token is deleted at FCM,
// which makes it useless even if something still had a copy. If that
// second step fails (say, offline), alerts are still off.
async function turnOff() {
  enabledInput.disabled = true;
  settings.enabled = false;
  settings.token = "";
  try {
    await saveNow();
  } catch {
    // saveNow already showed the error; put the switch back.
    settings.enabled = true;
    renderSwitch();
    return;
  }
  try {
    await fetchToken(); // hands Firebase our worker first (see fetchToken)
    await deleteToken(messaging);
  } catch (err) {
    console.warn("Deleting the push token failed (alerts are still off):", err);
  }
  renderSwitch();
}

// ------------------------------------------------------------------
// The ⓘ buttons. Each toggles the explanation right below its option.
// aria-expanded tells screen readers whether it's open. Escape closes
// any open explanation and puts focus back on its ⓘ button.
// ------------------------------------------------------------------
function setInfoOpen(button, open) {
  button.setAttribute("aria-expanded", String(open));
  document.getElementById(button.getAttribute("aria-controls")).hidden = !open;
}

for (const button of document.querySelectorAll(".al-info")) {
  button.addEventListener("click", () => {
    setInfoOpen(button, button.getAttribute("aria-expanded") !== "true");
  });
}

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const focusedOption = document.activeElement?.closest(".al-option");
  for (const button of document.querySelectorAll('.al-info[aria-expanded="true"]')) {
    setInfoOpen(button, false);
    if (button.closest(".al-option") === focusedOption) button.focus();
  }
});

// ==================================================================
// 7. COPYING TEXT (Copy link, Copy diagnostics)
// ==================================================================

// Put text on the clipboard. The modern way is navigator.clipboard,
// but some in-app browsers block it. The fallback (standard practice,
// if old-fashioned) puts the text in an invisible text box, selects it
// and uses the older "copy" command. Returns true if either worked.
// Some browsers leave the modern request hanging instead of refusing
// it, so it gets 1.5 seconds (Promise.race = whichever finishes first)
// before falling back.
async function copyText(text) {
  try {
    const giveUp = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 1500));
    await Promise.race([navigator.clipboard.writeText(text), giveUp]);
    return true;
  } catch {
    const box = document.createElement("textarea");
    box.value = text;
    box.setAttribute("readonly", "");
    box.style.position = "fixed";
    box.style.opacity = "0";
    document.body.appendChild(box);
    box.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    box.remove();
    return ok;
  }
}

// The in-app notice's Copy link button (the notice is built as HTML
// text, so the button is looked up after it's on the page).
function wireCopyLink() {
  const button = document.getElementById("al-copy-link");
  const status = document.getElementById("al-copy-status");
  button.addEventListener("click", async () => {
    const ok = await copyText(PAGE_LINK);
    status.textContent = ok ? "Copied" : "Couldn't copy. Press and hold the link above to copy it.";
    status.className = `status-msg ${ok ? "ok" : "error"}`;
  });
}

// ==================================================================
// 8. ANDROID: INSTALL CARD AND TIPS
// ==================================================================

// Chrome, Samsung Internet and Edge fire "beforeinstallprompt" when the
// site can be installed. Calling preventDefault() stops the browser's
// own small install banner (standard practice when a page offers its
// own Install button), and we keep the event so our button can show the
// real install dialog later. The event can only be used once.
let installPrompt = null;
let justInstalled = false;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPrompt = event;
  renderInstallCard();
});

// Fired once the app has been installed (from our button or the menu).
window.addEventListener("appinstalled", () => {
  installPrompt = null;
  justInstalled = true;
  renderInstallCard();
});

installBtn.addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice; // resolves when they tap Install or Cancel
  installPrompt = null; // used up either way
  renderInstallCard();
});

// Manual install steps, per browser (menu names differ).
function manualInstallSteps() {
  const back = "<li>Then open <strong>Cup Tracker</strong> from its new icon and come back here (More → Alerts).</li>";
  switch (browserFamily()) {
    case "Chrome":
      return `<li>Tap the <strong>⋮</strong> menu (top right).</li><li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>, then <strong>Install</strong>.</li>${back}`;
    case "Samsung Internet":
      return `<li>Tap the <strong>≡</strong> menu (bottom right).</li><li>Tap <strong>Add page to</strong>, then <strong>Home screen</strong>.</li>${back}`;
    case "Firefox":
      return `<li>Tap the <strong>⋮</strong> menu.</li><li>Tap <strong>Install</strong> or <strong>Add to Home screen</strong>.</li>${back}`;
    default:
      return `<li>Open your browser's menu.</li><li>Tap <strong>Install app</strong> or <strong>Add to Home screen</strong>.</li>${back}`;
  }
}

// Show the Install card only on Android, in a browser tab (not already
// installed), on a device that can get alerts. With an install prompt
// available: the button. Without: the manual steps.
function renderInstallCard() {
  const show = isAndroid() && canPush && !isStandalone() && !justInstalled;
  installCard.hidden = !show;
  if (!show) return;
  installBtn.hidden = !installPrompt;
  installSteps.hidden = Boolean(installPrompt);
  installSteps.innerHTML = installPrompt ? "" : manualInstallSteps();
}

// The tips card: every Android device that can get alerts; the Brave
// line only in Brave.
function renderAndroidTips() {
  androidTips.hidden = !(isAndroid() && canPush);
  braveHint.hidden = !isBrave();
}

// ==================================================================
// 9. "CHECK MY SETUP" (only at alerts.html?debug)
// ==================================================================

// Plain-text summary for troubleshooting. Never includes the whole
// token: only whether there is one and its last 6 characters, enough
// to match it against the database without exposing it.
async function diagnosticsText() {
  let workerActive = "no";
  try {
    const reg = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration("/") : null;
    workerActive = reg?.active ? "yes" : "no";
  } catch {
    workerActive = "unknown";
  }
  const player = currentPlayer();
  const yesNo = (b) => (b ? "yes" : "no");
  return [
    "Cup Tracker alerts: setup check",
    `Time: ${new Date().toISOString()}`,
    `Platform: ${platformKey()} · ${browserFamily()}${isBrave() ? " (Brave)" : ""}${isInAppBrowser() ? " · in-app browser" : ""}`,
    `Installed: ${yesNo(isStandalone())}`,
    `Push supported: ${yesNo(canPush)}`,
    `Permission: ${"Notification" in window ? Notification.permission : "not available"}`,
    `Service worker active: ${workerActive}`,
    `Token registered: ${settings.token ? `yes (…${settings.token.slice(-6)})` : "no"}`,
    `Saved settings: enabled=${settings.enabled}, level=${settings.level}, scope=${settings.scope}, player=${player ? `${player.name} (${player.id})` : settings.playerId || "none"}`,
  ].join("\n");
}

async function refreshDiagnostics() {
  debugText.textContent = await diagnosticsText();
}

if (DEBUG) {
  debugCard.hidden = false;
  // "toggle" fires when the <details> box is opened or closed; refresh
  // the numbers each time it's opened.
  debugCard.addEventListener("toggle", () => {
    if (debugCard.open) refreshDiagnostics();
  });
  debugCopy.addEventListener("click", async () => {
    const text = await diagnosticsText();
    debugText.textContent = text;
    const ok = await copyText(text);
    debugStatus.textContent = ok ? "Copied" : "Couldn't copy. Select the text above instead.";
    debugStatus.className = `status-msg ${ok ? "ok" : "error"}`;
  });
}

// ==================================================================
// 10. START-UP
// ==================================================================

async function init() {
  // Until loading finishes, nothing can be changed.
  settingsEl.disabled = true;

  canPush = await checkDevice();
  if (canPush) messaging = getMessaging();

  // In an in-app browser there's nothing else to load or show.
  if (isInAppBrowser()) return;

  // Set below: does the saved document need rewriting now? (It's from
  // before platform/installed existed, or those have changed, e.g. the
  // app was installed since the last save.)
  let needsUpgrade = false;

  try {
    const user = await ensureSignedIn();
    uid = user.uid;
    const [roster, saved] = await Promise.all([loadPlayers(), loadSettings()]);
    needsUpgrade = Boolean(saved) && (saved.platform !== platformKey() || saved.installed !== isStandalone());
    players = roster;

    // Saved settings if any, otherwise the defaults.
    settings = saved || { ...DEFAULTS };

    // No name chosen yet (first visit, or only the radios were saved so
    // far): guess the player from the "Who are you?" pick used for
    // score entry, if any. Only prefilled; nothing is saved until
    // something is changed.
    if (!settings.playerId) {
      const remembered = getUnlockPlayerId();
      if (players.some((p) => p.id === remembered)) settings.playerId = remembered;
    }
  } catch (err) {
    console.error("Loading alert settings failed:", err);
    setStatus("Couldn't load your settings. Check your connection and reload.", "error");
    return; // leave everything disabled
  }

  renderAll();

  // On an iPhone outside the Home Screen app (or an unsupported
  // browser), show the settings but leave them all disabled.
  if (!canPush) return;
  settingsEl.disabled = false;
  renderTeam(); // re-applies the per-option disabling inside the fieldset

  if (Notification.permission === "denied") showNotice(DENIED_HTML);
  else hideNotice();

  renderInstallCard();
  renderAndroidTips();

  // At most ONE save happens below, for any of three reasons.
  let mustSave = needsUpgrade;

  if (settings.enabled) {
    if (Notification.permission !== "granted") {
      // Saved as ON, but the phone no longer allows notifications
      // (turned off in Settings, or the app was removed and re-added):
      // record that alerts are off, so the server doesn't keep trying a
      // dead token.
      settings.enabled = false;
      settings.token = "";
      renderSwitch();
      mustSave = true;
    } else {
      // Still allowed: refresh the token. Browsers and FCM occasionally
      // replace it; save only if it actually changed.
      try {
        const token = await fetchToken();
        if (token && token !== settings.token) {
          settings.token = token;
          mustSave = true;
        }
      } catch (err) {
        console.warn("Refreshing the push token failed:", err);
      }
    }
  }

  if (mustSave) await saveNow().catch(() => {});
  if (DEBUG && debugCard.open) refreshDiagnostics();
}

init();
