// Tests for events.js (pure logic, no Firebase, no emulator).
// Run from functions/:   npm test
//
// node:test is Node's built-in test runner: test("name", fn) passes if
// fn finishes without throwing; assert.deepEqual compares whole objects.

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  detectEvents,
  pickEvent,
  teamFromValue,
  formatPoints,
  buildMessage,
  logId,
  matchLabel,
} from "../events.js";

// ------------------------------------------------------------------
// Helpers to build match documents.
// holes(...) turns a list of [holeNumber, aStrokes, bStrokes] into the
// Firestore shape { "7": { a: 4, b: 5 }, ... }.
// ------------------------------------------------------------------
function holes(list) {
  const out = {};
  for (const [h, a, b] of list) out[String(h)] = { a, b };
  return out;
}

// Holes from..to all won by one side: winner "a" -> a:4 b:5,
// "b" -> a:5 b:4, "halved" -> 4/4.
function range(from, to, winner) {
  const list = [];
  for (let h = from; h <= to; h++) {
    list.push(winner === "a" ? [h, 4, 5] : winner === "b" ? [h, 5, 4] : [h, 4, 4]);
  }
  return list;
}

const match = (holeList, extra = {}) => ({ sideA: ["pa1", "pa2"], sideB: ["pb1", "pb2"], holes: holes(holeList), ...extra });

// Short form of an event list for comparisons: "hole7:a", "front:b", "final:-".
const brief = (events) => events.map((e) => `${e.key}:${e.gainTeam ?? "-"}`);

// ==================================================================
// detectEvents
// ==================================================================

test("a newly decided hole gives one hole event for the winner", () => {
  const before = match(range(1, 6, "a"));
  const after = match([...range(1, 6, "a"), [7, 5, 4]]);
  assert.deepEqual(brief(detectEvents(before, after)), ["hole7:b"]);
});

test("a correction to an already-decided hole sends nothing", () => {
  const before = match([...range(1, 6, "a"), [7, 4, 5]]);
  const after = match([...range(1, 6, "a"), [7, 5, 4]]); // winner flipped
  assert.deepEqual(detectEvents(before, after), []);
});

test("a halved hole gives a hole event with no team", () => {
  const before = match(range(1, 6, "a"));
  const after = match([...range(1, 6, "a"), [7, 4, 4]]);
  assert.deepEqual(brief(detectEvents(before, after)), ["hole7:-"]);
});

test("several holes decided in one update: only the highest-numbered counts", () => {
  const before = match(range(1, 2, "a"));
  const after = match([...range(1, 2, "a"), [3, 4, 5], [4, 5, 4], [5, 4, 4]]);
  assert.deepEqual(brief(detectEvents(before, after)), ["hole5:-"]);
});

test("front 9 completes: segment event (sign of the margin) plus the hole", () => {
  // USA wins 1-5, EU wins 6-8 -> USA 2 UP after 8; EU wins 9 -> USA 1 UP.
  const before = match([...range(1, 5, "a"), ...range(6, 8, "b")]);
  const after = match([...range(1, 5, "a"), ...range(6, 8, "b"), [9, 5, 4]]);
  assert.deepEqual(brief(detectEvents(before, after)), ["front:a", "hole9:b"]);
});

test("a halved front 9 gives a segment event with no team", () => {
  const before = match([...range(1, 4, "a"), ...range(5, 8, "b")]);
  const after = match([...range(1, 4, "a"), ...range(5, 8, "b"), [9, 4, 4]]);
  assert.deepEqual(brief(detectEvents(before, after)), ["front:-", "hole9:-"]);
});

test("back 9 completes on its own (front still open): back-9 segment event", () => {
  // Holes 10-18 entered before the front 9 is finished: EU wins the back.
  const before = match([...range(1, 4, "a"), ...range(10, 17, "b")]);
  const after = match([...range(1, 4, "a"), ...range(10, 17, "b"), [18, 5, 4]]);
  const events = detectEvents(before, after);
  assert.deepEqual(brief(events), ["back:b", "hole18:b"]);
  const msg = buildMessage(events[0], { roundId: "round1", matchId: "match3", after, namesById: {} });
  assert.equal(msg.title, "Match 3 back 9: EU wins");
  assert.equal(msg.tag, "round1-match3-back");
});

