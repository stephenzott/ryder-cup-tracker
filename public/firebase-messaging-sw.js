// Service worker for push notifications.
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
