// Live home-page standings. Subscribes to every round's matches
// subcollection and re-derives Team A / Team B point totals from raw
// hole scores any time anything changes — for anyone with the page
// open, from anyone else's phone.

import { db } from "./firebase-init.js";
import {
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { ROUNDS, pointsAvailable, TOTAL_POINTS_AVAILABLE } from "./rounds-config.js";
import { scoreMatch } from "./scoring.js";

document.getElementById("intro-blurb").textContent =
  `16 players, 4 rounds, straight Nassau scoring (1 point front 9, 1 point back 9, ` +
  `1 point overall — no auto presses). ${TOTAL_POINTS_AVAILABLE} points total are up for ` +
  `grabs; ${TOTAL_POINTS_AVAILABLE / 2 + 0.5} wins it outright, ${TOTAL_POINTS_AVAILABLE / 2} is a tie.`;

// Points earned so far, per round, kept up to date by each round's own
// onSnapshot listener below. Starts at 0 for every round so the page
// renders immediately instead of waiting on 4 separate network
// round-trips first.
const roundTotals = {};
for (const round of ROUNDS) {
  roundTotals[round.id] = { a: 0, b: 0 };
}

function render() {
  let totalA = 0;
  let totalB = 0;

  const rowsHtml = ROUNDS.map((round) => {
    const { a, b } = roundTotals[round.id];
    totalA += a;
    totalB += b;
    return `
      <tr>
        <td>${round.day} — ${round.course.split("—").pop().trim()} (${round.format})</td>
        <td>${pointsAvailable(round)}</td>
        <td>${a}</td>
        <td>${b}</td>
      </tr>
    `;
  }).join("");

  document.getElementById("rounds-rows").innerHTML =
    rowsHtml +
    `
      <tr>
        <td><strong>Total</strong></td>
        <td><strong>${TOTAL_POINTS_AVAILABLE}</strong></td>
        <td><strong>${totalA}</strong></td>
        <td><strong>${totalB}</strong></td>
      </tr>
    `;

  document.getElementById("score-a").textContent = totalA;
  document.getElementById("score-b").textContent = totalB;
}

render();

for (const round of ROUNDS) {
  onSnapshot(collection(db, "rounds", round.id, "matches"), (snapshot) => {
    let a = 0;
    let b = 0;
    snapshot.forEach((docSnap) => {
      const holes = docSnap.data().holes || {};
      const points = scoreMatch(holes).points;
      a += points.a;
      b += points.b;
    });
    roundTotals[round.id] = { a, b };
    render();
  });
}
