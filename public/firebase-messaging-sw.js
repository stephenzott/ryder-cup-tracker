// Service worker for push notifications.
// (Since the offline project, stage 2, it ALSO stores the app's files
// so the app opens with no signal: see "OFFLINE CACHING" further down.
// That section is separate; the push code below is unchanged.)
//
// WHAT A SERVICE WORKER IS (standard web-platform concept): a small
// script the browser keeps installed in the background for this site,
// separate from any open page. It can wake up when a push message
// arrives even if no tab is open, which is the only way a website can
// show a notification while closed. It has no access to the page's
// HTML; it just reacts to events ("push", "notificationclick", ...).
//
// WHY IT LIVES AT THE SITE ROOT: a service worker can only control
// pages at or below its own folder, and Firebase Messaging looks for
// this exact file name. So it must be /firebase-messaging-sw.js.
//
// THE KEY DESIGN RULE: every push must show a visible notification.
// iPhones can withdraw notification permission from a site that
// receives pushes without showing anything. Firebase's own service-
// worker code does NOT guarantee that: when the site is open on
// screen it hands the message to the page and shows nothing. So we
// register our OWN "push" handler below, before loading Firebase, and
// it always calls showNotification. Our server (stage 2) sends
// "data-only" messages: title/body/icon/tag/url live in the message's
// `data` and Firebase never displays anything by itself, so there is
// exactly one notification per push, the one shown here.
//
// This is a "classic" service worker (loaded with importScripts), not
// an ES module, because classic workers run on every browser that
// supports push, including older iPhones. That is also why the
// Firebase config below is copied here rather than imported from
// js/firebase-init.js (a classic worker can't `import` an ES module).

// ------------------------------------------------------------------
// Defaults used when a message is missing a field.
// ------------------------------------------------------------------
const DEFAULT_TITLE = "Cup Tracker";
const DEFAULT_ICON = "/icons/icon-192.png";
// Android's small status-bar icon: a white-on-transparent silhouette
// (Android uses only its shape and tints it). Without one, Android
// shows a generic browser icon. iPhones ignore it.
const BADGE = "/icons/badge-96.png";
const DEFAULT_URL = "/index.html";

// ------------------------------------------------------------------
// Install / activate: take over immediately.
// Standard practice: by default a new version of a service worker
// waits until every tab of the old one is closed. skipWaiting() +
// clients.claim() make an updated worker active right away, so a fix
// here reaches phones on their next visit instead of "eventually".
// ------------------------------------------------------------------
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// ------------------------------------------------------------------
// Pull our fields out of a push. A Firebase message arrives as JSON
// shaped like { data: { title, body, icon, tag, url }, from, ... }.
// Anything unreadable falls back to a generic notification, because
// showing *something* is mandatory (see the rule at the top).
// ------------------------------------------------------------------
function readPush(event) {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (err) {
    // Not JSON (shouldn't happen with Firebase): use the raw text as body.
    payload = { data: { body: event.data ? event.data.text() : "" } };
  }
  const data = payload.data || {};
  return {
    title: data.title || DEFAULT_TITLE,
    body: data.body || "New score update",
    icon: data.icon || DEFAULT_ICON,
    tag: data.tag || "",
    url: data.url || DEFAULT_URL,
  };
}

// ------------------------------------------------------------------
// PUSH: always show a notification.
// event.waitUntil(...) tells the browser "keep this worker alive
// until this promise finishes"; without it the worker could be shut
// down before the notification appears.
// ------------------------------------------------------------------
self.addEventListener("push", (event) => {
  const msg = readPush(event);
  const options = {
    body: msg.body,
    icon: msg.icon,
    badge: BADGE,
    // Stored on the notification so the click handler knows where to go.
    data: { url: msg.url },
  };
  if (msg.tag) {
    // A notification with the same tag REPLACES the older one instead
    // of stacking (e.g. one per match). renotify makes the replacement
    // buzz/sound again; browsers reject renotify without a tag, hence
    // the if.
    options.tag = msg.tag;
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(msg.title, options));
});

