// "Ready for offline" check + hourly data warm-up (offline project,
// stage 2). Loaded on every page by nav.js.
//
// TWO JOBS.
//
// 1. WARM-UP. Firestore's offline copy (stage 1) only holds data a page
//    has actually loaded. The Home page, for example, never loads the
//    player list, so someone who only opened Home on wifi would see
//    "(unknown)" names on a round page offline. So whenever the app is
//    open AND connected, at most once an hour, we ask the server for the
//    player list and every round's matches. Asking is enough: Firestore
//    stores the answers in its offline copy as a side effect. Cost: about
//    36 document reads per phone per hour of use (a few cents for the
//    whole trip). Right after, the service worker re-checks every stored
//    app file, so a new deploy reaches all of them.
//
// 2. THE "READY" LINE at the bottom of the More menu. "Ready" means:
//      - the service worker (firebase-messaging-sw.js) is installed,
//      - every app file is stored on the phone, and
//      - the warm-up above succeeded within the last 12 hours.
//    It's re-checked each time the More menu is opened.

import { db } from "./firebase-init.js";
import { collection, getDocsFromServer } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { ROUNDS } from "./rounds-config.js";
import { isConnected, onConnectionChange } from "./connection.js";

const LAST_WARMUP_KEY = "rydercup_last_warmup";
const WARMUP_EVERY_MS = 60 * 60 * 1000;        // at most once an hour
const READY_WINDOW_MS = 12 * 60 * 60 * 1000;   // "ready" if warmed within 12 h
const SW_ANSWER_TIMEOUT_MS = 20000;            // give up waiting for the worker

// localStorage wrapped in try/catch, as in connection.js: some private
// modes throw, and that must not break the page.
function readLastWarmup() {
  try {
    const n = Number(localStorage.getItem(LAST_WARMUP_KEY));
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

function writeLastWarmup(ms) {
  try {
    localStorage.setItem(LAST_WARMUP_KEY, String(ms));
  } catch {
    /* ignore */
  }
}

// ------------------------------------------------------------------
// 1. Warm-up.
// ------------------------------------------------------------------
let warming = false;

async function warmUp() {
  if (warming || !isConnected()) return;
  const last = readLastWarmup();
  if (last && Date.now() - last < WARMUP_EVERY_MS) return;
  warming = true;
  try {
    // getDocsFromServer insists on a fresh answer from the server (never
    // the phone's copy), so success really means "the copy is current".
    await Promise.all([
      getDocsFromServer(collection(db, "players")),
      ...ROUNDS.map((round) => getDocsFromServer(collection(db, "rounds", round.id, "matches"))),
    ]);
    writeLastWarmup(Date.now());
    // While we know we're connected, also have the service worker
    // re-check every stored app file against the server (see refreshAll
    // in firebase-messaging-sw.js), so a new deploy reaches every file,
    // not only those of pages someone opened. Fire and forget.
    const registration = "serviceWorker" in navigator ? await navigator.serviceWorker.getRegistration("/") : null;
    if (registration && registration.active) registration.active.postMessage({ type: "refresh-all" });
  } catch (err) {
    // Lost signal mid-way, or similar: try again next time we connect.
    console.warn("offline-ready.js: warm-up failed", err);
  } finally {
    warming = false;
  }
}

// Run whenever the connection comes up (and right away if it's up).
// onConnectionChange also calls us immediately with the current state.
// After a warm-up, refresh the More-menu line so it doesn't keep
// saying "scores not downloaded yet".
onConnectionChange((connected) => {
  if (connected) warmUp().then(refreshStatus);
});
// And once an hour while the app stays open.
setInterval(warmUp, WARMUP_EVERY_MS);

// ------------------------------------------------------------------
// 2. The "Ready" line.
// ------------------------------------------------------------------

// Ask the service worker which files are still missing. It tries to
// download them first (see the "message" handler in
// firebase-messaging-sw.js), then answers. A MessageChannel is a
// private two-way pipe: we keep one end (port1) to hear the answer and
// hand the other (port2) to the worker to reply on.
async function askWorkerForMissing() {
  if (!("serviceWorker" in navigator)) return { error: "no-sw" };
  const registration = await navigator.serviceWorker.getRegistration("/");
  const worker = registration && (registration.active || registration.waiting || registration.installing);
  if (!worker) return { error: "no-sw" };
  if (!registration.active) return { error: "installing" };

  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve({ error: "timeout" }), SW_ANSWER_TIMEOUT_MS);
    channel.port1.onmessage = (event) => {
      clearTimeout(timer);
      resolve(event.data && event.data.ok ? { missing: event.data.missing } : { error: "failed" });
    };
    registration.active.postMessage({ type: "offline-status" }, [channel.port2]);
  });
}

// "7:12 AM", or "Thu 7:12 AM" if not today.
function formatTime(ms) {
  const then = new Date(ms);
  const time = then.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  const sameDay = then.toDateString() === new Date().toDateString();
  return sameDay ? time : `${then.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

// Work out the status and write it into the line nav.js put at the
// bottom of the More menu (#offline-status).
async function refreshStatus() {
  const el = document.getElementById("offline-status");
  if (!el) return;

  // Show something immediately; the file check can take a moment.
  if (!el.textContent) el.textContent = "Checking offline readiness…";

  // A quick warm-up first if one is due and we're connected.
  await warmUp();

  const files = await askWorkerForMissing();
  const lastWarmup = readLastWarmup();
  const dataFresh = lastWarmup && Date.now() - lastWarmup < READY_WINDOW_MS;

  // The reasons we're NOT ready, in plain words.
  const reasons = [];
  if (files.error === "no-sw") reasons.push("this browser can't store the app");
  else if (files.error === "installing") reasons.push("still setting up");
  else if (files.error) reasons.push("couldn't check stored files");
  else if (files.missing.length > 0) reasons.push(`${files.missing.length} files still downloading`);
  if (!dataFresh) reasons.push(lastWarmup ? "scores not refreshed in 12 h" : "scores not downloaded yet");

  if (reasons.length === 0) {
    el.className = "offline-status is-ready";
    el.textContent = `✓ Ready for offline · scores from ${formatTime(lastWarmup)}`;
  } else {
    el.className = "offline-status";
    el.textContent = `Not ready for offline: ${reasons.join(", ")}. Open the app on wifi.`;
  }
}

// Re-check whenever the More menu is opened. (nav.js builds the
// button; we only listen to it.)
const moreButton = document.querySelector('.tabbar button[data-popover="tab-popover-more"]');
if (moreButton) moreButton.addEventListener("click", () => refreshStatus());

// And once shortly after the page loads, so the line is filled in.
setTimeout(refreshStatus, 2000);
