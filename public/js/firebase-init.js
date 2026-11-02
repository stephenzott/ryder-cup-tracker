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
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js";

const app = initializeApp(firebaseConfig);

// This project's Firestore free-tier "(default)" database is already
// used by another one of your apps, so this app lives in its own
// NAMED database within the same project instead. getFirestore's
// second argument picks which database to connect to — omitting it
// would silently connect to "(default)" and find nothing here.
const DATABASE_ID = "ryder-cup-tracker";

// These two objects are the handles every other script in the app uses
// to talk to Firestore (the database) and Auth (anonymous sign-in).
// Exporting them here means every page sets this up exactly once, the
// same way.
export const db = getFirestore(app, DATABASE_ID);
export const auth = getAuth(app);
