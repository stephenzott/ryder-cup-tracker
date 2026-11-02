// The "momentum" overview: every currently-active match across every
// round, shown as a strip of colored boxes (one per hole) instead of
// actual scores -- blue = USA won that hole, red = Europe won it,
// grey = halved, empty = not played yet. The point is to see who's
// trending which way across the whole property at a glance; the
// round pages are where you go to see/enter actual strokes.
//
// Read-only: there's nothing to unlock here, this page never writes
// anything to Firestore.

import { db } from "./firebase-init.js";
import {
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { ROUNDS, pointsAvailable, TOTAL_POINTS_AVAILABLE } from "./rounds-config.js";
import { scoreMatch, sumMatchPoints, holeWinner, strokeSidesForHole } from "./scoring.js";

const app = document.getElementById("app");
app.innerHTML = `
  <h1>Scoreboard</h1>
  <p id="totals-line">Loading…</p>
  <div id="rounds"></div>
`;

let players = [];
// roundId -> { matchId -> matchData }
const matchesByRound = {};
for (const round of ROUNDS) {
  matchesByRound[round.id] = {};
}

function playerName(id) {
  const p = players.find((pl) => pl.id === id);
  return p ? p.name : "(unknown)";
}

function statusLabel(segment) {
  if (segment.holesEntered === 0) return "—";
  if (segment.margin === 0) return segment.complete ? "Halved" : "All square";
  const leader = segment.margin > 0 ? "USA" : "EUR";
  return `${leader} ${Math.abs(segment.margin)} UP`;
}

// A hole that hasn't been entered for both sides yet is shown as an
// empty box rather than implying anything about who's "ahead" there.
// `data` carries sideA/sideB/strokesGiven so this reflects NET results
// once strokes given are in play, not just gross strokes.
function holeBoxClass(hole, holeNum, data) {
  const winner = holeWinner(hole, holeNum, data);
  if (winner === "a") return "hole-usa";
  if (winner === "b") return "hole-eur";
  if (winner === "halved") return "hole-halved";
  return "hole-empty";
}

// Same corner-dot marker as the round pages -- blue/red for which
// side has a player getting a stroke here, independent of the box's
// own win/loss/halve fill.
function strokeDotClass(data, holeNum) {
  const { a, b } = strokeSidesForHole(data, holeNum);
  if (a && b) return " stroke-dot-both";
  if (a) return " stroke-dot-a";
  if (b) return " stroke-dot-b";
  return "";
}

function holeStrip(data) {
  const holes = data.holes || {};
  let numbers = "";
  let boxes = "";
  for (let h = 1; h <= 18; h++) {
    numbers += `<div class="hole-num">${h}</div>`;
    boxes += `<div class="hole-box ${holeBoxClass(holes[String(h)], h, data)}${strokeDotClass(data, h)}"></div>`;
    if (h === 9) {
      numbers += `<div class="hole-gap"></div>`;
      boxes += `<div class="hole-gap"></div>`;
    }
  }
  return `
    <div class="hole-strip-numbers">${numbers}</div>
    <div class="hole-strip">${boxes}</div>
  `;
}

function renderMatchRow(matchId, data) {
  const aNames = (data.sideA || []).map(playerName).join(" & ") || "TBD";
  const bNames = (data.sideB || []).map(playerName).join(" & ") || "TBD";
  const scored = scoreMatch(data);

  return `
    <div class="match-card">
      <h4>${matchId.replace("match", "Match ")}: USA (${aNames}) vs EUR (${bNames})</h4>
      <p>
        Front 9: <strong>${statusLabel(scored.front)}</strong> ·
        Back 9: <strong>${statusLabel(scored.back)}</strong> ·
        Overall: <strong>${statusLabel(scored.overall)}</strong><br>
        Points — USA ${scored.points.a}, EUR ${scored.points.b}
      </p>
      ${holeStrip(data)}
    </div>
  `;
}

function render() {
  const allMatches = ROUNDS.flatMap((round) => Object.values(matchesByRound[round.id]));
  const totals = sumMatchPoints(allMatches);
  document.getElementById("totals-line").innerHTML =
    `<strong>United States ${totals.a} – Europe ${totals.b}</strong> ` +
    `(of ${TOTAL_POINTS_AVAILABLE}) · projected if current margins held: ` +
    `United States ${totals.projectedA} – Europe ${totals.projectedB}`;

  const roundsHtml = ROUNDS.map((round) => {
    const activeMatches = Object.entries(matchesByRound[round.id]).filter(
      ([, data]) => (data.sideA || []).length > 0 || (data.sideB || []).length > 0
    );
    // Rounds nobody's set pairings for yet don't show up at all --
    // this page is "what's happening," not the full trip schedule.
    if (activeMatches.length === 0) return "";

    const roundTotals = sumMatchPoints(activeMatches.map(([, data]) => data));
    const matchRows = activeMatches
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([matchId, data]) => renderMatchRow(matchId, data))
      .join("");

    return `
      <h2>${round.label}</h2>
      <p>${round.day} — ${round.format} · USA ${roundTotals.a}, EUR ${roundTotals.b}
         (of ${pointsAvailable(round)}) · projected USA ${roundTotals.projectedA}, EUR ${roundTotals.projectedB}</p>
      ${matchRows}
    `;
  }).join("");

  document.getElementById("rounds").innerHTML =
    roundsHtml || "<p><em>No matches set up yet.</em></p>";
}

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
    render();
  });
}
