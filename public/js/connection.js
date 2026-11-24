// Connection watcher + "No signal" banner (offline project, stage 1).
//
// Loaded on every page by nav.js. It answers one question for the whole
// app: "is this phone talking to the database server right now?", and
// shows a slim banner above the tab bar whenever the answer is no.
//
// HOW WE KNOW. The phone's own "am I online?" flag (navigator.onLine) is
// not trustworthy on its own: it says "online" whenever the phone is
// joined to ANY network, including hotel wifi stuck at its login page or
// one bar of signal that carries nothing. So the real signal comes from
// Firestore itself. Every live listener gets snapshots, and each
// snapshot carries `metadata.fromCache`:
//   fromCache === false  ->  this data was just confirmed by the server,
//                            so we ARE connected;
//   fromCache === true   ->  this is the phone's saved copy, because the
//                            server can't be reached (or hasn't answered
//                            yet in the first second after opening).
// We keep one tiny listener on a single document (rounds/round1, the
// round's description, which anyone may read) purely to watch that flag.
// "includeMetadataChanges: true" asks Firestore to tell us when ONLY the
// flag changes; without it, losing the connection wouldn't call us at
// all, since the data itself doesn't change. Cost: about one document
// read each time a page opens (a fraction of a cent over the whole trip).
//
// WEAK SIGNAL. Firestore only notices it's offline when its connection
// FAILS. On a weak signal the connection can instead just hang (nothing
// comes back, but nothing errors either), and in testing Firestore kept
// believing it was online for minutes. So, while the app is on screen,
// we also ask the server for that same tiny document every 30 seconds
// ("probe"); if no answer arrives within 8 seconds, we treat the phone
// as having no signal. Cost: about 2 reads a minute per phone with the
// app open (well under a dollar for the whole trip).
//
// Other files can ask for the current state with isConnected(), or be
// told about changes with onConnectionChange(callback). The round page
// uses that to say "will send when you have signal" vs "Sending…".

import { db } from "./firebase-init.js";
import { doc, getDocFromServer, onSnapshot } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";

// localStorage key for "the last moment this phone heard from the
// server", so the banner can say "last connected 10:42" even right
// after the app is reopened with no signal.
const LAST_CONNECTED_KEY = "rydercup_last_connected";

// Right after a page opens, the first snapshot always comes from the
// phone's saved copy (fromCache true), and the server's answer follows a
// moment later. Waiting this long before showing the banner keeps it
// from flashing on every normal page load. If the phone itself reports
// no network at all, we skip the wait (see updateBanner).
const GRACE_MS = 3000;

// While connected, refresh the "last connected" time this often, so it's
// at most this stale when the signal drops.
const HEARTBEAT_MS = 15000;

// The weak-signal probe (see top of file).
const PROBE_EVERY_MS = 30000;
const PROBE_TIMEOUT_MS = 8000;
// A probe request that's been hanging this long is abandoned (left to
// finish or fail on its own) so a fresh one can start. Without this, one
// request stuck forever would leave us stuck on "no signal" forever.
const PROBE_ABANDON_MS = 60000;

// The tiny, publicly readable document the listener watches.
const WATCHED_DOC = doc(db, "rounds", "round1");

// The probe deliberately asks about a DIFFERENT document, one nothing
// else in the app listens to. (If it asked about WATCHED_DOC, Firestore
// would answer from the listener's own "already up to date" copy
// without contacting the server, so a hanging connection would pass.)
// It doesn't need to exist: "no such document" is still an answer from
// the server, and rules let anyone read under rounds/. Nothing is ever
// written to it.
const PROBE_DOC = doc(db, "rounds", "_connection-probe");

// Our best knowledge of the server connection. Starts false: until the
// server answers, we can't claim to be connected.
let serverReachable = false;
let connected = false;

// Result of the latest probe. Starts true so the probe can only ever
// take "connected" away, never grant it on its own: the listener below
// remains the main signal.
let probeOk = true;
let probeInFlight = null;      // the server request still waiting, if any
let probeStartedAt = 0;

const subscribers = new Set();

