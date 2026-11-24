// Tests for the pushSubscriptions block in ../../firestore.rules.
//
// HOW TO RUN (from the functions/ folder):
//   npm run test:rules
// That starts a throwaway LOCAL Firestore emulator, loads firestore.rules
// into it (for the named database "ryder-cup-tracker", as configured in
// firebase.json), runs this file, and shuts the emulator down. The
// project id "demo-ryder-rules" starts with "demo-", which Firebase
// treats as offline-only: nothing here can touch the real project.
//
// HOW IT WORKS: each "person" is a separate Firebase app connected to
// the emulator with a fake sign-in (mockUserToken), so the rules see a
// different request.auth.uid for each. Every test does one read or
// write and checks that the rules allow it or reject it.
//
// node:test is Node's built-in test runner (standard tooling, no extra
// library): test("name", fn) registers a test; it passes if fn finishes
// without throwing.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { initializeApp, deleteApp } from "firebase/app";
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  getDocs,
  collection,
  serverTimestamp,
  terminate,
} from "firebase/firestore";

const PROJECT_ID = "demo-ryder-rules";
const DATABASE_ID = "ryder-cup-tracker";
const [HOST, PORT] = (process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080").split(":");

// ------------------------------------------------------------------
// One Firestore handle per pretend user. uid = null means "not signed in".
// ------------------------------------------------------------------
const apps = [];
function firestoreAs(uid) {
  const app = initializeApp({ projectId: PROJECT_ID }, `app-${uid ?? "anon"}-${apps.length}`);
  apps.push(app);
  const db = getFirestore(app, DATABASE_ID);
  connectFirestoreEmulator(db, HOST, Number(PORT), uid ? { mockUserToken: { user_id: uid } } : {});
  return db;
}

let alice, bob, carol, nobody;
before(() => {
  alice = firestoreAs("alice");
  bob = firestoreAs("bob");
  carol = firestoreAs("carol");
  nobody = firestoreAs(null);
});

// Plant a document exactly as stage 1 wrote it (six keys, no platform
// or installed), the way existing phones' documents look in the live
// database. It's written through the emulator's admin back door
// ("Bearer owner" skips the rules), since the rules themselves no
// longer allow writing this old shape.
async function plantOldSixKeyDoc(uid) {
  const url = `http://${HOST}:${PORT}/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/pushSubscriptions/${uid}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        enabled: { booleanValue: true },
        token: { stringValue: "old-token" },
        playerId: { stringValue: "player-1" },
        level: { stringValue: "segment" },
        scope: { stringValue: "all" },
        updatedAt: { timestampValue: "2026-11-23T12:00:00Z" },
      },
    }),
  });
  assert.equal(res.status, 200);
}

after(async () => {
  for (const app of apps) {
    await terminate(getFirestore(app, DATABASE_ID));
    await deleteApp(app);
  }
});

// ------------------------------------------------------------------
// Helpers: expect an operation to be allowed / rejected by the rules.
// A rejection shows up as an error with code "permission-denied".
// ------------------------------------------------------------------
async function allowed(promise) {
  await promise;
}

async function denied(promise) {
  await assert.rejects(promise, (err) => err.code === "permission-denied");
}

// A valid document, as alerts.js writes it. Tests copy it and break one
// thing at a time.
function valid(overrides = {}) {
  return {
    enabled: true,
    token: "fake-token-abc",
    playerId: "player-1",
    level: "segment",
    scope: "all",
    platform: "ios",
    installed: true,
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

const aliceDoc = (db) => doc(db, "pushSubscriptions", "alice");

// ==================================================================
// ALLOWED
// ==================================================================

test("owner can create their own valid document", () => allowed(setDoc(aliceDoc(alice), valid())));

test("owner can read their own document", async () => {
  await setDoc(aliceDoc(alice), valid());
  const snap = await getDoc(aliceDoc(alice));
  assert.equal(snap.data().level, "segment");
});

test("owner can update their own document (full rewrite)", () =>
  allowed(setDoc(aliceDoc(alice), valid({ level: "hole", scope: "mine" }))));

test("owner can update with updateDoc when the result is still valid", () =>
  allowed(updateDoc(aliceDoc(alice), { level: "final", updatedAt: serverTimestamp() })));

test("switched-off shape is valid: enabled=false, empty token, no player yet", () =>
  allowed(setDoc(aliceDoc(alice), valid({ enabled: false, token: "", playerId: "" }))));

test("every allowed level and scope value is accepted", async () => {
  for (const level of ["hole", "segment", "final"]) {
    for (const scope of ["mine", "opposing", "all"]) {
      await setDoc(aliceDoc(alice), valid({ level, scope }));
    }
  }
});

test("every allowed platform value and both installed values are accepted", async () => {
  for (const platform of ["ios", "android", "other"]) {
    for (const installed of [true, false]) {
      await setDoc(aliceDoc(alice), valid({ platform, installed }));
    }
  }
});

test("token of 4095 characters is accepted (just under the limit)", () =>
  allowed(setDoc(aliceDoc(alice), valid({ token: "x".repeat(4095) }))));

test("owner can delete their own document", async () => {
  await setDoc(aliceDoc(alice), valid());
  await allowed(deleteDoc(aliceDoc(alice)));
});

// ==================================================================
// DENIED: someone else's document, or not signed in
// ==================================================================

test("another user cannot read someone else's document", async () => {
  await setDoc(aliceDoc(alice), valid());
  await denied(getDoc(aliceDoc(bob)));
});

test("another user cannot create/overwrite someone else's document", () =>
  denied(setDoc(aliceDoc(bob), valid())));

test("another user cannot update someone else's document", async () => {
  await setDoc(aliceDoc(alice), valid());
  await denied(updateDoc(aliceDoc(bob), { level: "hole", updatedAt: serverTimestamp() }));
});

test("another user cannot delete someone else's document", async () => {
  await setDoc(aliceDoc(alice), valid());
  await denied(deleteDoc(aliceDoc(bob)));
});

test("not signed in: cannot read", () => denied(getDoc(aliceDoc(nobody))));
test("not signed in: cannot write", () => denied(setDoc(aliceDoc(nobody), valid())));

test("nobody can list the whole collection (would expose everyone's tokens)", () =>
  denied(getDocs(collection(alice, "pushSubscriptions"))));

// ==================================================================
// DENIED: wrong shape (each breaks exactly one thing)
// ==================================================================

test("extra key (team) is rejected", () => denied(setDoc(aliceDoc(alice), valid({ team: "A" }))));

test("missing key (no scope) is rejected", () => {
  const d = valid();
  delete d.scope;
  return denied(setDoc(aliceDoc(alice), d));
});

test("missing updatedAt is rejected", () => {
  const d = valid();
  delete d.updatedAt;
  return denied(setDoc(aliceDoc(alice), d));
});

test("enabled as a string is rejected", () => denied(setDoc(aliceDoc(alice), valid({ enabled: "true" }))));
test("level outside the list is rejected", () => denied(setDoc(aliceDoc(alice), valid({ level: "everything" }))));
test("scope outside the list is rejected", () => denied(setDoc(aliceDoc(alice), valid({ scope: "both" }))));
test("token of 4096 characters is rejected (at the limit)", () =>
  denied(setDoc(aliceDoc(alice), valid({ token: "x".repeat(4096) }))));
test("token as a number is rejected", () => denied(setDoc(aliceDoc(alice), valid({ token: 12345 }))));
test("playerId as a number is rejected", () => denied(setDoc(aliceDoc(alice), valid({ playerId: 7 }))));
test("updatedAt set by the phone's own clock is rejected", () =>
  denied(setDoc(aliceDoc(alice), valid({ updatedAt: new Date("2020-01-01") }))));

test("updateDoc that adds an extra key is rejected", async () => {
  await setDoc(aliceDoc(alice), valid());
  await denied(updateDoc(aliceDoc(alice), { team: "A", updatedAt: serverTimestamp() }));
});

test("platform outside the list is rejected", () =>
  denied(setDoc(aliceDoc(alice), valid({ platform: "windows" }))));
test("installed as a string is rejected", () =>
  denied(setDoc(aliceDoc(alice), valid({ installed: "yes" }))));

test("missing platform is rejected", () => {
  const d = valid();
  delete d.platform;
  return denied(setDoc(aliceDoc(alice), d));
});

test("missing installed is rejected", () => {
  const d = valid();
  delete d.installed;
  return denied(setDoc(aliceDoc(alice), d));
});

test("old six-key write (stage 1 shape) is now rejected", () => {
  const d = valid();
  delete d.platform;
  delete d.installed;
  return denied(setDoc(aliceDoc(alice), d));
});

// ==================================================================
// OLD SIX-KEY DOCUMENTS ALREADY IN THE DATABASE
// ==================================================================

const carolDoc = (db) => doc(db, "pushSubscriptions", "carol");

test("an existing six-key document is still readable by its owner", async () => {
  await plantOldSixKeyDoc("carol");
  const snap = await getDoc(carolDoc(carol));
  assert.equal(snap.data().token, "old-token");
  assert.equal(snap.data().platform, undefined);
});

test("an existing six-key document is still private from others", async () => {
  await plantOldSixKeyDoc("carol");
  await denied(getDoc(carolDoc(bob)));
});

test("a partial update that leaves it at six keys is rejected", async () => {
  await plantOldSixKeyDoc("carol");
  await denied(updateDoc(carolDoc(carol), { level: "hole", updatedAt: serverTimestamp() }));
});

test("the page's full eight-key rewrite upgrades it", async () => {
  await plantOldSixKeyDoc("carol");
  await allowed(setDoc(carolDoc(carol), valid({ platform: "android", installed: false })));
  const snap = await getDoc(carolDoc(carol));
  assert.equal(snap.data().platform, "android");
});

test("an existing six-key document can still be deleted by its owner", async () => {
  await plantOldSixKeyDoc("carol");
  await allowed(deleteDoc(carolDoc(carol)));
});

// ==================================================================
// SERVER-ONLY COLLECTIONS (used by the Cloud Function, no client rules)
// No rule mentions them, so Firestore's default applies: deny all.
// ==================================================================

for (const [name, docId] of [
  ["notificationLog", "round1_match1_hole7"],
  ["notificationConfig", "global"],
  ["testPushLimits", "alice"], // even "your own" uid's document
]) {
  test(`${name}: a signed-in browser cannot read`, () => denied(getDoc(doc(alice, name, docId))));
  test(`${name}: a signed-in browser cannot write`, () =>
    denied(setDoc(doc(alice, name, docId), { enabled: true })));
  test(`${name}: a signed-in browser cannot delete`, () => denied(deleteDoc(doc(alice, name, docId))));
  test(`${name}: not signed in cannot read`, () => denied(getDoc(doc(nobody, name, docId))));
  test(`${name}: nobody can list it`, () => denied(getDocs(collection(alice, name))));
}

// ==================================================================
// EXISTING RULES STILL BEHAVE AS BEFORE (spot checks)
// ==================================================================

test("players: anyone can still read the roster", () => allowed(getDocs(collection(nobody, "players"))));
test("players: a non-admin still cannot write", () =>
  denied(setDoc(doc(alice, "players", "p1"), { name: "Test" })));
test("secrets: still unreadable", () => denied(getDoc(doc(alice, "secrets", "config"))));

// ==================================================================
// SCORE-CHANGE LOG (Prompt 4): scoreEdits
// Admin-code browsers can read; nobody can write, edit or delete.
// ==================================================================

// Write a document through the emulator's admin back door (skips rules),
// the way the Cloud Function writes for real.
async function plantAsServer(path, fields) {
  const url = `http://${HOST}:${PORT}/v1/projects/${PROJECT_ID}/databases/${DATABASE_ID}/documents/${path}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify({ fields }),
  });
  assert.equal(res.status, 200);
}

