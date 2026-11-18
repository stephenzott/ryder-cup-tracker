// DEMO ONLY (never deployed; see "ignore" in firebase.json).
//
// Holds the made-up data the demo pages show instead of Firestore:
// players, pairings, hole scores and strokes, for all four rounds, set
// up as if the trip were midway through one round ("in progress").
//
// The data lives in this browser tab's sessionStorage, so scores you
// "save" in the demo survive switching between demo pages, and vanish
// when you press Reset or close the tab. Nothing here ever writes to
// Firestore. The only network call is one READ of the public player
// list (the same names anyone can see on the Roster page); if that
// fails, made-up names are used.

import { ROUNDS } from "/js/rounds-config.js";
import { COURSES } from "/js/courses-config.js";

const STORAGE_KEY = "rc-demo-state";
const PLAYERS_URL =
  "https://firestore.googleapis.com/v1/projects/golf-tracker-data/databases/ryder-cup-tracker/documents/players?pageSize=100";

// How many holes the "your match" group has finished: 9 means you're
// standing on the 10th tee.
const YOUR_HOLES_PLAYED = 9;

// ------------------------------------------------------------------
// A small seeded random-number generator ("mulberry32"). Seeded means
// the same seed always gives the same sequence, so a given demo setup
// is reproducible. Returns numbers in [0, 1), like Math.random().
// A standard tiny algorithm; the bit operations just scramble the
// number thoroughly.
// ------------------------------------------------------------------
function makeRandom(seed) {
  let a = seed >>> 0;
  return function random() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Shuffle a copy of an array (Fisher-Yates: walk backwards, swapping
// each item with a random earlier-or-same position; every ordering is
// equally likely).
function shuffled(list, random) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// A plausible score on one hole: mostly par or bogey, some birdies and
// doubles. The thresholds are cumulative chances: 8% birdie, 47% par,
// 33% bogey, 12% double.
function holeScore(par, random) {
  const u = random();
  if (u < 0.08) return par - 1;
  if (u < 0.55) return par;
  if (u < 0.88) return par + 1;
  return par + 2;
}

// Same allocation rule the round page uses: strokes go on the hardest
// holes by stroke index.
function hardestHoles(course, count) {
  const sorted = [...course.holes].sort((x, y) => x.strokeIndex - y.strokeIndex);
  return Array.from({ length: count }, (_, i) => sorted[i % sorted.length].hole);
}

// ------------------------------------------------------------------
// Players: the real names (read-only fetch), with made-up teams.
// ------------------------------------------------------------------
const FALLBACK_NAMES = [
  "Alex Brown", "Ben Carter", "Chris Davis", "Dan Evans", "Eric Fox", "Frank Green", "Greg Hall", "Hank Irwin",
  "Ian James", "Jack King", "Kyle Long", "Luke Moore", "Matt Nash", "Nick Owen", "Owen Price", "Pete Quinn",
];

async function fetchPlayers() {
  try {
    const response = await fetch(PLAYERS_URL);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    // Firestore's web (REST) format wraps every value, e.g.
    // { name: { stringValue: "Sean Kohn" } }; unwrap just what we need.
    const players = (json.documents || []).map((d) => ({
      id: d.name.split("/").pop(),
      name: d.fields?.name?.stringValue || "(unknown)",
      handicapIndex: Number(d.fields?.handicapIndex?.doubleValue ?? d.fields?.handicapIndex?.integerValue ?? 0) || null,
    }));
    if (players.length >= 4) return players;
    throw new Error("too few players");
  } catch (error) {
    console.info("[demo] using made-up names:", error.message);
    return FALLBACK_NAMES.map((name, i) => ({ id: `demo${i + 1}`, name, handicapIndex: 5 + i }));
  }
}

// ------------------------------------------------------------------
// Build a full demo state.
//   liveRoundId  the round shown "in progress"
//   players      [{ id, name, handicapIndex }] (teams get assigned here)
//   seed         controls all the randomness
// Earlier rounds come out finished, the live round mid-way, later
// rounds without pairings yet.
// ------------------------------------------------------------------
function buildState(liveRoundId, basePlayers, seed, youId = null) {
  const random = makeRandom(seed);

  // Made-up teams: shuffle, first half USA ("A"), second half EU ("B").
  const order = shuffled(basePlayers, random);
  const half = Math.ceil(order.length / 2);
  const players = order.map((p, i) => ({ ...p, team: i < half ? "A" : "B" }));
  const usa = players.filter((p) => p.team === "A").map((p) => p.id);
  const eu = players.filter((p) => p.team === "B").map((p) => p.id);

  const liveIndex = ROUNDS.findIndex((r) => r.id === liveRoundId);
  const rounds = {};

  ROUNDS.forEach((round, ri) => {
    rounds[round.id] = {};
    if (ri > liveIndex) return;   // later rounds: no pairings yet

    const course = COURSES[round.id];
    const a = shuffled(usa, random);
    const b = shuffled(eu, random);

    // In the live round, put "you" (if already chosen) into match 1,
    // the group standing on the 10th tee, by moving you to the front
    // of your team's list.
    if (ri === liveIndex && youId) {
      for (const list of [a, b]) {
        const at = list.indexOf(youId);
        if (at > 0) [list[0], list[at]] = [list[at], list[0]];
      }
    }

    for (let m = 0; m < round.matchCount; m++) {
      const per = round.playersPerSide;
      const sideA = a.slice(m * per, m * per + per);
      const sideB = b.slice(m * per, m * per + per);
      if (sideA.length < per || sideB.length < per) break;   // not enough players for this match

      // Holes played: all 18 in finished rounds; in the live round,
      // your group (match 1) has played 9 and the others 5-12.
      let played = 18;
      if (ri === liveIndex) played = m === 0 ? YOUR_HOLES_PLAYED : 5 + Math.floor(random() * 8);

      const holes = {};
      for (let h = 1; h <= played; h++) {
        const par = course.holes[h - 1].par;
        if (round.holeShape === "perPlayer") {
          holes[h] = {
            a: sideA.map(() => holeScore(par, random)),
            b: sideB.map(() => holeScore(par, random)),
          };
        } else {
          holes[h] = { a: holeScore(par, random), b: holeScore(par, random) };
        }
      }

      const match = { sideA, sideB, holes };

      // Rounds with handicap strokes: one player per match gets 1-4.
      if (round.strokesGivenEligible) {
        const everyone = [...sideA, ...sideB];
        const receiver = everyone[Math.floor(random() * everyone.length)];
        match.strokesGiven = { [receiver]: hardestHoles(course, 1 + Math.floor(random() * 4)) };
      }

      rounds[round.id][`match${m + 1}`] = match;
    }
  });

  // "You": keep the previous choice if given, else a USA player in the
  // live round's match 1 (the group on the 10th tee).
  const you = youId && players.some((p) => p.id === youId) ? youId : rounds[liveRoundId]?.match1?.sideA?.[0] || players[0].id;

  return { seed, liveRoundId, you, players, rounds };
}

// ------------------------------------------------------------------
// Load (or create) the state for this tab, and save changes back.
// ------------------------------------------------------------------
let state = null;

function save() {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage can be unavailable (e.g. private mode); the demo still
    // works, it just won't remember entries across pages.
  }
}

async function load() {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) {
      state = JSON.parse(saved);
      return state;
    }
  } catch {
    // fall through and build a fresh one
  }
  const players = await fetchPlayers();
  state = buildState("round3", players, 2027);
  save();
  return state;
}

// Everything else in the demo waits on this before drawing.
export const ready = load();

export function getState() {
  return state;
}

export function persist() {
  save();
}

// Start over with a different round in progress (same players, new
// made-up pairings and scores, same "you" if possible).
export function restartWithLiveRound(liveRoundId) {
  const basePlayers = state.players.map(({ team, ...rest }) => rest);
  state = buildState(liveRoundId, basePlayers, state.seed + 1, state.you);
  save();
}

export function setYou(playerId) {
  state.you = playerId;
  save();
}

export function resetAll() {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // nothing to clear
  }
}
