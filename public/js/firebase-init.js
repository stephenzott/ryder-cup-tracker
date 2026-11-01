// This file connects every page of the app to your specific Firebase
// project. It's the one file you MUST edit after creating that project
// in the Firebase console — see the setup checklist for where to find
// these values (Project settings → General → "Your apps" → Web app).
//
// Unlike a traditional API key, this config is NOT a secret — it's
// normal for it to be visible in a public website's source code.
// Firebase's real access control lives in firestore.rules, not here.
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

// We use Firebase's "modular" SDK, loaded straight from Google's CDN as
// ES modules — no npm install, no bundler, just <script type="module">
// tags in each HTML page. That keeps this a plain static site that any
// browser can run directly.
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.3.1/firebase-auth.js";

const app = initializeApp(firebaseConfig);

// These two objects are the handles every other script in the app uses
// to talk to Firestore (the database) and Auth (anonymous sign-in).
// Exporting them here means every page sets this up exactly once, the
// same way.
export const db = getFirestore(app);
export const auth = getAuth(app);
