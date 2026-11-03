// 2027 player stats, computed live from the same match data everything
// else uses -- no separate stats collection to keep in sync. Shows
// first name + team flag (matching how the group's done this before),
// average score, points earned, birdies, and best round to par. Each
// name links through to that player's full card (player.html).
//
// All the actual computation lives in player-stats.js, shared with the
// player card page so the two never disagree.

import { db } from "./firebase-init.js";
import {
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { ROUNDS } from "./rounds-config.js";
import { computePlayerStats, flag, firstName, playerLink, formatToPar } from "./player-stats.js";

const app = document.getElementById("app");
app.innerHTML = `
  <h1>2027 Stats</h1>
  <p>First names only, sorted by points earned. "—" means not enough data yet (a stat only counts a round once all 18 holes are in). Click a name for their full card.</p>
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

function render() {
  const rows = players
    .map((p) => ({ player: p, stats: computePlayerStats(p.id, matchesByRound) }))
    .sort((a, b) => b.stats.points - a.stats.points || (a.stats.avgScore ?? 999) - (b.stats.avgScore ?? 999));

  document.getElementById("stats-rows").innerHTML =
    rows
      .map(
        ({ player, stats }) => `
        <tr>
          <td>${flag(player.team)} ${playerLink(player.id, firstName(player.name))}</td>
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