// ------------------------------------------------------------------
// NOTIFICATION TAP: focus an open window of the site, or open the URL.
// Firebase's docs say to register this before loading Firebase so our
// handler is the one in charge. (Firebase's own click handler only
// acts on notifications Firebase displayed itself, which never happens
// here, so the two don't clash.)
// ------------------------------------------------------------------
self.addEventListener("notificationclick", (event) => {
  event.notification.close();

  // Resolve the target against our own site, and refuse to open other
  // websites: a message can only send people to a page of this site.
  let target = new URL(DEFAULT_URL, self.location.origin);
  try {
    const wanted = new URL(event.notification.data?.url || DEFAULT_URL, self.location.origin);
    if (wanted.origin === self.location.origin) target = wanted;
  } catch (err) {
    // Malformed URL: keep the default.
  }

  event.waitUntil(
    (async () => {
      // Every open tab/window of this site, including ones opened before
      // this worker took control.
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      // 1. A window already showing that exact page: just bring it forward.
      const exact = windows.find((w) => w.url === target.href);
      if (exact) return exact.focus();

      // 2. Some other window of the site: bring it forward and send it to
      //    the page. navigate() can fail for a window this worker doesn't
      //    control yet; then fall through to opening a new one.
      if (windows.length > 0) {
        try {
          const focused = await windows[0].focus();
          return await focused.navigate(target.href);
        } catch (err) {
          // fall through
        }
      }

      // 3. No usable window: open one (on iPhone this opens the Home
      //    Screen app).
      return self.clients.openWindow(target.href);
    })()
  );
});

// ==================================================================
// OFFLINE CACHING (offline project, stage 2)
//
// Everything above this line is the push-notification code and is
// unchanged. Everything in this section is about letting the app OPEN
// with no signal. The two halves don't touch each other: push uses the
// "push" and "notificationclick" events, offline uses "install",
// "activate", "fetch" and "message".
//
// HOW IT WORKS (standard service-worker practice). Once this worker is
// installed, every request a page of this site makes (a page, a script,
// a font) goes through the "fetch" handler below first, and the worker
// decides where the answer comes from: the network, or its own store of
// files on the phone (the "cache", a standard browser feature called
// the Cache Storage API). The strategies used:
//
//   Our own files (pages, JS, CSS, icons, PDFs): NETWORK-FIRST with a
//     3-second limit. Online, you always get the latest file, exactly as
//     before (and the stored copy is refreshed). If the network fails or
//     takes longer than 3 s, the stored copy is used instead.
//   Firebase's code (www.gstatic.com/firebasejs/11.3.1/...) and Google
//     font files: CACHE-FIRST. Their addresses include a version, so the
//     file behind an address never changes; no need to ask the network.
//   Google Fonts' small stylesheet: network-first, like our files.
//   Everything else (the database, sign-in, other websites): NOT
//     TOUCHED. The worker doesn't answer, so the browser handles it
//     exactly as if there were no worker. Firestore keeps its own
//     offline copy (stage 1).
//
// PRE-DOWNLOADING ("precaching"). When the worker is installed, it
// downloads every file in PRECACHE_FILES below, so a phone that only
// ever opened the Home page still has every other page offline. If some
// downloads fail (wifi drops), the worker installs anyway: a failed
// download must never cost anyone their push notifications. The missing
// files are fetched later, whenever a page asks how ready we are (the
// "Ready for offline" line in the More menu, see js/offline-ready.js).
// And after each hourly data warm-up, every stored file is re-checked
// with the server (refreshAll below), so a new deploy reaches ALL stored
// files, not just the ones whose pages someone happened to open.
// ==================================================================

// Bump this ONLY when you add, rename or delete a file in
// PRECACHE_FILES below. (Changing a file's contents needs no bump:
// network-first refreshes stored copies on every online visit.) A new
// number makes phones throw away the old store and download afresh.
const CACHE_VERSION = 1;
const APP_CACHE = `cup-app-v${CACHE_VERSION}`;
// Versioned third-party files (Firebase code, fonts) go in a store
// that survives version bumps, since they never change.
const CDN_CACHE = "cup-cdn";

// How long network-first waits before using the stored copy.
const NETWORK_TIMEOUT_MS = 3000;
// After one request has hit that limit, assume the signal is bad and,
// for this long, answer from the store straight away (refreshing in the
// background). Without it, a page that loads scripts in four "layers"
// could wait 4 x 3 s on weak signal.
const BAD_SIGNAL_WINDOW_MS = 30000;
let badSignalUntil = 0;

