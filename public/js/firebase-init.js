// This file connects every page of the app to your specific Firebase
// project. It's the one file you MUST edit after creating that project
// in the Firebase console — see the setup checklist for where to find
// these values (Project settings → General → "Your apps" → Web app).
//
// Unlike a traditional API key, this config is NOT a secret — it's
// normal for it to be visible in a public website's source code.
// Firebase's real access control lives in firestore.rules, not here.
const firebaseConfig = {
  apiKey: "AIzaSyC0KrMbs0fJ75SJYMskeqv8ytB7Id382Xs",
  authDomain: "golf-tracker-data.firebaseapp.com",
  projectId: "golf-tracker-data",
  storageBucket: "golf-tracker-data.firebasestorage.app",
  messagingSenderId: "607235998741",
  appId: "1:607235998741:web:d4a2ffc9f320e83d2b7a1c",
};

// We use Firebase's "modular" SDK, loaded straight from Google's CDN as
// ES modules — no npm install, no bundler, just <script type="module">
// tags in each HTML page. That keeps this a plain static site that any
// browser can run directly.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-app.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  connectFirestoreEmulator,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { getAuth, connectAuthEmulator } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js";

const app = initializeApp(firebaseConfig);

// This project's Firestore free-tier "(default)" database is already
// used by another one of your apps, so this app lives in its own
// NAMED database within the same project instead. initializeFirestore's
// third argument picks which database to connect to — omitting it
// would silently connect to "(default)" and find nothing here.
const DATABASE_ID = "ryder-cup-tracker";

// These two objects are the handles every other script in the app uses
// to talk to Firestore (the database) and Auth (anonymous sign-in).
// Exporting them here means every page sets this up exactly once, the
// same way.
//
// OFFLINE CACHE (offline project, stage 1). By default Firestore keeps
// its local copy of the data, and its queue of not-yet-sent writes, in
// the page's memory only, so closing or reloading the page throws both
// away. "persistentLocalCache" keeps them in IndexedDB instead (a small
// database each browser keeps on the phone for each website), so:
//   - a score saved with no signal survives the app being closed and
//     is sent the next time the app is open with signal, and
//   - pages show the last scores this phone saw straight away, even
//     before (or without) reaching the server.
// "persistentMultipleTabManager" lets several tabs of the site share
// that one on-phone cache safely (the alternative, single-tab, makes a
// second tab fail to use the cache at all). If a browser can't offer
// IndexedDB (some private-browsing modes), Firestore logs a warning and
// quietly falls back to the old memory-only behavior, so nothing breaks.
export const db = initializeFirestore(
  app,
  { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) },
  DATABASE_ID
);
export const auth = getAuth(app);

// ------------------------------------------------------------------
// Local testing only: when a page is opened from this computer (the
// Firebase hosting emulator at 127.0.0.1 / localhost), point Firestore
// and Auth at the local emulators, so testing can NEVER read or write
// the live database. On the real site the hostname is different, so
// these lines never run there.
//
// This used to live only in alerts.js, which meant every other page
// opened locally talked to the LIVE database. It's here now so that
// every page gets it, and gets it before anything reads or writes:
// Firestore only lets you change where it connects before its first
// use, and this file always runs before any page's own code.
// ------------------------------------------------------------------
export const IS_LOCAL = ["localhost", "127.0.0.1"].includes(location.hostname);

if (IS_LOCAL) {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
}
