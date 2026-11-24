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

let alice, bob, nobody;
before(() => {
  alice = firestoreAs("alice");
  bob = firestoreAs("bob");
  nobody = firestoreAs(null);
});

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

// ==================================================================
// EXISTING RULES STILL BEHAVE AS BEFORE (spot checks)
// ==================================================================

test("players: anyone can still read the roster", () => allowed(getDocs(collection(nobody, "players"))));
test("players: a non-admin still cannot write", () =>
  denied(setDoc(doc(alice, "players", "p1"), { name: "Test" })));
test("secrets: still unreadable", () => denied(getDoc(doc(alice, "secrets", "config"))));
