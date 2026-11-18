// The Stats page: three leaderboards behind tabs, in this order.
//   1. "2027"     -- this year only, live.
//   2. "2026"     -- the most recent *past* trip alone, frozen.
//   3. "All-time" -- every past trip's frozen numbers plus this year's
//                    live numbers, added together. Live too, since the
//                    current-year portion still updates as scores come in.
//
// "Pct" (points percentage) = points won in FINISHED matches divided by
// the points those matches were worth (3 each: front 9, back 9,
// overall). A match still being played doesn't count at all -- not even
// a front nine already won -- until all 18 holes are in. Past trips
// only store final totals, so for them it's points / (rounds x 3),
// e.g. 9 of 12 = 75% for 2026.
//
// All the actual computation lives in player-stats.js (live year) and
// history-data.js (frozen past years), shared with the player card
// page so numbers never disagree between pages.
//
// Team colors: teams are redrawn every year, so a row is colored by
// the team for the year that tab shows -- this year's team on the
// current tab, that trip's team on a past-trip tab, and neutral navy on
// All-time (which mixes years).

import { db } from "./firebase-init.js";
import {
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { ROUNDS } from "./rounds-config.js";
import { computePlayerStats, firstName, playerLink, formatToPar } from "./player-stats.js";
import { PAST_TRIPS } from "./history-data.js";
import { formatPoints, avatarHtml, CURRENT_YEAR } from "./match-ui.js";

const lastTrip = PAST_TRIPS[PAST_TRIPS.length - 1];

// "2026 — Arizona (Grayhawk & WeKoPa)" -> "2026" for the tab label.
const shortTripLabel = (trip) => trip.label.split(" — ")[0];

// ------------------------------------------------------------------
// Tabs. Each has an id (also used in the address, e.g. #alltime), a
// label, and a short explanation shown above its leaderboard.
// ------------------------------------------------------------------
const TABS = [
  {
    id: String(CURRENT_YEAR),
    label: String(CURRENT_YEAR),
    note: `This year, live. Sorted by points earned. "—" means not enough data yet (a stat only counts a round once all 18 holes are in). Tap a name for their full card.`,
  },
  {
    id: shortTripLabel(lastTrip),
    label: shortTripLabel(lastTrip),
    note: `${lastTrip.label}: that trip's final stats, frozen. Colors show each player's team on that trip. Same columns and scoring rules as the other tabs.`,
  },
  {
    id: "alltime",
    label: "All-time",
    note: `This year's live numbers added to every past trip's frozen ones. A player with no past-trip data just shows this year's numbers. Teams change every year, so no team colors here.`,
  },
];

function tabFromHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  return TABS.some((t) => t.id === id) ? id : null;
}
let selectedTab = tabFromHash() || TABS[0].id;

// ------------------------------------------------------------------
// Leaderboard table. Every tab uses the same builder, so the columns,
// the "—" for missing data and the ½ formatting can't drift apart.
// A row: { team, avatarName, nameHtml, avgScore, points, pctPoints,
//         pctOf, birdies, bestRound }   (pct = pctPoints / pctOf)
//   team = "A"/"B"/"usa"/"europe" to color the initials circle, or null
//   for neutral navy.
// ------------------------------------------------------------------

// Rank numbers with ties: rows with the same points AND average share a
// rank, shown as "T2". (Rows arrive already sorted.)
function ranks(rows) {
  const out = [];
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    const tiedWithPrev = prev && prev.points === row.points && prev.avgScore === row.avgScore;
    out.push(tiedWithPrev ? out[i - 1] : i + 1);
  });
  return out.map((r, i) => {
    const tied = out[i - 1] === r || out[i + 1] === r;
    return tied ? `T${r}` : String(r);
  });
}

// Points percentage as a whole number, e.g. "75%"; "—" until the
// player has finished at least one match.
function formatPct(points, outOf) {
  return outOf > 0 ? `${Math.round((points / outOf) * 100)}%` : "—";
}

// From a player's live roundDetails (computePlayerStats), the points
// won in FINISHED matches and what those matches were worth (3 each).
function finishedMatchPoints(roundDetails) {
  const finished = roundDetails.filter((d) => d.overall.complete);
  return {
    pctPoints: finished.reduce((sum, d) => sum + d.points, 0),
    pctOf: finished.length * 3,
  };
}