test("back 9 completes and ends the match: final only (no back-9 segment event)", () => {
  // Front: USA 9 UP. Back: EU wins 10-17, hole 18 halved -> back EU 8 UP.
  // Points: front USA 1, back EU 1, overall USA (9-8=1) 1 -> USA 2, EU 1.
  const before = match([...range(1, 9, "a"), ...range(10, 17, "b")]);
  const after = match([...range(1, 9, "a"), ...range(10, 17, "b"), [18, 4, 4]]);
  assert.deepEqual(brief(detectEvents(before, after)), ["final:a", "hole18:-"]);
});

test("front 9 finished last (holes entered out of order): final only", () => {
  const before = match([...range(10, 18, "b"), ...range(1, 8, "a")]);
  const after = match([...range(10, 18, "b"), ...range(1, 8, "a"), [9, 4, 4]]);
  // Front USA 8 UP (1 pt), back EU 9 UP (1 pt), overall EU 1 UP (1 pt) -> EU 2-1.
  assert.deepEqual(brief(detectEvents(before, after)), ["final:b", "hole9:-"]);
});

test("a final with equal points has no team", () => {
  // Front USA, back EU, overall level -> 1.5 - 1.5.
  const before = match([...range(1, 9, "a"), ...range(10, 17, "b")]);
  const after = match([...range(1, 9, "a"), ...range(10, 17, "b"), [18, 5, 4]]);
  assert.deepEqual(brief(detectEvents(before, after)), ["final:-", "hole18:b"]);
});

test("best ball: a hole is decided only once every player has a score", () => {
  const base = { sideA: ["pa1", "pa2"], sideB: ["pb1", "pb2"] };
  const halfIn = { ...base, holes: { "7": { a: [4, null], b: [5, 5] } } };
  const allIn = { ...base, holes: { "7": { a: [4, 6], b: [5, 5] } } };
  const empty = { ...base, holes: {} };
  // Half the scores in: not decided, nothing to send.
  assert.deepEqual(detectEvents(empty, halfIn), []);
  // Last score in: decided, and the better ball (4) beats 5.
  assert.deepEqual(brief(detectEvents(halfIn, allIn)), ["hole7:a"]);
});

test("a hole decided by strokes given goes to the player getting the stroke", () => {
  // Singles: both shoot 5 gross, but pa1 gets a stroke on 7 -> net 4 vs 5.
  const base = { sideA: ["pa1"], sideB: ["pb1"], strokesGiven: { pa1: [7] } };
  const before = { ...base, holes: {} };
  const after = { ...base, holes: { "7": { a: 5, b: 5 } } };
  assert.deepEqual(brief(detectEvents(before, after)), ["hole7:a"]);
});

test("an update that changes nothing scored (e.g. pairings) sends nothing", () => {
  const before = { sideA: [], sideB: [], holes: {} };
  const after = { sideA: ["pa1"], sideB: ["pb1"], holes: {} };
  assert.deepEqual(detectEvents(before, after), []);
});

// ==================================================================
// Who gets what (pickEvent)
// ==================================================================

// Events from "front 9 completes" above: USA wins the front, EU wins hole 9.
const FRONT_A_HOLE_B = [
  { level: "segment", key: "front", gainTeam: "a" },
  { level: "hole", key: "hole9", hole: 9, gainTeam: "b" },
];
// A halved hole on its own.
const HALVED_HOLE = [{ level: "hole", key: "hole7", hole: 7, gainTeam: null }];
// The match ends: final won by USA, last hole halved.
const FINAL_A = [
  { level: "final", key: "final", gainTeam: "a" },
  { level: "hole", key: "hole18", hole: 18, gainTeam: null },
];