// Every file of the app, as paths from the site root. KEEP IN SYNC with
// the files in public/ (functions/scripts/check-offline.js compares the
// two for you: `npm --prefix functions run check-offline`). The marker
// comments are how that checker finds the list; leave them in place.
// PRECACHE-LIST-START
const PRECACHE_FILES = [
  "/",
  "/index.html",
  "/scoreboard.html",
  "/round1.html",
  "/round2.html",
  "/round3.html",
  "/round4.html",
  "/roster.html",
  "/player.html",
  "/stats.html",
  "/schedule.html",
  "/alerts.html",
  "/admin.html",
  "/manifest.webmanifest",
  "/css/style.css",
  "/js/admin.js",
  "/js/alerts.js",
  "/js/auth.js",
  "/js/connection.js",
  "/js/courses-config.js",
  "/js/firebase-init.js",
  "/js/flash.js",
  "/js/history-data.js",
  "/js/hole-tips-config.js",
  "/js/index.js",
  "/js/match-ui.js",
  "/js/my-entries.js",
  "/js/nav.js",
  "/js/offline-ready.js",
  "/js/platform.js",
  "/js/player-stats.js",
  "/js/player.js",
  "/js/roster.js",
  "/js/round.js",
  "/js/rounds-config.js",
  "/js/schedule-config.js",
  "/js/schedule.js",
  "/js/scoreboard.js",
  "/js/scoring.js",
  "/js/stats.js",
  "/icons/apple-touch-icon.png",
  "/icons/badge-96.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
  "/scorecards/scorecard-the-irish.pdf",
  "/scorecards/scorecard-the-meadow-valleys.pdf",
  "/scorecards/scorecard-the-river.pdf",
  "/scorecards/scorecard-the-straits.pdf",
];
// PRECACHE-LIST-END

// Firebase's code, same version as the pages use. Each of these only
// depends on firebase-app.js, so this list is complete.
const FIREBASE_SDK = "https://www.gstatic.com/firebasejs/11.3.1/";
const PRECACHE_CDN = [
  `${FIREBASE_SDK}firebase-app.js`,
  `${FIREBASE_SDK}firebase-auth.js`,
  `${FIREBASE_SDK}firebase-firestore.js`,
  `${FIREBASE_SDK}firebase-functions.js`,
  `${FIREBASE_SDK}firebase-messaging.js`,
];
// The fonts stylesheet every page links to. Its font files are found by
// reading the stylesheet (see precacheFonts).
const FONTS_CSS =
  "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=Inter:wght@400;500;600&display=swap";

// ------------------------------------------------------------------
// Small helpers.
// ------------------------------------------------------------------

// The key a file of OURS is stored under: its path with any "?v=16"
// removed, and "/" stored as "/index.html". The ?v= numbers exist to
// beat the browser's own cache; this store doesn't need them, and
// stripping them means one stored copy per file instead of one per
// version.
function appKey(url) {
  const u = new URL(url);
  const path = u.pathname === "/" ? "/index.html" : u.pathname;
  return new URL(path, self.location.origin).href;
}

// Resolves with the promise's result, or rejects after `ms`
// milliseconds, whichever comes first (standard Promise.race timeout).
function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
  ]);
}

// Download one URL and store it. `cache: "reload"` skips the browser's
// own HTTP cache so we store the real current file. Never throws:
// returns true/false so one failure doesn't stop the rest.
async function storeOne(cache, url, key = url) {
  try {
    // 15 s limit per file, so a check on weak signal can't hang.
    const response = await withTimeout(fetch(url, { cache: "reload" }), 15000);
    if (!response.ok) return false;
    await cache.put(key, response);
    return true;
  } catch (err) {
    return false;
  }
}