function leaderboardHtml(rows) {
  if (rows.length === 0) return `<p class="sb-empty">No players yet.</p>`;
  const rankLabels = ranks(rows);
  const body = rows
    .map(
      (r, i) => `
        <tr>
          <td class="lb-rank">${rankLabels[i]}</td>
          <td class="lb-player"><span class="lb-player-inner">${avatarHtml(r.avatarName, r.team)}<span class="lb-name">${r.nameHtml}</span></span></td>
          <td class="lb-num lb-pts">${formatPoints(r.points)}</td>
          <td class="lb-num">${formatPct(r.pctPoints, r.pctOf)}</td>
          <td class="lb-num">${r.avgScore == null ? "—" : r.avgScore.toFixed(1)}</td>
          <td class="lb-num">${r.birdies}</td>
          <td class="lb-num">${r.bestRound == null ? "—" : formatToPar(r.bestRound)}</td>
        </tr>
      `
    )
    .join("");
  // <abbr title> gives the short column headings their full meaning;
  // the key under the table spells them out for everyone.
  return `
    <div class="lb-wrap">
      <table class="leaderboard">
        <thead>
          <tr>
            <th class="lb-rank" scope="col"><abbr title="Rank">#</abbr></th>
            <th scope="col">Player</th>
            <th class="lb-num" scope="col"><abbr title="Points">Pts</abbr></th>
            <th class="lb-num" scope="col"><abbr title="Points percentage, finished matches">Pct</abbr></th>
            <th class="lb-num" scope="col"><abbr title="Average score">Avg</abbr></th>
            <th class="lb-num" scope="col"><abbr title="Birdies or better">Bir</abbr></th>
            <th class="lb-num" scope="col"><abbr title="Best round versus par">Best</abbr></th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    <p class="lb-key">Pts = points · Pct = share of points won in finished matches · Avg = average 18-hole score · Bir = birdies or better · Best = best round vs par</p>
  `;
}

// Grey placeholder rows for the live tabs until the data arrives.
const SKELETON_TABLE = `
  <div class="lb-wrap" aria-hidden="true">
    ${'<div class="lb-skeleton-row"><span class="skeleton skeleton-avatar"></span><span class="skeleton skeleton-line skeleton-name"></span></div>'.repeat(6)}
  </div>
`;

// ------------------------------------------------------------------
// Page skeleton
// ------------------------------------------------------------------
const app = document.getElementById("app");
app.innerHTML = `
  <header class="page-header page-header-tabs">
    <p class="page-eyebrow">Leaderboards</p>
    <h1 class="page-title">Stats</h1>
    <div class="sb-tabs st-tabs" id="st-tabs" role="group" aria-label="Choose a leaderboard"></div>
  </header>
  <p class="st-note" id="st-note"></p>
  <div id="st-board" aria-live="polite"></div>
`;

let players = [];
let playersLoaded = false;
// roundId -> { matchId -> matchData }
const matchesByRound = {};
for (const round of ROUNDS) {
  matchesByRound[round.id] = {};
}
const roundsLoaded = new Set();

// ------------------------------------------------------------------
// Rows for each tab
// ------------------------------------------------------------------

// This year, live. Colored by this year's team.
function currentRows() {
  return players
    .map((p) => ({ player: p, stats: computePlayerStats(p.id, matchesByRound) }))
    .sort((a, b) => b.stats.points - a.stats.points || (a.stats.avgScore ?? 999) - (b.stats.avgScore ?? 999))
    .map(({ player, stats }) => ({
      team: player.team,
      avatarName: player.name,
      nameHtml: playerLink(player.id, firstName(player.name)),
      avgScore: stats.avgScore,
      points: stats.points,
      ...finishedMatchPoints(stats.roundDetails),
      birdies: stats.birdies,
      bestRound: stats.bestRound,
    }));
}

