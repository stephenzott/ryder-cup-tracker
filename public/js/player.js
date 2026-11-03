// Individual player card: ?id=<playerId> in the URL. Pulls the same
// live match data every other page uses and runs it through
// player-stats.js's shared computation, so these numbers always match
// what's shown on the stats table.

import { db } from "./firebase-init.js";
import {
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { ROUNDS } from "./rounds-config.js";
import { computePlayerStats, flag, playerLink, formatToPar } from "./player-stats.js";

const app = document.getElementById("app");
const playerId = new URLSearchParams(location.search).get("id");

if (!playerId) {
  app.innerHTML = `<h1>Player not found</h1><p>No player ID in the URL.</p>`;
  throw new Error("missing ?id=");
}

app.innerHTML = `<p>Loading…</p>`;

let players = [];
const matchesByRound = {};
for (const round of ROUNDS) {
  matchesByRound[round.id] = {};
}

function playerName(id) {
  const p = players.find((pl) => pl.id === id);
  return p ? p.name : "(unknown)";
}

function namesLinked(ids) {
  return ids.map((id) => playerLink(id, playerName(id))).join(" & ") || "—";
}

function statusLabel(segment) {
  if (segment.holesEntered === 0) return "—";
  if (segment.margin === 0) return segment.complete ? "Halved" : "All square";
  const leader = segment.margin > 0 ? "USA" : "EUR";
  return `${leader} ${Math.abs(segment.margin)} UP`;
}

function render() {
  const player = players.find((p) => p.id === playerId);
  if (!player) {
    app.innerHTML = `<h1>Player not found</h1><p>No player with this ID (or the roster hasn't loaded yet).</p>`;
    return;
  }

  const stats = computePlayerStats(playerId, matchesByRound);
  const { record } = stats;

  const roundsHtml = stats.roundDetails.length
    ? stats.roundDetails
        .map((d) => {
          const scoreLine =
            d.total == null
              ? "In progress"
              : `${d.total} (${formatToPar(d.toPar)}), ${d.birdies} birdie${d.birdies === 1 ? "" : "s"}`;
          return `
            <div class="match-card">
              <h3>${d.roundLabel}</h3>
              <p>
                ${d.partners.length ? `With ${namesLinked(d.partners)} vs ` : "Vs "}${namesLinked(d.opponents)}
              </p>
              <p>
                Front 9: <strong>${statusLabel(d.front)}</strong> ·
                Back 9: <strong>${statusLabel(d.back)}</strong> ·
                Overall: <strong>${statusLabel(d.overall)}</strong><br>
                Points earned: ${d.points}<br>
                Round score: ${scoreLine}
              </p>
            </div>
          `;
        })
        .join("")
    : "<p><em>Hasn't played a match yet.</em></p>";

  app.innerHTML = `
    <h1>${flag(player.team)} ${player.name}</h1>
    <p>Handicap Index: ${player.handicapIndex ?? "—"}</p>

    <table>
      <thead>
        <tr><th>Avg score</th><th>Points</th><th>Birdies</th><th>Best round</th><th>Record (W-L-H)</th></tr>
      </thead>
      <tbody>
        <tr>
          <td>${stats.avgScore == null ? "—" : stats.avgScore.toFixed(1)}</td>
          <td>${stats.points}</td>
          <td>${stats.birdies}</td>
          <td>${stats.bestRound == null ? "—" : formatToPar(stats.bestRound)}</td>
          <td>${record.wins}-${record.losses}-${record.halves}</td>
        </tr>
      </tbody>
    </table>

    <h2>By round</h2>
    ${roundsHtml}
  `;
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
