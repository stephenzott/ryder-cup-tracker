// Shared per-player stats computation -- the stats table and the
// individual player card both call into here, so a player's numbers
// never disagree between the two. Pure function: hand it the player's
// ID and the live match data everything else already has, get back
// everything either page needs.

import { ROUNDS } from "./rounds-config.js";
import { COURSES } from "./courses-config.js";
import { scoreMatch } from "./scoring.js";
import { PAST_TRIPS } from "./history-data.js";

// "Birdie" here means birdie-OR-BETTER (so an eagle counts too) --
// same loose definition used everywhere in this app, not a strict
// one-under-only count.
function isBirdieOrBetter(score, par) {
  return score <= par - 1;
}

// The score this player is credited with on each hole of one match --
// their own ball for best ball/singles, or the side's shared score for
// scramble/greensomes (team rounds have no individual ball to track,
// so everyone on the side is credited with the posted team score --
// a deliberate simplification, not real individual-stroke tracking).
// Returns an array of 18 entries, null where that hole isn't in yet.
function personalHoleScores(round, match, playerId) {
  const scores = new Array(18).fill(null);
  const sideA = match.sideA || [];
  const sideB = match.sideB || [];
  let side = null;
  let playerIndex = -1;
  if (sideA.includes(playerId)) {
    side = "a";
    playerIndex = sideA.indexOf(playerId);
  } else if (sideB.includes(playerId)) {
    side = "b";
    playerIndex = sideB.indexOf(playerId);
  }
  if (side == null) return { side: null, scores };

  const holes = match.holes || {};
  for (let h = 1; h <= 18; h++) {
    const hole = holes[String(h)];
    if (!hole) continue;
    const raw = hole[side];
    const value = round.holeShape === "perPlayer" ? (Array.isArray(raw) ? raw[playerIndex] : null) : raw;
    scores[h - 1] = value == null ? null : value;
  }
  return { side, scores };
}

// matchesByRound: { roundId: { matchId: matchData } }, same shape every
// page already keeps from its onSnapshot listeners.
export function computePlayerStats(playerId, matchesByRound) {
  let points = 0;
  let birdies = 0;
  const completeRounds = []; // { total, toPar }
  const record = { wins: 0, losses: 0, halves: 0 };
  const roundDetails = []; // one entry per match the player's in, in ROUNDS order

  for (const round of ROUNDS) {
    const course = COURSES[round.id];
    for (const [matchId, match] of Object.entries(matchesByRound[round.id] || {})) {
      const { side, scores } = personalHoleScores(round, match, playerId);
      if (side == null) continue;

      const scored = scoreMatch(match);
      points += scored.points[side];

      let roundBirdies = 0;
      for (let h = 0; h < 18; h++) {
        if (scores[h] != null && isBirdieOrBetter(scores[h], course.holes[h].par)) {
          roundBirdies++;
        }
      }
      birdies += roundBirdies;

      const complete = scores.every((v) => v != null);
      let total = null;
      let toPar = null;
      if (complete) {
        total = scores.reduce((sum, v) => sum + v, 0);
        const par = course.holes.reduce((sum, h) => sum + h.par, 0);
        toPar = total - par;
        completeRounds.push({ total, toPar });
      }

      // Record counts all three Nassau segments as separate results --
      // front, back, AND overall -- same as the points themselves. A
      // match you win the front, lose the back, and win overall on
      // (since overall = front + back margin) adds 2-1-0 to the record;
      // halving both nines adds 0-0-3 (the overall is a halve too,
      // since 0 + 0 = 0).
      for (const segment of [scored.front, scored.back, scored.overall]) {
        if (!segment.complete) continue;
        const margin = side === "a" ? segment.margin : -segment.margin;
        if (margin > 0) record.wins++;
        else if (margin < 0) record.losses++;
        else record.halves++;
      }

      const partners = (side === "a" ? match.sideA : match.sideB).filter((id) => id !== playerId);
      const opponents = side === "a" ? match.sideB : match.sideA;

      roundDetails.push({
        roundId: round.id,
        roundLabel: round.label,
        matchId,
        side,
        partners: partners || [],
        opponents: opponents || [],
        total,
        toPar,
        birdies: roundBirdies,
        points: scored.points[side],
        front: scored.front,
        back: scored.back,
        overall: scored.overall,
      });
    }
  }

  const avgScore =
    completeRounds.length > 0
      ? completeRounds.reduce((sum, r) => sum + r.total, 0) / completeRounds.length
      : null;
  const bestRound =
    completeRounds.length > 0 ? Math.min(...completeRounds.map((r) => r.toPar)) : null;

  return { points, birdies, avgScore, bestRound, record, roundDetails };
}

export function formatToPar(n) {
  if (n === 0) return "E";
  return n > 0 ? `+${n}` : `${n}`;
}

export function firstName(fullName) {
  return fullName.split(" ")[0];
}

// Every page that shows a player's name wraps it in this so the name
// is clickable through to their card -- the one place that link gets
// built, so the URL shape only has to change in one spot if it ever does.
export function playerLink(id, label) {
  return `<a href="player.html?id=${id}">${label}</a>`;
}
// (Links built from a Firestore ID still work: player.html looks the ID
// up, then swaps the address to the ?p=<slug> form below.)

// ------------------------------------------------------------------
// Identifying a person across years
// ------------------------------------------------------------------