// Builds the "All-Time" rows: every current roster player's live
// numbers, plus (summed in) any past-trip entry for that same
// playerId -- and, separately, any past player who never matched to a
// current roster id (e.g. Keanan Smith from the 2026 trip), kept in by name
// since they have no live portion to anchor to. Neutral color (team:
// null) because these rows mix years with different teams.
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
    let { pctPoints, pctOf } = finishedMatchPoints(live.roundDetails);

    for (const trip of PAST_TRIPS) {
      const entry = trip.players.find((p) => p.playerId === player.id);
      if (!entry) continue;
      totalStrokes += entry.totalStrokes;
      roundsPlayed += entry.roundsPlayed;
      points += entry.points;
      birdies += entry.birdies;
      bestRound = bestRound == null ? entry.bestRound : Math.min(bestRound, entry.bestRound);
      pctPoints += entry.points;
      pctOf += entry.roundsPlayed * 3;
    }

    rows.push({
      team: null,
      avatarName: player.name,
      nameHtml: playerLink(player.id, firstName(player.name)),
      avgScore: roundsPlayed > 0 ? totalStrokes / roundsPlayed : null,
      points,
      pctPoints,
      pctOf,
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
        totalStrokes: 0,
        roundsPlayed: 0,
        points: 0,
        birdies: 0,
        bestRound: null,
      };
      acc.totalStrokes += entry.totalStrokes;
      acc.roundsPlayed += entry.roundsPlayed;
      acc.points += entry.points;
      acc.pctOf = (acc.pctOf || 0) + entry.roundsPlayed * 3;
      acc.birdies += entry.birdies;
      acc.bestRound = acc.bestRound == null ? entry.bestRound : Math.min(acc.bestRound, entry.bestRound);
      unmatched[entry.name] = acc;
    }
  }
  for (const [name, acc] of Object.entries(unmatched)) {
    rows.push({
      team: null,
      avatarName: name,
      nameHtml: name,
      avgScore: acc.roundsPlayed > 0 ? acc.totalStrokes / acc.roundsPlayed : null,
      points: acc.points,
      pctPoints: acc.points,
      pctOf: acc.pctOf,
      birdies: acc.birdies,
      bestRound: acc.bestRound,
    });
  }

  rows.sort((a, b) => b.points - a.points || (a.avgScore ?? 999) - (b.avgScore ?? 999));
  return rows;
}

// The last past trip, frozen. Colored by each player's team ON THAT TRIP.
// Kept in the order stored in history-data.js (already final standings).
function lastTripRows() {
  return lastTrip.players.map((p) => ({
    team: p.team,
    avatarName: p.name,
    nameHtml: p.playerId ? playerLink(p.playerId, p.name) : p.name,
    avgScore: p.roundsPlayed > 0 ? p.totalStrokes / p.roundsPlayed : null,
    points: p.points,
    pctPoints: p.points,
    pctOf: p.roundsPlayed * 3,   // 3 points per round played (4 rounds = 12)
    birdies: p.birdies,
    bestRound: p.bestRound,
  }));
}

// ------------------------------------------------------------------
// render(): redraw the tabs and the selected leaderboard. Runs on
// every Firestore update; the live tabs show skeleton rows until the
// players and every round have arrived.
// ------------------------------------------------------------------
function render() {
  const tabsEl = document.getElementById("st-tabs");
  const focusedTab = document.activeElement?.closest?.(".sb-tab")?.dataset.tab;
  tabsEl.innerHTML = TABS.map(
    (t) => `<button type="button" class="sb-tab${t.id === selectedTab ? " is-selected" : ""}"
              data-tab="${t.id}" aria-pressed="${t.id === selectedTab}">
              <span class="sb-tab-day">${t.label}</span>
            </button>`
  ).join("");
  if (focusedTab) tabsEl.querySelector(`[data-tab="${focusedTab}"]`)?.focus();

  const tab = TABS.find((t) => t.id === selectedTab);
  document.getElementById("st-note").textContent = tab.note;

  const board = document.getElementById("st-board");
  const liveReady = playersLoaded && roundsLoaded.size === ROUNDS.length;
  let html;
  if (tab.id === "alltime") html = liveReady ? leaderboardHtml(careerRows()) : SKELETON_TABLE;
  else if (tab.id === String(CURRENT_YEAR)) html = liveReady ? leaderboardHtml(currentRows()) : SKELETON_TABLE;
  else html = leaderboardHtml(lastTripRows());
  board.innerHTML = html;
  if (html === SKELETON_TABLE) board.setAttribute("aria-busy", "true");
  else board.removeAttribute("aria-busy");
}

// Tab taps (one listener for all tabs: "event delegation"). The chosen
// tab goes into the address without adding a Back-button step.
document.getElementById("st-tabs").addEventListener("click", (event) => {
  const button = event.target.closest(".sb-tab");
  if (!button) return;
  selectedTab = button.dataset.tab;
  history.replaceState(null, "", `#${encodeURIComponent(selectedTab)}`);
  render();
});

window.addEventListener("hashchange", () => {
  const id = tabFromHash();
  if (id && id !== selectedTab) {
    selectedTab = id;
    render();
  }
});

render();

onSnapshot(collection(db, "players"), (snapshot) => {
  players = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  playersLoaded = true;
  render();
});

for (const round of ROUNDS) {
  onSnapshot(collection(db, "rounds", round.id, "matches"), (snapshot) => {
    const current = {};
    snapshot.forEach((d) => {
      current[d.id] = d.data();
    });
    matchesByRound[round.id] = current;
    roundsLoaded.add(round.id);
    render();
  });
}
