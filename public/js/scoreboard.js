// The scoreboard: the main "what's happening right now" screen.
//
// Layout (top to bottom):
//   1. A pinned navy block with the overall score (USA | EU) and one
//      tab per round (session).
//   2. For the selected round: a header (course, tee, round score).
//   3. One card per match: status pill, both sides with points, front
//      9 / back 9 / overall chips, and an 18-box hole grid colored by
//      who won each hole.
//   4. A legend explaining the colors.
//
// Read-only: this page never writes anything to Firestore. All the
// scoring comes from scoring.js (scoreMatch, sumMatchPoints,
// holeWinner, strokeSidesForHole); this file only decides how to DRAW
// the results.
//
// Internally the two sides are 'a' and 'b' (that's how the Firestore
// data and scoring.js name them): a = USA, b = EU.
//
// All CSS classes here start with "sb-" (scoreboard). The match pieces
// (pill, sides, chips, hole grid) are shared with the round pages via
// match-ui.js.

import { db } from "./firebase-init.js";
import {
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { ROUNDS, pointsAvailable } from "./rounds-config.js";
import { COURSES } from "./courses-config.js";
import { scoreMatch, sumMatchPoints } from "./scoring.js";
import { flash } from "./flash.js";
// Shared match-drawing pieces (also used by the round pages).
import {
  formatPoints,
  statusPill,
  sidesHtml,
  segmentChipsHtml,
  holeGridHtml,
  LEGEND_HTML,
  SKELETON_CARD,
} from "./match-ui.js";

// ------------------------------------------------------------------
// Page skeleton. The three containers are filled by render() below.
// The <h1> is "visually hidden": invisible on screen (the score bar
// is the visual headline) but still read out by screen readers as the
// page title. A standard accessibility pattern.
// ------------------------------------------------------------------
const app = document.getElementById("app");
app.innerHTML = `
  <h1 class="visually-hidden">Scoreboard</h1>
  <div class="sb-sticky">
    <div class="sb-scorebar" id="sb-scorebar"></div>
    <div class="sb-tabs" id="sb-tabs" role="group" aria-label="Choose a round"></div>
  </div>
  <div id="sb-round"></div>
`;

// ------------------------------------------------------------------
// Data, kept up to date by the Firestore listeners at the bottom.
// ------------------------------------------------------------------
let players = [];
// roundId -> { matchId -> matchData }
const matchesByRound = {};
for (const round of ROUNDS) {
  matchesByRound[round.id] = {};
}
// Which rounds' listeners have reported at least once. Used to know
// when the "best default tab" can stop being recalculated.
const roundsLoaded = new Set();
// Whether the players list has arrived (until then names would show
// as "(unknown)", so the cards wait behind skeletons).
let playersLoaded = false;

// "Just changed" bookkeeping for the highlights (see render()).
// pendingCardFlashes: "round1/match2"-style keys of matches whose data
//   changed in a LATER snapshot (not the first load); render() flashes
//   their cards if they're on screen, then clears the set.
// shownPoints: each match's points the last time it was drawn, to know
//   which side's numeral to pulse.
// shownTotals: the score bar's numbers last time.
const pendingCardFlashes = new Set();
const shownPoints = {};
let shownTotals = null;

// ------------------------------------------------------------------
// Which round tab is selected.
//
// Kept in a module-level variable (survives every re-render, since
// render() runs again on every Firestore update) and, once someone
// taps a tab, in the address bar as "#round2" so a reload or a shared
// link opens the same round.
//
// `selectionLocked` = stop auto-picking. True once someone taps a tab,
// once the address already names a round, or once every round's data
// has arrived and we've made our final default pick.
// ------------------------------------------------------------------
let selectedRoundId = ROUNDS[0].id;
let selectionLocked = false;

function roundFromHash() {
  const id = location.hash.slice(1);   // "#round2" -> "round2"
  return ROUNDS.some((r) => r.id === id) ? id : null;
}

const hashRound = roundFromHash();
if (hashRound) {
  selectedRoundId = hashRound;
  selectionLocked = true;
}

// If someone edits the #round in the address bar by hand.
window.addEventListener("hashchange", () => {
  const id = roundFromHash();
  if (id && id !== selectedRoundId) {
    selectedRoundId = id;
    selectionLocked = true;
    render();
  }
});

// A match "has pairings" once anyone is assigned to either side.
// Matches without pairings aren't shown (same rule as before).
function hasPairings(data) {
  return (data.sideA || []).length > 0 || (data.sideB || []).length > 0;
}

// Best default tab. There's no timestamp on hole scores, so "the round
// with the most recent hole entered" is approximated as the LATEST
// round in schedule order that has any hole entered. Rounds are played
// in order, so that's the one in progress. Otherwise, the first round
// with pairings; otherwise Round 1.
function pickDefaultRound() {
  for (let i = ROUNDS.length - 1; i >= 0; i--) {
    const matches = Object.values(matchesByRound[ROUNDS[i].id]);
    if (matches.some((m) => scoreMatch(m).overall.holesEntered > 0)) return ROUNDS[i].id;
  }
  const withPairings = ROUNDS.find((r) => Object.values(matchesByRound[r.id]).some(hasPairings));
  return withPairings ? withPairings.id : ROUNDS[0].id;
}

// ------------------------------------------------------------------
// Small formatting helpers
// ------------------------------------------------------------------

function playerName(id) {
  const p = players.find((pl) => pl.id === id);
  return p ? p.name : "(unknown)";
}

// "Thursday" -> "Thu", "Friday AM" -> "Fri AM". Takes the first three
// letters of a word ending in "day" and keeps the rest.
function shortDay(day) {
  return day.replace(/^(\w{3})\w*day/, "$1");
}

// ------------------------------------------------------------------
// Pieces of the page, each returning an HTML string.
// ------------------------------------------------------------------

// 1. The pinned overall score.
function scoreBarHtml(totals) {
  return `
    <div class="sb-scorebar-side sb-scorebar-usa">
      <span class="sb-scorebar-team">Team USA</span>
      <span class="sb-scorebar-points">${formatPoints(totals.a)}</span>
    </div>
    <div class="sb-scorebar-side sb-scorebar-eu">
      <span class="sb-scorebar-points">${formatPoints(totals.b)}</span>
      <span class="sb-scorebar-team">Team EU</span>
    </div>
  `;
}

// 2. One tab button per round. aria-pressed tells screen readers which
// one is selected (it reads as "pressed").
function tabsHtml() {
  return ROUNDS.map((round) => {
    const selected = round.id === selectedRoundId;
    return `
      <button type="button" class="sb-tab${selected ? " is-selected" : ""}"
              data-round-id="${round.id}" aria-pressed="${selected}">
        <span class="sb-tab-day">${shortDay(round.day)}</span>
        <span class="sb-tab-format">${round.format}</span>
      </button>
    `;
  }).join("");
}

// 3. Header for the selected round.
function roundHeaderHtml(round, roundTotals) {
  const course = COURSES[round.id];
  const courseLine = course ? `${course.name} · ${course.tee} tees` : round.course;
  return `
    <header class="sb-round-head">
      <h2 class="sb-round-title">${round.label}</h2>
      <div class="sb-round-course">${courseLine}</div>
      <div class="sb-round-score">
        <span class="sb-usa-text">USA ${formatPoints(roundTotals.a)}</span>
        <span class="sb-dash">–</span>
        <span class="sb-eu-text">EU ${formatPoints(roundTotals.b)}</span>
        <span class="sb-round-available">of ${pointsAvailable(round)} available</span>
      </div>
      <div class="sb-round-proj">
        Projected USA ${formatPoints(roundTotals.projectedA)} – EU ${formatPoints(roundTotals.projectedB)}
      </div>
    </header>
  `;
}

// 4. A whole match card.
// The pieces (pill, sides, chips, hole grid) come from match-ui.js.
function matchCardHtml(round, matchId, data) {
  const scored = scoreMatch(data);
  const people = (ids) => ids.map((id) => ({ id, name: playerName(id) }));
  return `
    <article class="sb-card" data-match-key="${round.id}/${matchId}">
      <div class="sb-card-top">
        <h3 class="sb-match-no">${matchId.replace("match", "Match ")}</h3>
        ${statusPill(scored.overall)}
      </div>
      ${sidesHtml(people(data.sideA || []), people(data.sideB || []), scored.points)}
      ${segmentChipsHtml(scored)}
      ${holeGridHtml(data)}
    </article>
  `;
}

const SKELETON_HTML = `<div class="sb-cards">${SKELETON_CARD.repeat(3)}</div>`;

// ------------------------------------------------------------------
// render(): redraw everything from the current data. Runs on every
// Firestore update, so it carefully keeps the reader's place: the page
// scroll position, the tab strip's sideways scroll, and keyboard focus
// on a tab.
// ------------------------------------------------------------------
function render({ highlight = false } = {}) {
  // Auto-pick the default tab until it's locked in (see above).
  if (!selectionLocked) {
    selectedRoundId = pickDefaultRound();
    if (roundsLoaded.size === ROUNDS.length) selectionLocked = true;
  }

  // Remember where the reader is before replacing any HTML.
  const savedScrollY = window.scrollY;
  const tabsEl = document.getElementById("sb-tabs");
  const savedTabsScroll = tabsEl.scrollLeft;
  const focusedTabId = document.activeElement?.closest?.(".sb-tab")?.dataset.roundId;

  // 1. Overall score (all rounds, all matches -- same as before).
  const allMatches = ROUNDS.flatMap((round) => Object.values(matchesByRound[round.id]));
  const totals = sumMatchPoints(allMatches);
  document.getElementById("sb-scorebar").innerHTML = scoreBarHtml(totals);

  // 2. Tabs.
  tabsEl.innerHTML = tabsHtml();

  // 3-5. The selected round.
  const round = ROUNDS.find((r) => r.id === selectedRoundId);
  const activeMatches = Object.entries(matchesByRound[round.id])
    .filter(([, data]) => hasPairings(data))
    .sort(([idA], [idB]) => idA.localeCompare(idB));
  const roundTotals = sumMatchPoints(activeMatches.map(([, data]) => data));

  const loaded = roundsLoaded.has(round.id) && playersLoaded;
  let body;
  if (!loaded) body = SKELETON_HTML;
  // Cards go in a .sb-cards wrapper: one column on phones, two side by
  // side on wider screens (see style.css).
  else if (activeMatches.length) {
    body = `<div class="sb-cards">${activeMatches.map(([matchId, data]) => matchCardHtml(round, matchId, data)).join("")}</div>` + LEGEND_HTML;
  }
  else body = `<p class="sb-empty">Pairings haven't been set for this round yet.</p>`;

  const roundEl = document.getElementById("sb-round");
  roundEl.innerHTML = roundHeaderHtml(round, roundTotals) + body;
  // aria-busy tells screen readers this area is still loading.
  if (loaded) roundEl.removeAttribute("aria-busy");
  else roundEl.setAttribute("aria-busy", "true");

  // "Just changed" highlights, only for real updates after the first load.
  const scorebar = document.getElementById("sb-scorebar");
  if (highlight && shownTotals) {
    if (totals.a !== shownTotals.a) flash(scorebar.querySelector(".sb-scorebar-usa .sb-scorebar-points"), "usa");
    if (totals.b !== shownTotals.b) flash(scorebar.querySelector(".sb-scorebar-eu .sb-scorebar-points"), "eu");
  }
  shownTotals = totals;
  for (const [matchId, data] of activeMatches) {
    const key = `${round.id}/${matchId}`;
    const points = scoreMatch(data).points;
    const before = shownPoints[key];
    if (pendingCardFlashes.has(key)) {
      const card = roundEl.querySelector(`[data-match-key="${key}"]`);
      flash(card, "card");
      if (before && points.a !== before.a) flash(card?.querySelector(".sb-side-usa .sb-points"), "usa");
      if (before && points.b !== before.b) flash(card?.querySelector(".sb-side-eu .sb-points"), "eu");
    }
    shownPoints[key] = points;
  }
  pendingCardFlashes.clear();

  // Put the reader back where they were.
  tabsEl.scrollLeft = savedTabsScroll;
  if (window.scrollY !== savedScrollY) window.scrollTo(0, savedScrollY);
  if (focusedTabId) tabsEl.querySelector(`[data-round-id="${focusedTabId}"]`)?.focus();
}

// ------------------------------------------------------------------
// Tab taps. One listener on the tab strip handles every tab (they're
// re-created on each render, so listeners on the buttons themselves
// would be lost). A standard technique called "event delegation".
// ------------------------------------------------------------------
document.getElementById("sb-tabs").addEventListener("click", (event) => {
  const tab = event.target.closest(".sb-tab");
  if (!tab) return;
  selectedRoundId = tab.dataset.roundId;
  selectionLocked = true;
  // replaceState changes the address to "#round2" WITHOUT adding a
  // history step, so the phone's Back button leaves the page rather
  // than stepping back through tabs.
  history.replaceState(null, "", `#${selectedRoundId}`);
  render();

  // If the reader had scrolled down into the previous round's cards,
  // jump up so the new round starts just under the pinned block.
  // The pinned area's visible bottom edge. In portrait that's the whole
  // pinned block (score bar + tabs). On short landscape screens only the
  // score bar is pinned and the block itself has no box (its size reads
  // as 0), so take whichever bottom edge is lower.
  const stickyBottom = Math.max(
    0,
    document.querySelector(".sb-sticky").getBoundingClientRect().bottom,
    document.getElementById("sb-scorebar").getBoundingClientRect().bottom
  );
  const roundEl = document.getElementById("sb-round");
  const roundTop = roundEl.getBoundingClientRect().top + window.scrollY - stickyBottom;
  if (window.scrollY > roundTop) window.scrollTo(0, roundTop);

  // Make sure the chosen tab is fully visible if the strip scrolls.
  document.querySelector(".sb-tab.is-selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
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

    // After the first load, note which matches actually changed so
    // render() can highlight them. JSON.stringify turns a match's data
    // into one string, a simple way to compare "is anything different?"
    const isUpdate = roundsLoaded.has(round.id);
    if (isUpdate) {
      for (const [matchId, data] of Object.entries(current)) {
        const previous = matchesByRound[round.id][matchId];
        if (JSON.stringify(previous) !== JSON.stringify(data)) {
          pendingCardFlashes.add(`${round.id}/${matchId}`);
        }
      }
    }

    matchesByRound[round.id] = current;
    roundsLoaded.add(round.id);
    render({ highlight: isUpdate });
  });
}