let adminDb, playerDb;
before(async () => {
  // The secret admin code, a log entry, and two browsers: "dave" unlocks
  // with the right admin code, "erin" picks a player (score level).
  await plantAsServer("secrets/config", { adminCode: { stringValue: "letmein" } });
  await plantAsServer("scoreEdits/evt1_h7", {
    roundId: { stringValue: "round1" },
    hole: { integerValue: "7" },
    whoName: { stringValue: "Sam Smith" },
  });
  adminDb = firestoreAs("dave");
  playerDb = firestoreAs("erin");
  await setDoc(doc(adminDb, "unlocks", "dave"), { level: "admin", code: "letmein" });
  await setDoc(doc(playerDb, "unlocks", "erin"), { level: "score", playerId: "p1", playerName: "Sam Smith" });
});

const entry = (db) => doc(db, "scoreEdits", "evt1_h7");

test("scoreEdits: an admin browser can read an entry", () => allowed(getDoc(entry(adminDb))));
test("scoreEdits: an admin browser can list the whole log", () => allowed(getDocs(collection(adminDb, "scoreEdits"))));
test("scoreEdits: a score-level (player) browser cannot read", () => denied(getDoc(entry(playerDb))));
test("scoreEdits: a score-level browser cannot list", () => denied(getDocs(collection(playerDb, "scoreEdits"))));
test("scoreEdits: a browser that never unlocked cannot read", () => denied(getDoc(entry(alice))));
test("scoreEdits: not signed in cannot read", () => denied(getDoc(entry(nobody))));
test("scoreEdits: even an admin cannot create an entry", () =>
  denied(setDoc(doc(adminDb, "scoreEdits", "fake"), { hole: 1 })));
test("scoreEdits: even an admin cannot edit an entry", () => denied(updateDoc(entry(adminDb), { whoName: "Someone else" })));
test("scoreEdits: even an admin cannot delete an entry", () => denied(deleteDoc(entry(adminDb))));
test("scoreEdits: a player cannot create an entry", () =>
  denied(setDoc(doc(playerDb, "scoreEdits", "fake"), { hole: 1 })));