// The fonts: fetch the stylesheet, pull every font-file address out of
// it (they look like url(https://fonts.gstatic.com/...woff2)), and store
// the stylesheet and each file. The stylesheet differs by browser, and
// this request comes from the same browser as the pages, so it's the
// right one for this phone.
async function precacheFonts(cdn) {
  try {
    const response = await fetch(FONTS_CSS, { cache: "reload" });
    if (!response.ok) return false;
    const css = await response.clone().text();
    await cdn.put(FONTS_CSS, response);
    const fontUrls = [...css.matchAll(/url\((https:\/\/fonts\.gstatic\.com\/[^)]+)\)/g)].map((m) => m[1]);
    const results = await Promise.all(
      fontUrls.map(async (url) => (await cdn.match(url)) || storeOne(cdn, url))
    );
    return results.every(Boolean);
  } catch (err) {
    return false;
  }
}

// Download everything in the lists that isn't stored yet. Returns the
// list of OUR files still missing afterwards (empty = all stored).
// `force` re-downloads even stored files (used at install, so a new
// version starts fresh).
async function precacheAll({ force = false } = {}) {
  const app = await caches.open(APP_CACHE);
  const cdn = await caches.open(CDN_CACHE);
  await Promise.all([
    ...PRECACHE_FILES.map(async (path) => {
      const url = new URL(path, self.location.origin).href;
      if (!force && (await app.match(appKey(url)))) return;
      await storeOne(app, url, appKey(url));
    }),
    ...PRECACHE_CDN.map(async (url) => {
      if (await cdn.match(url)) return;   // versioned: never needs refreshing
      await storeOne(cdn, url);
    }),
    (async () => {
      if (force || !(await cdn.match(FONTS_CSS))) await precacheFonts(cdn);
    })(),
  ]);
  return missingFiles();
}

// Which of our files and Firebase's files aren't stored yet.
async function missingFiles() {
  const app = await caches.open(APP_CACHE);
  const cdn = await caches.open(CDN_CACHE);
  const missing = [];
  for (const path of PRECACHE_FILES) {
    if (!(await app.match(appKey(new URL(path, self.location.origin).href)))) missing.push(path);
  }
  for (const url of [...PRECACHE_CDN, FONTS_CSS]) {
    if (!(await cdn.match(url))) missing.push(url);
  }
  return missing;
}

// ------------------------------------------------------------------
// INSTALL: pre-download, best effort. (The existing install handler
// above still calls skipWaiting; the browser runs both handlers and
// waits for this one's download before finishing the install.)
// ------------------------------------------------------------------
self.addEventListener("install", (event) => {
  event.waitUntil(precacheAll({ force: true }).catch(() => {}));
});

// ------------------------------------------------------------------
// ACTIVATE: delete stores left over from older CACHE_VERSIONs, so old
// copies never linger. (The existing activate handler above still
// calls clients.claim.)
// ------------------------------------------------------------------
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith("cup-app-v") && name !== APP_CACHE).map((name) => caches.delete(name))
      );
    })()
  );
});

// ------------------------------------------------------------------
// FETCH: decide where each request is answered from.
// ------------------------------------------------------------------

// Network-first with a time limit, for files that can change.
async function networkFirst(event, cacheName, key) {
  const cache = await caches.open(cacheName);

  // Start the download now. Whenever it finishes, even after we've
  // given up waiting for it, store the fresh copy for next time.
  // event.waitUntil keeps the worker alive until that's done.
  const network = fetch(event.request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(cache.put(key, copy).catch(() => {}));
    }
    return response;
  });
  event.waitUntil(network.catch(() => {}));

  // Recently timed out: don't wait again, use the stored copy at once
  // (the download above still refreshes it in the background).
  if (Date.now() < badSignalUntil) {
    const stored = await cache.match(key);
    if (stored) return stored;
  }

  try {
    return await withTimeout(network, NETWORK_TIMEOUT_MS);
  } catch (err) {
    // Network failed or was too slow.
    if (err.message === "timeout") badSignalUntil = Date.now() + BAD_SIGNAL_WINDOW_MS;
    const stored = await cache.match(key);
    if (stored) return stored;
    // Nothing stored: all we can do is keep waiting for the network
    // (or let it fail, which shows the browser's normal offline page).
    return network;
  }
}