const pick = (events, level, scope, team) => pickEvent(events, { level, scope }, team)?.key ?? null;

test("USA player, scope mine: gets USA events only", () => {
  assert.equal(pick(FRONT_A_HOLE_B, "hole", "mine", "a"), "front");
  assert.equal(pick(FRONT_A_HOLE_B, "segment", "mine", "a"), "front");
  assert.equal(pick(FRONT_A_HOLE_B, "final", "mine", "a"), null);
  assert.equal(pick(HALVED_HOLE, "hole", "mine", "a"), null); // halved never reaches "mine"
});

test("EU player, scope mine: the EU hole only (the USA front 9 isn't theirs)", () => {
  assert.equal(pick(FRONT_A_HOLE_B, "hole", "mine", "b"), "hole9");
  assert.equal(pick(FRONT_A_HOLE_B, "segment", "mine", "b"), null);
});

test("EU player, scope opposing: gets USA's events", () => {
  assert.equal(pick(FRONT_A_HOLE_B, "hole", "opposing", "b"), "front");
  assert.equal(pick(FINAL_A, "final", "opposing", "b"), "final");
  assert.equal(pick(HALVED_HOLE, "hole", "opposing", "b"), null); // halved never reaches "opposing"
});

test("USA player, scope opposing: the EU hole only", () => {
  assert.equal(pick(FRONT_A_HOLE_B, "hole", "opposing", "a"), "hole9");
  assert.equal(pick(FRONT_A_HOLE_B, "segment", "opposing", "a"), null);
});

test("scope all gets everything, including halved events", () => {
  assert.equal(pick(HALVED_HOLE, "hole", "all", "a"), "hole7");
  assert.equal(pick(HALVED_HOLE, "segment", "all", "a"), null); // but level still applies
});

test("player with no team: treated as scope all, whatever they chose", () => {
  assert.equal(pick(HALVED_HOLE, "hole", "mine", null), "hole7");
  assert.equal(pick(FRONT_A_HOLE_B, "hole", "opposing", null), "front");
});

test("levels are nested: final-level gets only finals", () => {
  assert.equal(pick(FRONT_A_HOLE_B, "final", "all", "a"), null);
  assert.equal(pick(FINAL_A, "final", "all", "a"), "final");
});

test("one push per subscriber: the highest-priority eligible event wins", () => {
  // A hole-level 'all' subscriber is eligible for both events; final wins.
  assert.equal(pick(FINAL_A, "hole", "all", "a"), "final");
  // Order in the list doesn't matter.
  assert.equal(pick([...FINAL_A].reverse(), "hole", "all", "a"), "final");
});

test("an unknown level sends nothing", () => {
  assert.equal(pick(FINAL_A, "everything", "all", "a"), null);
});

test("team values: A/B (and legacy usa/europe) map to sides, anything else is no team", () => {
  assert.equal(teamFromValue("A"), "a");
  assert.equal(teamFromValue("B"), "b");
  assert.equal(teamFromValue("usa"), "a");
  assert.equal(teamFromValue("europe"), "b");
  assert.equal(teamFromValue(""), null);
  assert.equal(teamFromValue("unconfirmed"), null);
  assert.equal(teamFromValue(undefined), null);
});

// ==================================================================
// Message text
// ==================================================================

test("formatPoints shows halves as ½", () => {
  assert.equal(formatPoints(0), "0");
  assert.equal(formatPoints(0.5), "½");
  assert.equal(formatPoints(1), "1");
  assert.equal(formatPoints(1.5), "1½");
  assert.equal(formatPoints(12.5), "12½");
  assert.equal(formatPoints(3), "3");
});

const NAMES = { pa1: "Sam Smith", pa2: "Jo Jones", pb1: "Ben Brown", pb2: "Lee Lee" };