// personSlug("Sean O'Neal") -> "sean-oneal". A "slug" is the standard
// web term for a name rewritten so it's safe inside a web address:
// lowercase, accents removed, apostrophes dropped, and every other run
// of non-letters/digits turned into a single "-". Two spellings that
// differ only in capitals or spacing give the same slug, so this is
// what we compare when matching a past-trip entry to a roster player.
export function personSlug(fullName) {
  return fullName
    .normalize("NFD")                 // split "é" into "e" + accent mark...
    .replace(/[̀-ͯ]/g, "")  // ...then delete the accent marks
    .toLowerCase()
    .replace(/['’]/g, "")             // O'Neal -> oneal, not o-neal
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");         // no "-" at either end
}

// A link to someone's card by name, e.g. player.html?p=keanan-smith.
// Works for anyone who has ever played, on this year's roster or not.
export function personLink(fullName, label) {
  return `<a href="player.html?p=${personSlug(fullName)}">${label}</a>`;
}

// shortNames(["Sean O'Neal", "Sean Kohn", "Doug Friedman"])
//   -> Map { "Sean O'Neal" -> "Sean O.", "Sean Kohn" -> "Sean K.",
//            "Doug Friedman" -> "Doug" }
// First names only, except when two people IN THE SAME LIST share a
// first name: then both get their last initial. Pass the whole list a
// table will show, since whether a name clashes depends on who else
// is in that table.
export function shortNames(fullNames) {
  const countByFirst = {};
  for (const name of fullNames) {
    const first = firstName(name);
    countByFirst[first] = (countByFirst[first] || 0) + 1;
  }
  const result = new Map();
  for (const name of fullNames) {
    const parts = name.trim().split(/\s+/);
    const first = parts[0];
    const last = parts.length > 1 ? parts[parts.length - 1] : "";
    result.set(name, countByFirst[first] > 1 && last ? `${first} ${last[0]}.` : first);
  }
  return result;
}

// ------------------------------------------------------------------
// All-time stats for one person: every past trip's frozen numbers
// (history-data.js) plus this year's live numbers, combined. Both the
// Stats page's All-time tab and the player card call this, so the two
// can never disagree.
//
//   fullName       the person's name (used to find their past entries)
//   rosterPlayer   their Firestore player record this year, or null if
//                  they aren't on this year's roster
//   matchesByRound this year's live match data
//
// How each number combines across years:
//   points, birdies, record  simply add up
//   avgScore    total strokes / total complete rounds, so a year with
//               more rounds counts for more (a weighted average, not
//               the average of each year's average)
//   bestRound   the lowest of the years' best rounds
//   pct         pctPoints / pctOf. This year: points from FINISHED
//               matches / 3 per finished match. Past trips: points /
//               (rounds x 3), since they only store final totals.
//   record      null (shown "—") if any past trip they played is
//               missing its record
//   pastYears   the past trip years they played, e.g. [2026]
//   playedThisYear  true once they've been in a match this year (the
//               page adds CURRENT_YEAR itself; importing it here would
//               make two files import each other)
// ------------------------------------------------------------------
export function computeCareerStats(fullName, rosterPlayer, matchesByRound) {
  const slug = personSlug(fullName);

  let totalStrokes = 0;
  let roundsPlayed = 0;
  let points = 0;
  let birdies = 0;
  let bestRound = null;
  let pctPoints = 0;
  let pctOf = 0;
  let record = { wins: 0, losses: 0, halves: 0 };
  const pastYears = [];

  // Helper for "the smaller of two values, where null means none yet".
  const lower = (a, b) => (a == null ? b : b == null ? a : Math.min(a, b));

  for (const trip of PAST_TRIPS) {
    const entry = trip.players.find((p) => personSlug(p.fullName) === slug);
    if (!entry) continue;
    pastYears.push(trip.year);
    totalStrokes += entry.totalStrokes;
    roundsPlayed += entry.roundsPlayed;
    points += entry.points;
    birdies += entry.birdies;
    bestRound = lower(bestRound, entry.bestRound);
    pctPoints += entry.points;
    pctOf += entry.roundsPlayed * 3;
    if (entry.record == null) record = null;   // one missing year spoils the total
    else if (record) {
      record.wins += entry.record.wins;
      record.losses += entry.record.losses;
      record.halves += entry.record.halves;
    }
  }

  // live = this year's numbers (null if not on this year's roster).
  let live = null;
  if (rosterPlayer) {
    live = computePlayerStats(rosterPlayer.id, matchesByRound);
    const complete = live.roundDetails.filter((d) => d.total != null);
    const finished = live.roundDetails.filter((d) => d.overall.complete);
    totalStrokes += complete.reduce((sum, d) => sum + d.total, 0);
    roundsPlayed += complete.length;
    points += live.points;
    birdies += live.birdies;
    bestRound = lower(bestRound, live.bestRound);
    pctPoints += finished.reduce((sum, d) => sum + d.points, 0);
    pctOf += finished.length * 3;
    if (record) {
      record.wins += live.record.wins;
      record.losses += live.record.losses;
      record.halves += live.record.halves;
    }
  }

  return {
    points,
    birdies,
    bestRound,
    avgScore: roundsPlayed > 0 ? totalStrokes / roundsPlayed : null,
    pctPoints,
    pctOf,
    record,
    pastYears,
    playedThisYear: live != null && live.roundDetails.length > 0,
    live,   // this year's full computePlayerStats result, for the match cards
  };
}

// Everyone who has ever played: this year's roster plus anyone from a
// past trip who isn't on it, one entry per person (matched by slug).
// Returns [{ fullName, rosterPlayer }], rosterPlayer = null if they're
// not on this year's roster.
export function allPeople(rosterPlayers) {
  const people = rosterPlayers.map((p) => ({ fullName: p.name, rosterPlayer: p }));
  const seen = new Set(people.map((p) => personSlug(p.fullName)));
  for (const trip of PAST_TRIPS) {
    for (const entry of trip.players) {
      const slug = personSlug(entry.fullName);
      if (seen.has(slug)) continue;
      seen.add(slug);
      people.push({ fullName: entry.fullName, rosterPlayer: null });
    }
  }
  return people;
}
