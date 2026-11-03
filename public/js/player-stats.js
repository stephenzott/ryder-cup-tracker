// Shared per-player stats computation -- the stats table and the
// individual player card both call into here, so a player's numbers
// never disagree between the two. Pure function: hand it the player's
// ID and the live match data everything else already has, get back
// everything either page needs.

import { ROUNDS } from "./rounds-config.js";
import { COURSES } from "./courses-config.js";
import { scoreMatch } from "./scoring.js";

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

export function flag(team) {
  if (team === "A") return "🇺🇸";
  if (team === "B") return "🇪🇺";
  return "";
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