test("hole message: title, body, shared hole tag, scoreboard url", () => {
  const after = match([...range(1, 6, "a"), [7, 4, 5]]);
  const msg = buildMessage({ level: "hole", key: "hole7", hole: 7, gainTeam: "a" }, { roundId: "round2", matchId: "match2", after, namesById: NAMES });
  assert.deepEqual(msg, {
    title: "USA wins hole 7",
    body: "Match 2 · Smith/Jones vs Brown/Lee\nUSA 7 UP thru 7",
    tag: "round2-match2-hole",
    url: "/scoreboard.html#round2",
  });
});

test("halved hole message", () => {
  const after = match([[1, 4, 5], [2, 5, 4], [3, 4, 4]]);
  const msg = buildMessage({ level: "hole", key: "hole3", hole: 3, gainTeam: null }, { roundId: "round1", matchId: "match1", after, namesById: NAMES });
  assert.equal(msg.title, "Hole 3 halved");
  assert.equal(msg.body, "Match 1 · Smith/Jones vs Brown/Lee\nAll square thru 3");
});

test("segment message", () => {
  const after = match([...range(1, 5, "a"), ...range(6, 8, "b"), [9, 5, 4]]);
  const msg = buildMessage({ level: "segment", key: "front", gainTeam: "a" }, { roundId: "round3", matchId: "match4", after, namesById: NAMES });
  assert.equal(msg.title, "Match 4 front 9: USA wins");
  assert.equal(msg.body, "Smith/Jones vs Brown/Lee\nUSA 1 UP thru 9");
  assert.equal(msg.tag, "round3-match4-front");
});

test("final message reports all three results", () => {
  const after = match([...range(1, 9, "a"), ...range(10, 17, "b"), [18, 4, 4]]);
  const msg = buildMessage({ level: "final", key: "final", gainTeam: "a" }, { roundId: "round2", matchId: "match2", after, namesById: NAMES });
  assert.equal(msg.title, "Match 2 final: USA 2 – EU 1");
  assert.equal(msg.body, "Smith/Jones vs Brown/Lee\nFront USA · Back EU · Overall USA 1 UP");
  assert.equal(msg.tag, "round2-match2-final");
});

test("halved final shows ½ points and Halved overall", () => {
  const after = match([...range(1, 9, "a"), ...range(10, 17, "b"), [18, 5, 4]]);
  const msg = buildMessage({ level: "final", key: "final", gainTeam: null }, { roundId: "round4", matchId: "match8", after, namesById: NAMES });
  assert.equal(msg.title, "Match 8 final: USA 1½ – EU 1½");
  assert.match(msg.body, /Overall Halved$/);
});

test("every message value is a string (FCM requires it)", () => {
  const after = match(range(1, 3, "a"));
  const msg = buildMessage({ level: "hole", key: "hole3", hole: 3, gainTeam: "a" }, { roundId: "round1", matchId: "match1", after, namesById: {} });
  for (const value of Object.values(msg)) assert.equal(typeof value, "string");
  assert.match(msg.body, /\?\/\? vs \?\/\?/); // unknown names fall back to "?"
});

test("singles and unassigned sides read sensibly", () => {
  const after = { sideA: ["pa1"], sideB: [], holes: holes([[1, 4, 5]]) };
  const msg = buildMessage({ level: "hole", key: "hole1", hole: 1, gainTeam: "a" }, { roundId: "round4", matchId: "match1", after, namesById: NAMES });
  assert.equal(msg.body, "Match 1 · Smith vs TBD\nUSA 1 UP thru 1");
});

test("log ids and match labels", () => {
  assert.equal(logId(2027, "round2", "match2", { key: "hole7" }), "2027_round2_match2_hole7");
  assert.equal(logId(2027, "round2", "match2", { key: "final" }), "2027_round2_match2_final");
  // A new year never collides with the last one.
  assert.notEqual(logId(2028, "round2", "match2", { key: "final" }), logId(2027, "round2", "match2", { key: "final" }));
  assert.equal(matchLabel("match3"), "Match 3");
});
