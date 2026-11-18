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
// page so numbers never disagree between pages. The All-time tab and
// the player card's all-time tiles both use computeCareerStats.
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
import {
  computePlayerStats,
  computeCareerStats,
  allPeople,
  shortNames,
  personLink,
  formatToPar,
} from "./player-stats.js";
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
    note: `This year, live. Tap a column heading to sort by it. "—" means not enough data yet (a stat only counts a round once all 18 holes are in). Tap a name for their full card.`,
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
// A row: { team, avatarName, nameHtml, sortName, avgScore, points,
//         pctPoints, pctOf, birdies, bestRound }   (pct = pctPoints / pctOf)
//   sortName = the name as plain text (nameHtml may be a link), for A-to-Z.
//   team = "A"/"B"/"usa"/"europe" to color the initials circle, or null
//   for neutral navy.
// ------------------------------------------------------------------

// ------------------------------------------------------------------
// Sortable columns. Tapping a heading sorts by that column, "best
// first" (the leader on top); tapping the same heading again flips
// it. The choice is shared by all three tabs and resets on reload,
// since it lives in a plain variable, not in storage.
//
// Each column says how to read its value off a row (value), whether a
// bigger or smaller value is better (better), and its heading text.
// A value of null means "no data yet" ("—" in the table); those rows
// always go to the bottom, whichever way the column is sorted.
// ------------------------------------------------------------------
const COLUMNS = [
  { key: "name",    label: "Player", title: null,                                  better: "low",  value: (r) => r.sortName.toLowerCase() },
  { key: "points",  label: "Pts",    title: "Points",                              better: "high", value: (r) => r.points },
  { key: "pct",     label: "Pct",    title: "Points percentage, finished matches", better: "high", value: (r) => (r.pctOf > 0 ? r.pctPoints / r.pctOf : null) },
  { key: "avg",     label: "Avg",    title: "Average score",                       better: "low",  value: (r) => r.avgScore },
  { key: "birdies", label: "Bir",    title: "Birdies or better",                   better: "high", value: (r) => r.birdies },
  { key: "best",    label: "Best",   title: "Best round versus par",               better: "low",  value: (r) => r.bestRound },
];
const columnByKey = (key) => COLUMNS.find((c) => c.key === key);

// The current sort: which column, and whether it's flipped from
// "best first" to "worst first". Default is points, leader on top.
let sortKey = "points";
let sortReversed = false;

// compareBest(column, a, b): the comparison rule a sort uses, written
// so that "a comes first" gives a negative number. It puts the BETTER
// value first, and "no data" (null) after every real value. Strings
// (player names) compare alphabetically, numbers by size.
function compareBest(column, a, b) {
  const va = column.value(a);
  const vb = column.value(b);
  if (va == null && vb == null) return 0;
  if (va == null) return 1;    // a has no data -> a goes after b
  if (vb == null) return -1;
  const ascending = typeof va === "string" ? va.localeCompare(vb) : va - vb;
  return column.better === "low" ? ascending : -ascending;
}

// The standard leaderboard order: points (most first), then average
// score (lowest first) to split ties. Used as the tie-breaker for every
// other column too, so e.g. two players with 4 birdies appear in
// standings order rather than at random.
function compareStandings(a, b) {
  return compareBest(columnByKey("points"), a, b) || compareBest(columnByKey("avg"), a, b);
}

// Two rows "tie" in a column, i.e. share a rank, when they have the same
// value. On the Pts column the average must match too (the old rule),
// since that's how the standings break ties.
function tiedIn(column, a, b) {
  if (column.key === "points") return compareStandings(a, b) === 0;
  return compareBest(column, a, b) === 0;
}

// Rank labels for rows already sorted BEST FIRST by `column`: 1, 2,
// "T3", "T3", 5... Rows with no data in that column get "—" rather than
// a rank. Returns a Map from row -> label, so the labels can follow the
// rows if the table is then shown flipped (worst first, so the bottom
// row reads 1).
function rankLabels(bestFirstRows, column) {
  const numbers = [];
  bestFirstRows.forEach((row, i) => {
    const prev = bestFirstRows[i - 1];
    numbers.push(prev && tiedIn(column, prev, row) ? numbers[i - 1] : i + 1);
  });
  const labels = new Map();
  bestFirstRows.forEach((row, i) => {
    const tied = numbers[i - 1] === numbers[i] || numbers[i + 1] === numbers[i];
    let label = tied ? `T${numbers[i]}` : String(numbers[i]);
    if (column.value(row) == null) label = "—";
    labels.set(row, label);
  });
  return labels;
}

// sortRows(rows): returns { rows, labels }: the rows in display order
// for the current sort, and each row's rank label.
//   - Sorted by a stat: ranks are by that stat.
//   - Sorted by Player (A to Z): an alphabetical "rank" means nothing,
//     so the # column keeps showing the points standings.
// "Worst first" reverses only the rows that have data; the "—" rows
// stay at the bottom either way.
function sortRows(rows) {
  const column = columnByKey(sortKey);
  // [...rows] copies the list first, so sort() doesn't reorder the
  // caller's array in place (a common JavaScript gotcha).
  const bestFirst = [...rows].sort((a, b) => compareBest(column, a, b) || compareStandings(a, b));

  const rankColumn = column.key === "name" ? columnByKey("points") : column;
  const rankSource = column.key === "name" ? [...rows].sort(compareStandings) : bestFirst;
  const labels = rankLabels(rankSource, rankColumn);

  if (!sortReversed) return { rows: bestFirst, labels };
  const withData = bestFirst.filter((r) => column.value(r) != null);
  const noData = bestFirst.filter((r) => column.value(r) == null);
  return { rows: [...withData.reverse(), ...noData], labels };
}

