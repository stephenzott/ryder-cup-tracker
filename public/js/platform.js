// What device and browser is this page running in?
//
// Push notifications work differently on iPhone, Android and desktop,
// and some browsers (or apps' built-in browsers) can't do them at all,
// so the Alerts page needs to know where it is to give the right help.
//
// HOW: almost everything here reads navigator.userAgent, a line of text
// every browser sends describing itself, e.g.
//   "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) ... CriOS/131 ..."
// Reading it ("user-agent sniffing") is a common, admittedly imperfect
// workaround (standard practice for exactly this kind of help text):
// browsers offer no clean "which browser/app am I?" check, and some
// copy each other's text for compatibility. So:
//   - order matters (more specific names are checked first), and
//   - these results are only used to choose WHICH HELP TO SHOW, never
//     to block something that would otherwise work.
//
// Nothing in this file touches the page or Firebase; it only answers
// questions, so any page can import it.

function ua() {
  return navigator.userAgent || "";
}

// ------------------------------------------------------------------
// Operating system
// ------------------------------------------------------------------

// iPhone or iPad? iPads running iPadOS 13+ pretend to be a Mac in their
// user-agent text, so "Mac + touchscreen" also counts as an iPad.
export function isIOS() {
  return /iPad|iPhone|iPod/.test(ua()) || (/Macintosh/.test(ua()) && navigator.maxTouchPoints > 1);
}

// Android phones and tablets say "Android" in their user-agent text.
export function isAndroid() {
  return /Android/.test(ua());
}

// The short label saved with a push subscription, so the server (and
// anyone debugging) knows what kind of device it is.
//   "ios" | "android" | "other"
export function platformKey() {
  if (isIOS()) return "ios";
  if (isAndroid()) return "android";
  return "other";
}

// ------------------------------------------------------------------
// Installed?
// ------------------------------------------------------------------

// Opened as an installed app (from the Home Screen icon) rather than in
// a browser tab? The manifest asks for "standalone" display, and the
// CSS media query "(display-mode: standalone)" is true when that's in
// effect. iOS also has an older navigator.standalone flag, checked as
// a backup.
export function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

// ------------------------------------------------------------------
// Browser family
// ------------------------------------------------------------------

// Which browser, as a display name:
//   "Safari" | "Chrome" | "Samsung Internet" | "Firefox" | "Edge" | "Other"
//
// On iPhone every browser is Safari underneath (Apple requires it), and
// the others add their own marker: CriOS = Chrome, FxiOS = Firefox,
// EdgiOS = Edge. Elsewhere, Edge and Samsung Internet also say
// "Chrome" in their text (they're built on Chrome's engine), so they
// must be checked BEFORE Chrome.
export function browserFamily() {
  const s = ua();
  if (isIOS()) {
    if (/CriOS/.test(s)) return "Chrome";
    if (/FxiOS/.test(s)) return "Firefox";
    if (/EdgiOS/.test(s)) return "Edge";
    // Plain Safari says "Safari" and "Version/"; an in-app browser or
    // the Home Screen app may not, but it's still Safari's engine.
    return "Safari";
  }
  if (/SamsungBrowser/.test(s)) return "Samsung Internet";
  if (/Edg(e|A)?\//.test(s)) return "Edge";
  if (/Firefox\//.test(s)) return "Firefox";
  if (/Chrome\/|Chromium\//.test(s)) return "Chrome";
  if (/Safari\//.test(s)) return "Safari";
  return "Other";
}

// Brave looks exactly like Chrome in its user-agent text on purpose,
// but it adds a `navigator.brave` object, which is the check Brave
// itself documents for sites.
export function isBrave() {
  return typeof navigator.brave !== "undefined";
}

// ------------------------------------------------------------------
// In-app browsers
// ------------------------------------------------------------------

// The markers that apps add when they open a link in their OWN built-in
// browser instead of Safari/Chrome:
//   FBAN / FBAV   Facebook        Instagram   Instagram
//   Messenger     Messenger       Snapchat    Snapchat
//   LinkedIn      LinkedIn        Line/       LINE (with the slash, so
//                                             "Linux" doesn't match)
//   GSA/          the Google app on iPhone
// On Android, an app's embedded browser ("WebView") adds "; wv)".
// These built-in browsers can't add to the Home Screen or receive push,
// so the Alerts page asks people to reopen the link in a real browser.
const IN_APP_PATTERN = /FBAN|FBAV|Instagram|Messenger|Snapchat|LinkedIn|Line\/|GSA\//;
const ANDROID_WEBVIEW_PATTERN = /Android.*; wv\)/;

export function isInAppBrowser() {
  return IN_APP_PATTERN.test(ua()) || ANDROID_WEBVIEW_PATTERN.test(ua());
}