// Cache-first, for versioned files that never change.
async function cacheFirst(event, cacheName) {
  const cache = await caches.open(cacheName);
  const stored = await cache.match(event.request.url);
  if (stored) return stored;
  const response = await fetch(event.request);
  if (response.ok || response.type === "opaque") {
    event.waitUntil(cache.put(event.request.url, response.clone()).catch(() => {}));
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;   // only downloads are cached
  const url = new URL(request.url);

  if (url.origin === self.location.origin) {
    // Never intercept this worker's own file (the browser handles
    // worker updates itself) or Firebase Hosting's reserved /__/ URLs.
    if (url.pathname === "/firebase-messaging-sw.js" || url.pathname.startsWith("/__/")) return;
    event.respondWith(networkFirst(event, APP_CACHE, appKey(request.url)));
    return;
  }
  if (request.url.startsWith(FIREBASE_SDK) || url.hostname === "fonts.gstatic.com") {
    event.respondWith(cacheFirst(event, CDN_CACHE));
    return;
  }
  if (url.hostname === "fonts.googleapis.com") {
    event.respondWith(networkFirst(event, CDN_CACHE, request.url));
    return;
  }
  // Anything else (database, sign-in, other sites): not our business.
});

// Re-check EVERY app file with the server and replace the stored copies,
// all or nothing. Without this, a stored file is refreshed only when a
// page happens to ask for it, so someone who only opens Home could keep
// an old round.js next to a new match-ui.js after a deploy, and the round
// page could break on the course. "no-cache" means "ask the server
// whether my copy is current": unchanged files come back as tiny "not
// modified" replies (the browser fills in the body), so this is cheap.
// All or nothing: download everything first, store only if EVERY
// download worked, so a dropped signal can't leave a mix of old and new.
async function refreshAll() {
  const urls = PRECACHE_FILES.map((path) => new URL(path, self.location.origin).href);
  const responses = await Promise.all(
    urls.map((url) => withTimeout(fetch(url, { cache: "no-cache" }), 15000))
  );
  if (!responses.every((response) => response.ok)) throw new Error("some downloads failed");
  const app = await caches.open(APP_CACHE);
  await Promise.all(urls.map((url, i) => app.put(appKey(url), responses[i])));
}

// ------------------------------------------------------------------
// MESSAGE: a page asks "how ready are we?" (js/offline-ready.js). The
// worker tries to fill any gaps first, then answers with the list of
// files still missing. The answer goes back on the MessageChannel port
// the page sent (standard way to reply to one specific message).
// ------------------------------------------------------------------
self.addEventListener("message", (event) => {
  // "refresh-all": sent by js/offline-ready.js after each hourly data
  // warm-up (so only while connected). No reply needed.
  if (event.data && event.data.type === "refresh-all") {
    event.waitUntil(refreshAll().catch(() => {}));
    return;
  }
  if (!event.data || event.data.type !== "offline-status") return;
  const port = event.ports && event.ports[0];
  if (!port) return;
  event.waitUntil(
    precacheAll()
      .then((missing) => port.postMessage({ ok: true, missing, total: PRECACHE_FILES.length }))
      .catch((err) => port.postMessage({ ok: false, error: String(err) }))
  );
});

// ------------------------------------------------------------------
// Firebase Messaging SDK (compat build, the one Firebase recommends
// for service workers that aren't bundled). Same 11.3.1 version as
// the rest of the site. We load it for its housekeeping, mainly
// renewing the browser's push subscription if the browser rotates it,
// and deliberately do NOT call messaging.onBackgroundMessage: display
// is handled entirely by our "push" handler above.
// ------------------------------------------------------------------
importScripts("https://www.gstatic.com/firebasejs/11.3.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/11.3.1/firebase-messaging-compat.js");

// Copy of the config in js/firebase-init.js (not a secret; see the
// comment there). Keep the two in sync if the project ever changes.
firebase.initializeApp({
  apiKey: "AIzaSyC0KrMbs0fJ75SJYMskeqv8ytB7Id382Xs",
  authDomain: "golf-tracker-data.firebaseapp.com",
  projectId: "golf-tracker-data",
  storageBucket: "golf-tracker-data.firebasestorage.app",
  messagingSenderId: "607235998741",
  appId: "1:607235998741:web:d4a2ffc9f320e83d2b7a1c",
});
firebase.messaging();