// One column heading: a button that sorts by that column. aria-sort
// tells screen readers which column is sorted and which way. The arrow
// shows the direction of the numbers (▼ = biggest at top, ▲ =
// smallest at top); its space is always reserved, so the columns don't
// shift sideways when the arrow moves from one column to another.
function headingHtml(column) {
  const active = column.key === sortKey;
  // "Best first" on a high-is-better column means biggest at the top.
  const biggestOnTop = (column.better === "high") !== sortReversed;
  const arrow = active ? (biggestOnTop ? "▼" : "▲") : "";
  const ariaSort = active ? ` aria-sort="${biggestOnTop ? "descending" : "ascending"}"` : "";
  const text = column.title ? `<abbr title="${column.title}">${column.label}</abbr>` : column.label;
  const numeric = column.key !== "name";
  // For right-aligned number columns the arrow sits on the left, so the
  // heading text stays lined up with the numbers below it.
  const arrowHtml = `<span class="lb-sort-arrow" aria-hidden="true">${arrow}</span>`;
  return `
    <th class="${numeric ? "lb-num " : ""}lb-sortable${active ? " is-sorted" : ""}" scope="col"${ariaSort}>
      <button type="button" class="lb-sort" data-sort="${column.key}">
        ${numeric ? arrowHtml + text : text + arrowHtml}
      </button>
    </th>`;
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

function leaderboardHtml(unsortedRows) {
  if (unsortedRows.length === 0) return `<p class="sb-empty">No players yet.</p>`;
  const { rows, labels } = sortRows(unsortedRows);
  const body = rows
    .map(
      (r) => `
        <tr>
          <td class="lb-rank">${labels.get(r)}</td>
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
            ${COLUMNS.map(headingHtml).join("")}
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

// Names in every table: first names, or "Sean O." / "Sean K." when two
// people in the same table share a first name (shortNames in
// player-stats.js). Every name links to that person's card by name,
// player.html?p=<slug>, which works whether or not they're on this
// year's roster.

// This year, live. Colored by this year's team.
function currentRows() {
  const short = shortNames(players.map((p) => p.name));
  return players.map((player) => {
    const stats = computePlayerStats(player.id, matchesByRound);
    const name = short.get(player.name);
    return {
      team: player.team,
      avatarName: player.name,
      nameHtml: personLink(player.name, name),
      sortName: name,
      avgScore: stats.avgScore,
      points: stats.points,
      ...finishedMatchPoints(stats.roundDetails),
      birdies: stats.birdies,
      bestRound: stats.bestRound,
    };
  });
}

// All-time: everyone who has ever played (this year's roster plus past
// players not on it), each with their past trips and this year added
// together by computeCareerStats -- the same function the player card
// uses. Neutral color (team: null) because these rows mix years with
// different teams.
function careerRows() {
  const people = allPeople(players);
  const short = shortNames(people.map((p) => p.fullName));
  return people.map(({ fullName, rosterPlayer }) => {
    const career = computeCareerStats(fullName, rosterPlayer, matchesByRound);
    const name = short.get(fullName);
    return {
      team: null,
      avatarName: fullName,
      nameHtml: personLink(fullName, name),
      sortName: name,
      avgScore: career.avgScore,
      points: career.points,
      pctPoints: career.pctPoints,
      pctOf: career.pctOf,
      birdies: career.birdies,
      bestRound: career.bestRound,
    };
  });
}

// The last past trip, frozen. Colored by each player's team ON THAT TRIP.
function lastTripRows() {
  const short = shortNames(lastTrip.players.map((p) => p.fullName));
  return lastTrip.players.map((p) => {
    const name = short.get(p.fullName);
    return {
      team: p.team,
      avatarName: p.fullName,
      nameHtml: personLink(p.fullName, name),
      sortName: name,
      avgScore: p.roundsPlayed > 0 ? p.totalStrokes / p.roundsPlayed : null,
      points: p.points,
      pctPoints: p.points,
      pctOf: p.roundsPlayed * 3,   // 3 points per round played (4 rounds = 12)
      birdies: p.birdies,
      bestRound: p.bestRound,
    };
  });
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
  // Redrawing replaces the table, which would drop keyboard focus from
  // a sort heading the user just pressed; note which one had focus and
  // put it back after (same trick as the tabs above).
  const focusedSort = document.activeElement?.closest?.(".lb-sort")?.dataset.sort;
  board.innerHTML = html;
  if (focusedSort) board.querySelector(`[data-sort="${focusedSort}"]`)?.focus();
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

// Sort-heading taps. The table is rebuilt on every render, so the
// listener goes on the board around it (which is never replaced) and
// checks which heading was tapped: "event delegation" again.
// Same heading as now: flip the direction. New heading: best first.
document.getElementById("st-board").addEventListener("click", (event) => {
  const button = event.target.closest(".lb-sort");
  if (!button) return;
  const key = button.dataset.sort;
  if (key === sortKey) {
    sortReversed = !sortReversed;
  } else {
    sortKey = key;
    sortReversed = false;
  }
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