// Plain helpers around localStorage, wrapped in try/catch because some
// browsers (private modes) throw when storage is unavailable. Losing
// the "last connected" time is harmless; crashing the banner is not.
function readLastConnected() {
  try {
    const n = Number(localStorage.getItem(LAST_CONNECTED_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeLastConnected(ms) {
  try {
    localStorage.setItem(LAST_CONNECTED_KEY, String(ms));
  } catch {
    /* storage unavailable: ignore */
  }
}

// "10:42", or "Thu 10:42" if it was on a different day (a stale time
// from yesterday shouldn't look like this morning).
function formatTime(ms) {
  const then = new Date(ms);
  const time = then.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sameDay = then.toDateString() === new Date().toDateString();
  return sameDay ? time : `${then.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

// ------------------------------------------------------------------
// The banner element. Built once and appended to the page; shown and
// hidden with the standard `hidden` attribute. role="status" makes
// screen readers announce it politely when it appears.
// ------------------------------------------------------------------
const banner = document.createElement("div");
banner.className = "offline-banner";
banner.setAttribute("role", "status");
banner.hidden = true;
document.body.appendChild(banner);

let graceTimer = null;

function showBanner() {
  const last = readLastConnected();
  const when = last ? ` · last connected ${formatTime(last)}` : "";
  banner.textContent = `No signal${when} · other groups' scores may be out of date`;
  banner.hidden = false;
  // A class on <body> adds a little bottom padding while the banner is
  // up, so the end of the page never hides behind it (see style.css).
  document.body.classList.add("has-offline-banner");
}

function hideBanner() {
  banner.hidden = true;
  document.body.classList.remove("has-offline-banner");
}

function updateBanner() {
  clearTimeout(graceTimer);
  if (connected) {
    hideBanner();
  } else if (navigator.onLine === false) {
    // The phone itself says it has no network: no need to wait.
    showBanner();
  } else {
    graceTimer = setTimeout(() => {
      if (!connected) showBanner();
    }, GRACE_MS);
  }
}

// Recompute `connected` from what we know, and if it changed, update the
// banner and tell anyone who asked to be told.
function recompute() {
  const next = serverReachable && probeOk && navigator.onLine !== false;
  if (next) writeLastConnected(Date.now());
  if (next === connected) return;
  connected = next;
  updateBanner();
  for (const callback of subscribers) callback(connected);
}

// One weak-signal probe: ask the server (never the phone's copy) for the
// watched document, and wait at most PROBE_TIMEOUT_MS for an answer.
// Promise.race settles with whichever promise finishes first, which is
// the standard way to put a time limit on a promise.
async function probe() {
  if (document.visibilityState !== "visible") return;   // app not on screen
  if (probeInFlight) {
    // The previous request is still waiting; that already means "no
    // answer", unless it's so old we should give up on it and retry.
    if (Date.now() - probeStartedAt < PROBE_ABANDON_MS) return;
  }
  const request = getDocFromServer(PROBE_DOC).then(
    () => true,
    () => false   // e.g. "client is offline": also a "no"
  );
  probeInFlight = request;
  probeStartedAt = Date.now();
  // If this request answers late (after the time limit), signal is back:
  // record that as soon as it happens.
  request.then((ok) => {
    if (probeInFlight === request) probeInFlight = null;
    if (ok && !probeOk) {
      probeOk = true;
      recompute();
    }
  });
  const timeLimit = new Promise((resolve) => setTimeout(() => resolve(false), PROBE_TIMEOUT_MS));
  probeOk = await Promise.race([request, timeLimit]);
  recompute();
}

// ------------------------------------------------------------------
// Public helpers for other files.
// ------------------------------------------------------------------

// Check the connection now rather than waiting for the next 30-second
// probe. The round page calls this right after a Save, so a dead
// connection is noticed within seconds of the score being saved.
export function checkConnectionNow() {
  probe();
}
export function isConnected() {
  return connected;
}

// Calls `callback(connected)` now and again on every change. Returns a
// function that stops the calls (standard "unsubscribe" pattern).
export function onConnectionChange(callback) {
  subscribers.add(callback);
  callback(connected);
  return () => subscribers.delete(callback);
}

// ------------------------------------------------------------------
// Start watching.
// ------------------------------------------------------------------
onSnapshot(
  doc(db, "rounds", "round1"),
  { includeMetadataChanges: true },
  (snapshot) => {
    serverReachable = !snapshot.metadata.fromCache;
    // A fresh delivery from the server proves the server is answering,
    // so clear any failed probe straight away. (Otherwise, after a
    // clean disconnect, the banner could linger up to 30 seconds after
    // signal returns, waiting for the next probe. A hanging connection
    // never reaches this line, so hang detection is unaffected.)
    if (serverReachable) probeOk = true;
    recompute();
  },
  (error) => {
    // A failed listener (it shouldn't: this document is public) must not
    // break the page. Treat it as "can't confirm we're connected".
    console.warn("connection.js: watcher failed", error);
    serverReachable = false;
    recompute();
  }
);

// The phone's own network flag can flip instantly (e.g. airplane mode),
// faster than Firestore notices, so react to it too.
window.addEventListener("online", () => {
  recompute();
  probe();   // signal may be back: re-check rather than wait 30 s
});
window.addEventListener("offline", recompute);

// Probe every 30 seconds, and straight away when the app comes back on
// screen (phones pause timers for apps in the background).
setInterval(probe, PROBE_EVERY_MS);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") probe();
});

// Keep "last connected" fresh while we are connected.
setInterval(() => {
  if (connected) writeLastConnected(Date.now());
}, HEARTBEAT_MS);

// Show the banner (after the grace period) if we never connect at all.
updateBanner();
