// Tests for score-log.js (the score-change log's "what changed?" logic).
// Run from functions/ with:  npm test
// node:test is Node's built-in test runner; each test passes if its
// function finishes without throwing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { diffHoles, describeWho, pickUid } from "../score-log.js";

const T = Date.UTC(2027, 5, 10, 15, 0, 0);   // a plausible tap time

test("first entry of a hole: before null, not CHANGED, tap time kept", () => {
  const edits = diffHoles({ holes: {} }, { holes: { 7: { a: 5, b: 4, t: T } } });
  assert.deepEqual(edits, [{ hole: 7, before: null, after: { a: 5, b: 4 }, changed: false, tappedAtMs: T, phoneUid: null }]);
});

test("a real correction is CHANGED", () => {
  const edits = diffHoles({ holes: { 7: { a: 5, b: 4 } } }, { holes: { 7: { a: 5, b: 5, t: T } } });
  assert.equal(edits.length, 1);
  assert.equal(edits[0].changed, true);
  assert.deepEqual(edits[0].before, { a: 5, b: 4 });
  assert.deepEqual(edits[0].after, { a: 5, b: 5 });
});

test("filling in the other side (was empty) is logged but not CHANGED", () => {
  const edits = diffHoles({ holes: { 3: { a: 4, b: null } } }, { holes: { 3: { a: 4, b: 5, t: T } } });
  assert.equal(edits.length, 1);
  assert.equal(edits[0].changed, false);
});

test("re-saving the same numbers (only tap time differs) is skipped", () => {
  const edits = diffHoles({ holes: { 3: { a: 4, b: 5, t: T - 1000 } } }, { holes: { 3: { a: 4, b: 5, t: T } } });
  assert.deepEqual(edits, []);
});

test("pairing or strokes changes (no hole numbers changed) log nothing", () => {
  const before = { sideA: ["x"], sideB: ["y"], holes: { 1: { a: 4, b: 4 } } };
  const after = { sideA: ["x"], sideB: ["z"], strokesGiven: { z: [3] }, holes: { 1: { a: 4, b: 4 } } };
  assert.deepEqual(diffHoles(before, after), []);
});

test("best ball: one player's number changed is CHANGED", () => {
  const edits = diffHoles({ holes: { 5: { a: [4, 5], b: [5, 5] } } }, { holes: { 5: { a: [4, 6], b: [5, 5] } } });
  assert.equal(edits[0].changed, true);
});

test("best ball: filling in a missing player's number is not CHANGED", () => {
  const edits = diffHoles({ holes: { 5: { a: [4, null], b: [5, 5] } } }, { holes: { 5: { a: [4, 6], b: [5, 5] } } });
  assert.equal(edits.length, 1);
  assert.equal(edits[0].changed, false);
});

test("several holes at once come back in hole order", () => {
  const edits = diffHoles({}, { holes: { 9: { a: 4, b: 4 }, 2: { a: 3, b: 4 } } });
  assert.deepEqual(edits.map((e) => e.hole), [2, 9]);
});

test("a hole removed entirely (e.g. in the console) is logged with after null", () => {
  const edits = diffHoles({ holes: { 4: { a: 4, b: 5 } } }, { holes: {} });
  assert.deepEqual(edits[0].after, null);
  assert.equal(edits[0].changed, true);
});

test("missing or silly tap times become null", () => {
  assert.equal(diffHoles({}, { holes: { 1: { a: 4, b: 4 } } })[0].tappedAtMs, null);
  assert.equal(diffHoles({}, { holes: { 1: { a: 4, b: 4, t: "soon" } } })[0].tappedAtMs, null);
  assert.equal(diffHoles({}, { holes: { 1: { a: 4, b: 4, t: 5 } } })[0].tappedAtMs, null);
});

test("who: a player, an admin, an unknown browser, the console, not reported", () => {
  assert.deepEqual(describeWho("app_user", { level: "score", playerId: "p1", playerName: "Sam Smith" }, "uid1"), {
    level: "score",
    playerId: "p1",
    whoName: "Sam Smith",
  });
  assert.equal(describeWho("app_user", { level: "admin", code: "secret" }, "uid1").whoName, "Admin");
  assert.equal(describeWho("app_user", null, "uid1").whoName, "Unknown browser");
  assert.equal(describeWho("service_account", null, null).whoName, "Firebase console / server");
  assert.equal(describeWho(undefined, null, null).whoName, "Unknown (not reported)");
  // Not reported by the server, but the phone stamped its id: name found.
  assert.equal(describeWho(undefined, { level: "score", playerName: "Ben Brown" }, "uid2").whoName, "Ben Brown");
});

test("pickUid: server-reported browser wins; phone stamp is the backup", () => {
  assert.deepEqual(pickUid("app_user", "srv", "phn"), { uid: "srv", source: "server" });
  assert.deepEqual(pickUid(undefined, undefined, "phn"), { uid: "phn", source: "phone" });
  assert.deepEqual(pickUid("service_account", undefined, null), { uid: null, source: null });
});

test("phone-stamped browser id is read from the hole", () => {
  assert.equal(diffHoles({}, { holes: { 1: { a: 4, b: 4, u: "abc" } } })[0].phoneUid, "abc");
});

test("who: the admin code is never copied", () => {
  const who = describeWho("app_user", { level: "admin", code: "secret" }, "uid1");
  assert.ok(!JSON.stringify(who).includes("secret"));
});
