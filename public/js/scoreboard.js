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
// All CSS classes here start with "sb-" (scoreboard), so they can't
// collide with the older .match-card / .hole-* classes that the round
// pages (round.js) still use.

import { db } from "./firebase-init.js";
import {
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { ROUNDS, pointsAvailable } from "./rounds-config.js";
import { COURSES } from "./courses-config.js";
import { scoreMatch, sumMatchPoints, holeWinner, strokeSidesForHole } from "./scoring.js";
import { playerLink } from "./player-stats.js";

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

// Points come in halves: 12.5 is shown as "12½", 0.5 as "½".
function formatPoints(n) {
  const whole = Math.floor(n);
  const fraction = n - whole;
  if (fraction === 0) return String(whole);
  if (fraction === 0.5) return whole === 0 ? "½" : `${whole}½`;
  return String(n);
}

function playerName(id) {
  const p = players.find((pl) => pl.id === id);
  return p ? p.name : "(unknown)";
}

// "Sean Kohn" -> "SK"; a single name -> its first letter; unknown -> "?".
function initials(name) {
  if (name === "(unknown)") return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

// "Thursday" -> "Thu", "Friday AM" -> "Fri AM". Takes the first three
// letters of a word ending in "day" and keeps the rest.
function shortDay(day) {
  return day.replace(/^(\w{3})\w*day/, "$1");
}

// Text for a front 9 / back 9 / overall segment (the chips).
function statusLabel(segment) {
  if (segment.holesEntered === 0) return "—";
  if (segment.margin === 0) return segment.complete ? "Halved" : "All square";
  const leader = segment.margin > 0 ? "USA" : "EU";
  return `${leader} ${Math.abs(segment.margin)} UP`;
}

// Who's ahead in a segment, as a CSS suffix: "usa", "eu" or "level".
// A positive margin means side a (USA) is ahead.
function leaderOf(segment) {
  if (segment.holesEntered === 0 || segment.margin === 0) return "level";
  return segment.margin > 0 ? "usa" : "eu";
}

// The status pill on each card, from the overall (18-hole) segment.
function statusPill(overall) {
  if (overall.holesEntered === 0) {
    return `<span class="sb-pill sb-pill-level">NOT STARTED</span>`;
  }
  const leader = leaderOf(overall);
  const standing =
    overall.margin === 0
      ? overall.complete ? "HALVED" : "ALL SQUARE"
      : `${overall.margin > 0 ? "USA" : "EU"} ${Math.abs(overall.margin)} UP`;
  const text = overall.complete ? `FINAL · ${standing}` : `${standing} · thru ${overall.holesEntered}`;
  return `<span class="sb-pill sb-pill-${leader}">${text}</span>`;
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

// One side of a match card: the players (initials circle + linked
// name, one per line) and that side's points-so-far numeral.
// `trailing` = this side has fewer points, so its numeral is muted.
function sideHtml(side, ids, points, trailing) {
  const playersHtml = ids.length
    ? ids
        .map((id) => {
          const name = playerName(id);
          return `
            <li class="sb-player">
              <span class="sb-initials" aria-hidden="true">${initials(name)}</span>
              <span class="sb-player-name">${playerLink(id, name)}</span>
            </li>
          `;
        })
        .join("")
    : `<li class="sb-player sb-player-tbd">TBD</li>`;

  return `
    <div class="sb-side sb-side-${side}">
      <ul class="sb-players">${playersHtml}</ul>
      <div class="sb-points${trailing ? " is-trailing" : ""}"><span class="visually-hidden">${side === "usa" ? "USA" : "EU"} points: </span>${formatPoints(points)}</div>
    </div>
  `;
}

// One of the three segment chips. The text always says who leads, so
// the color is never the only signal.
function segmentChipHtml(label, segment) {
  return `
    <div class="sb-chip sb-chip-${leaderOf(segment)}">
      <span class="sb-chip-label">${label}</span>
      <span class="sb-chip-value">${statusLabel(segment)}</span>
    </div>
  `;
}

// The hole grid: 18 boxes in a 9-column grid, so holes 1-9 fill the
// first row and 10-18 the second. Each box gets role="img" plus an
// aria-label so a screen reader says e.g. "Hole 7, USA won".
function holeGridHtml(data) {
  const holes = data.holes || {};
  let boxes = "";
  for (let h = 1; h <= 18; h++) {
    const winner = holeWinner(holes[String(h)], h, data);
    let fill = "empty";
    let words = "not played";
    if (winner === "a") { fill = "usa"; words = "USA won"; }
    else if (winner === "b") { fill = "eu"; words = "EU won"; }
    else if (winner === "halved") { fill = "halved"; words = "halved"; }

    // Corner dot: does a player on either side get a handicap stroke here?
    const strokes = strokeSidesForHole(data, h);
    let dot = "";
    if (strokes.a && strokes.b) { dot = " sb-dot-both"; words += ", strokes for both sides"; }
    else if (strokes.a) { dot = " sb-dot-usa"; words += ", stroke for USA"; }
    else if (strokes.b) { dot = " sb-dot-eu"; words += ", stroke for EU"; }

    boxes += `<div class="sb-hole sb-hole-${fill}${dot}" role="img" aria-label="Hole ${h}, ${words}">${h}</div>`;
  }
  return `<div class="sb-holes" role="group" aria-label="Hole by hole, front nine then back nine">${boxes}</div>`;
}

// 4. A whole match card.
function matchCardHtml(matchId, data) {
  const scored = scoreMatch(data);
  const { a, b } = scored.points;
  return `
    <article class="sb-card">
      <div class="sb-card-top">
        <h3 class="sb-match-no">${matchId.replace("match", "Match ")}</h3>
        ${statusPill(scored.overall)}
      </div>
      <div class="sb-sides">
        ${sideHtml("usa", data.sideA || [], a, a < b)}
        <div class="sb-vs" aria-hidden="true"><span>vs</span></div>
        ${sideHtml("eu", data.sideB || [], b, b < a)}
      </div>
      <div class="sb-segments">
        ${segmentChipHtml("Front 9", scored.front)}
        ${segmentChipHtml("Back 9", scored.back)}
        ${segmentChipHtml("Overall", scored.overall)}
      </div>
      ${holeGridHtml(data)}
    </article>
  `;
}

// 5. Legend. The swatches reuse the hole-box classes so they always
// match the grid exactly.
const LEGEND_HTML = `
  <section class="sb-legend" aria-label="Legend">
    <div class="sb-legend-item"><span class="sb-hole sb-hole-usa sb-swatch"></span>USA won hole</div>
    <div class="sb-legend-item"><span class="sb-hole sb-hole-eu sb-swatch"></span>EU won hole</div>
    <div class="sb-legend-item"><span class="sb-hole sb-hole-halved sb-swatch"></span>Halved</div>
    <div class="sb-legend-item"><span class="sb-hole sb-hole-empty sb-swatch"></span>Not played</div>
    <div class="sb-legend-item"><span class="sb-hole sb-hole-empty sb-dot-usa sb-swatch"></span>Handicap stroke (dot color = team)</div>
  </section>
`;

// ------------------------------------------------------------------
// render(): redraw everything from the current data. Runs on every
// Firestore update, so it carefully keeps the reader's place: the page
// scroll position, the tab strip's sideways scroll, and keyboard focus
// on a tab.
// ------------------------------------------------------------------
function render() {
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
  document.getElementById("sb-scorebar").innerHTML = scoreBarHtml(sumMatchPoints(allMatches));

  // 2. Tabs.
  tabsEl.innerHTML = tabsHtml();

  // 3-5. The selected round.
  const round = ROUNDS.find((r) => r.id === selectedRoundId);
  const activeMatches = Object.entries(matchesByRound[round.id])
    .filter(([, data]) => hasPairings(data))
    .sort(([idA], [idB]) => idA.localeCompare(idB));
  const roundTotals = sumMatchPoints(activeMatches.map(([, data]) => data));

  const body = activeMatches.length
    ? activeMatches.map(([matchId, data]) => matchCardHtml(matchId, data)).join("") + LEGEND_HTML
    : `<p class="sb-empty">Pairings haven't been set for this round yet.</p>`;

  document.getElementById("sb-round").innerHTML = roundHeaderHtml(round, roundTotals) + body;

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
  const sticky = document.querySelector(".sb-sticky");
  const roundEl = document.getElementById("sb-round");
  const roundTop = roundEl.getBoundingClientRect().top + window.scrollY - sticky.offsetHeight;
  if (window.scrollY > roundTop) window.scrollTo(0, roundTop);

  // Make sure the chosen tab is fully visible if the strip scrolls.
  document.querySelector(".sb-tab.is-selected")?.scrollIntoView({ block: "nearest", inline: "nearest" });
});

render();

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
    roundsLoaded.add(round.id);
    render();
  });
}
