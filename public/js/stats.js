// This page has three stat tables, in order:
//   1. "2027 Stats"     -- this year only, live.
//   2. "All-Time Stats" -- every past trip's frozen numbers plus this
//                          year's live numbers, added together. Live
//                          too, since the 2027 portion still updates
//                          as scores come in.
//   3. "<last trip>"    -- the most recent *past* trip alone, frozen.
//
// All the actual computation lives in player-stats.js (live year) and
// history-data.js (frozen past years), shared with the player card
// page so numbers never disagree between pages.

import { db } from "./firebase-init.js";
import {
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { ROUNDS } from "./rounds-config.js";
import { computePlayerStats, flag, firstName, playerLink, formatToPar } from "./player-stats.js";
import { PAST_TRIPS } from "./history-data.js";

const lastTrip = PAST_TRIPS[PAST_TRIPS.length - 1];

const tableHead = `
  <thead>
    <tr>
      <th>Player</th>
      <th>Avg score</th>
      <th>Points</th>
      <th>Birdies</th>
      <th>Best round</th>
    </tr>
  </thead>
`;

// One <tr> builder shared by all three tables so the markup (and the
// "—" for missing data) can't drift between them.
function statRow(flagChar, nameHtml, avgScore, points, birdies, bestRound) {
  return `
    <tr>
      <td>${flagChar} ${nameHtml}</td>
      <td>${avgScore == null ? "—" : avgScore.toFixed(1)}</td>
      <td>${points}</td>
      <td>${birdies}</td>
      <td>${bestRound == null ? "—" : formatToPar(bestRound)}</td>
    </tr>
  `;
}

const app = document.getElementById("app");
app.innerHTML = `
  <h1>2027 Stats</h1>
  <p>First names only, sorted by points earned. "—" means not enough data yet (a stat only counts a round once all 18 holes are in). Click a name for their full card.</p>
  <table>
    ${tableHead}
    <tbody id="stats-rows"><tr><td colspan="5">Loading…</td></tr></tbody>
  </table>

  <h2>All-Time Stats</h2>
  <p>This year's live numbers added to every past trip's frozen ones. A player with no past-trip data just shows their 2027 numbers.</p>
  <table>
    ${tableHead}
    <tbody id="career-rows"><tr><td colspan="5">Loading…</td></tr></tbody>
  </table>

  <h2>${lastTrip.label}</h2>
  <p>That trip's final stats -- frozen, not live. Same columns as above, same scoring rules.</p>
  <table>
    ${tableHead}
    <tbody>
      ${lastTrip.players
        .map((p) =>
          statRow(
            flag(p.team === "usa" ? "A" : "B"),
            p.playerId ? playerLink(p.playerId, p.name) : p.name,
            p.roundsPlayed > 0 ? p.totalStrokes / p.roundsPlayed : null,
            p.points,
            p.birdies,
            p.bestRound
          )
        )
        .join("")}
    </tbody>
  </table>
`;

let players = [];
// roundId -> { matchId -> matchData }
const matchesByRound = {};
for (const round of ROUNDS) {
  matchesByRound[round.id] = {};
}

// Builds the "All-Time Stats" rows: every current roster player's live
// 2027 numbers, plus (summed in) any past-trip entry for that same
// playerId -- and, separately, any past player who never matched to a
// current roster id (e.g. Keanan from the 2026 trip), kept in by name
// since they have no live portion to anchor to.
function careerRows() {
  const rosterIds = new Set(players.map((p) => p.id));
  const rows = [];

  for (const player of players) {
    const live = computePlayerStats(player.id, matchesByRound);
    const liveComplete = live.roundDetails.filter((d) => d.total != null);

    let totalStrokes = liveComplete.reduce((sum, d) => sum + d.total, 0);
    let roundsPlayed = liveComplete.length;
    let points = live.points;
    let birdies = live.birdies;
    let bestRound = live.bestRound;

    for (const trip of PAST_TRIPS) {
      const entry = trip.players.find((p) => p.playerId === player.id);
      if (!entry) continue;
      totalStrokes += entry.totalStrokes;
      roundsPlayed += entry.roundsPlayed;
      points += entry.points;
      birdies += entry.birdies;
      bestRound = bestRound == null ? entry.bestRound : Math.min(bestRound, entry.bestRound);
    }

    rows.push({
      flagChar: flag(player.team),
      nameHtml: playerLink(player.id, firstName(player.name)),
      avgScore: roundsPlayed > 0 ? totalStrokes / roundsPlayed : null,
      points,
      birdies,
      bestRound,
    });
  }

  // name -> running totals, for past players with no current-roster match.
  const unmatched = {};
  for (const trip of PAST_TRIPS) {
    for (const entry of trip.players) {
      if (entry.playerId && rosterIds.has(entry.playerId)) continue; // already folded in above
      const acc = unmatched[entry.name] || {
        team: entry.team,
        totalStrokes: 0,
        roundsPlayed: 0,
        points: 0,
        birdies: 0,
        bestRound: null,
      };
      acc.totalStrokes += entry.totalStrokes;
      acc.roundsPlayed += entry.roundsPlayed;
      acc.points += entry.points;
      acc.birdies += entry.birdies;
      acc.bestRound = acc.bestRound == null ? entry.bestRound : Math.min(acc.bestRound, entry.bestRound);
      unmatched[entry.name] = acc;
    }
  }
  for (const [name, acc] of Object.entries(unmatched)) {
    rows.push({
      flagChar: flag(acc.team === "usa" ? "A" : "B"),
      nameHtml: name,
      avgScore: acc.roundsPlayed > 0 ? acc.totalStrokes / acc.roundsPlayed : null,
      points: acc.points,
      birdies: acc.birdies,
      bestRound: acc.bestRound,
    });
  }

  rows.sort((a, b) => b.points - a.points || (a.avgScore ?? 999) - (b.avgScore ?? 999));
  return rows;
}

function render() {
  const rows = players
    .map((p) => ({ player: p, stats: computePlayerStats(p.id, matchesByRound) }))
    .sort((a, b) => b.stats.points - a.stats.points || (a.stats.avgScore ?? 999) - (b.stats.avgScore ?? 999));

  document.getElementById("stats-rows").innerHTML =
    rows
      .map(({ player, stats }) =>
        statRow(flag(player.team), playerLink(player.id, firstName(player.name)), stats.avgScore, stats.points, stats.birdies, stats.bestRound)
      )
      .join("") || `<tr><td colspan="5">No players yet.</td></tr>`;

  document.getElementById("career-rows").innerHTML =
    careerRows()
      .map((r) => statRow(r.flagChar, r.nameHtml, r.avgScore, r.points, r.birdies, r.bestRound))
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
