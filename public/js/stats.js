// 2027 player stats, computed live from the same match data everything
// else uses -- no separate stats collection to keep in sync. Shows
// first name + team flag (matching how the group's done this before),
// average score, points earned, birdies, and best round to par.
//
// "Average score" and "birdies" treat every round's posted score as
// equally "theirs," even scramble/greensomes where it's really the
// whole side's shared score -- that's a deliberate simplification the
// group asked for, not an attempt to track individual strokes in a
// scramble.

import { db } from "./firebase-init.js";
import {
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { ROUNDS } from "./rounds-config.js";
import { COURSES } from "./courses-config.js";
import { scoreMatch } from "./scoring.js";

const app = document.getElementById("app");
app.innerHTML = `
  <h1>2027 Stats</h1>
  <p>First names only, sorted by points earned. "—" means not enough data yet (a stat only counts a round once all 18 holes are in).</p>
  <table>
    <thead>
      <tr>
        <th>Player</th>
        <th>Avg score</th>
        <th>Points</th>
        <th>Birdies</th>
        <th>Best round</th>
      </tr>
    </thead>
    <tbody id="stats-rows"><tr><td colspan="5">Loading…</td></tr></tbody>
  </table>
`;

let players = [];
// roundId -> { matchId -> matchData }
const matchesByRound = {};
for (const round of ROUNDS) {
  matchesByRound[round.id] = {};
}

function firstName(fullName) {
  return fullName.split(" ")[0];
}

function flag(team) {
  if (team === "A") return "🇺🇸";
  if (team === "B") return "🇪🇺";
  return "";
}

function formatToPar(n) {
  if (n === 0) return "E";
  return n > 0 ? `+${n}` : `${n}`;
}

// The score this player is credited with on each hole of one match --
// their own ball for best ball/singles, or the side's shared score for
// scramble/greensomes (see the file-level comment on why). Returns an
// array of 18 entries, null where that hole isn't in yet.
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
  if (side == null) return scores;

  const holes = match.holes || {};
  for (let h = 1; h <= 18; h++) {
    const hole = holes[String(h)];
    if (!hole) continue;
    const raw = hole[side];
    const value = round.holeShape === "perPlayer" ? (Array.isArray(raw) ? raw[playerIndex] : null) : raw;
    scores[h - 1] = value == null ? null : value;
  }
  return scores;
}

function computeStats(playerId) {
  let points = 0;
  let birdies = 0;
  const completeRounds = []; // { total, toPar }

  for (const round of ROUNDS) {
    const course = COURSES[round.id];
    for (const match of Object.values(matchesByRound[round.id])) {
      const sideA = match.sideA || [];
      const sideB = match.sideB || [];
      if (!sideA.includes(playerId) && !sideB.includes(playerId)) continue;
      const side = sideA.includes(playerId) ? "a" : "b";

      // Points: full credit for whatever their side has actually
      // earned so far (never the projected figure on a stats page).
      points += scoreMatch(match).points[side];

      const scores = personalHoleScores(round, match, playerId);
      for (let h = 0; h < 18; h++) {
        if (scores[h] != null && scores[h] === course.holes[h].par - 1) birdies++;
      }

      if (scores.every((v) => v != null)) {
        const total = scores.reduce((sum, v) => sum + v, 0);
        const par = course.holes.reduce((sum, h) => sum + h.par, 0);
        completeRounds.push({ total, toPar: total - par });
      }
    }
  }

  const avgScore =
    completeRounds.length > 0
      ? completeRounds.reduce((sum, r) => sum + r.total, 0) / completeRounds.length
      : null;
  const bestRound =
    completeRounds.length > 0 ? Math.min(...completeRounds.map((r) => r.toPar)) : null;

  return { points, birdies, avgScore, bestRound };
}

function render() {
  const rows = players
    .map((p) => ({ player: p, stats: computeStats(p.id) }))
    .sort((a, b) => b.stats.points - a.stats.points || (a.stats.avgScore ?? 999) - (b.stats.avgScore ?? 999));

  document.getElementById("stats-rows").innerHTML =
    rows
      .map(
        ({ player, stats }) => `
        <tr>
          <td>${flag(player.team)} ${firstName(player.name)}</td>
          <td>${stats.avgScore == null ? "—" : stats.avgScore.toFixed(1)}</td>
          <td>${stats.points}</td>
          <td>${stats.birdies}</td>
          <td>${stats.bestRound == null ? "—" : formatToPar(stats.bestRound)}</td>
        </tr>
      `
      )
      .join("") || `<tr><td colspan="5">No players yet.</td></tr>`;
}

onSnapshot(collection(db, "players"), (snapshot) => {
  players = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  render();
});

for (const round of ROUNDS) {
  onSnapshot(collection(db, "rounds", round.id, "matches"), (snapshot) => {
    const current = {};
    snapshot.forEach((d) => {
      current[d.id] = d.data();
    });
    matchesByRound[round.id] = current;
    render();
  });
}
