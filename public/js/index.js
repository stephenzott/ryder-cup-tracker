// Live home-page standings. Subscribes to every round's matches
// subcollection and re-derives United States / Europe point totals
// from raw hole scores any time anything changes — for anyone with
// the page open, from anyone else's phone. Internally still uses
// generic 'a'/'b' side identifiers (matches the Firestore data and
// scoring.js) -- team A = United States, team B = Europe.
//
// The math (sumMatchPoints, pointsAvailable, TOTAL_POINTS_AVAILABLE)
// is unchanged from before the restyle. What changed is only WHERE the
// results are written: a score banner, a tug-of-war bar, and one card
// per round instead of two tables.

import { db } from "./firebase-init.js";
import {
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { ROUNDS, pointsAvailable, TOTAL_POINTS_AVAILABLE } from "./rounds-config.js";
import { sumMatchPoints, scoreMatch } from "./scoring.js";

// ------------------------------------------------------------------
// Number display. Points only ever come in halves (a halved segment
// is 0.5 each), so we show 12.5 as "12½" and 0.5 as "½", the
// traditional way match-play scores are written. Anything that isn't
// a whole or half number (shouldn't happen) is shown as-is.
// ------------------------------------------------------------------
function formatPoints(n) {
  const whole = Math.floor(n);
  const fraction = n - whole;
  if (fraction === 0) return String(whole);
  if (fraction === 0.5) return whole === 0 ? "½" : `${whole}½`;
  return String(n);
}

// Width of a tug-of-war fill, as a CSS percentage: this side's points
// as a share of everything available, capped at 100% just in case.
function barPercent(points, available) {
  if (available <= 0) return "0%";
  return `${Math.min(100, (points / available) * 100)}%`;
}

// ------------------------------------------------------------------
// Things that never change while the page is open (they come from the
// static rounds-config.js), so they're written once, right away.
// ------------------------------------------------------------------
const POINTS_TO_WIN = TOTAL_POINTS_AVAILABLE / 2 + 0.5;

// Total matches across the trip, summed from the config rather than
// typed in, so it stays right if a round's matchCount ever changes.
const TOTAL_MATCHES = ROUNDS.reduce((sum, round) => sum + round.matchCount, 0);

document.getElementById("intro-blurb").textContent =
  `16 players, 4 rounds, straight Nassau scoring (1 point front 9, 1 point back 9, ` +
  `1 point overall — no auto presses). ${TOTAL_POINTS_AVAILABLE} points total are up for ` +
  `grabs; ${formatPoints(POINTS_TO_WIN)} wins it outright, ${formatPoints(TOTAL_POINTS_AVAILABLE / 2)} is a tie.`;

document.querySelectorAll(".to-win").forEach((el) => {
  el.textContent = formatPoints(POINTS_TO_WIN);
});

// ------------------------------------------------------------------
// The ⓘ button next to "Projected": tap to show the explanation, tap
// again to hide it. The `hidden` attribute hides an element; flipping
// it is all that's needed. aria-expanded is kept in step so screen
// readers announce "expanded"/"collapsed".
// ------------------------------------------------------------------
const infoButton = document.getElementById("projected-info-btn");
const projectedNote = document.getElementById("projected-note");
infoButton.addEventListener("click", () => {
  const opening = projectedNote.hidden;
  projectedNote.hidden = !opening;
  infoButton.setAttribute("aria-expanded", String(opening));
});

// Points earned so far, per round, kept up to date by each round's own
// onSnapshot listener below. Starts at 0 for every round so the page
// renders immediately instead of waiting on 4 separate network
// round-trips first. `completed` = how many of that round's matches
// have all 18 holes in (new for the "Matches complete" chip).
const roundTotals = {};
for (const round of ROUNDS) {
  roundTotals[round.id] = { a: 0, b: 0, projectedA: 0, projectedB: 0, completed: 0 };
}

// ------------------------------------------------------------------
// One "How we got here" card. Used for each round and for the Total
// card, so they always look alike.
//   title     bold condensed line, e.g. "Friday AM · Greensomes"
//   subtitle  small muted line, e.g. the course name
//   href      the page the card opens
// The mini bar works like the big one: red grows from the left by
// USA's share of this card's points, blue from the right by EU's.
// ------------------------------------------------------------------
function roundCardHtml({ title, subtitle, href, available, a, b, projectedA, projectedB, isTotal }) {
  return `
    <a class="round-card${isTotal ? " round-card-total" : ""}" href="${href}">
      <div class="round-card-top">
        <div>
          <div class="round-card-title">${title}</div>
          <div class="round-card-subtitle">${subtitle}</div>
        </div>
        <div class="round-card-available">${formatPoints(available)}<span> pts</span></div>
      </div>
      <div class="mini-score">
        <span class="mini-score-usa">${formatPoints(a)}</span>
        <div class="mini-bar" aria-hidden="true">
          <div class="mini-fill mini-fill-usa" style="width: ${barPercent(a, available)}"></div>
          <div class="mini-fill mini-fill-eu" style="width: ${barPercent(b, available)}"></div>
        </div>
        <span class="mini-score-eu">${formatPoints(b)}</span>
      </div>
      <div class="round-card-projected">Projected ${formatPoints(projectedA)} – ${formatPoints(projectedB)}</div>
    </a>
  `;
}

function render() {
  let totalA = 0;
  let totalB = 0;
  let projTotalA = 0;
  let projTotalB = 0;
  let completedMatches = 0;

  const cardsHtml = ROUNDS.map((round) => {
    const { a, b, projectedA, projectedB, completed } = roundTotals[round.id];
    totalA += a;
    totalB += b;
    projTotalA += projectedA;
    projTotalB += projectedB;
    completedMatches += completed;
    return roundCardHtml({
      title: `${round.day} · ${round.format}`,
      subtitle: round.course,
      href: `${round.id}.html`,
      available: pointsAvailable(round),
      a,
      b,
      projectedA,
      projectedB,
    });
  }).join("");

  document.getElementById("round-cards").innerHTML =
    cardsHtml +
    roundCardHtml({
      title: "Total",
      subtitle: "All four rounds · full scoreboard",
      href: "scoreboard.html",
      available: TOTAL_POINTS_AVAILABLE,
      a: totalA,
      b: totalB,
      projectedA: projTotalA,
      projectedB: projTotalB,
      isTotal: true,
    });

  // Score banner and tug-of-war bar.
  document.getElementById("score-a").textContent = formatPoints(totalA);
  document.getElementById("score-b").textContent = formatPoints(totalB);
  document.getElementById("tug-usa").style.width = barPercent(totalA, TOTAL_POINTS_AVAILABLE);
  document.getElementById("tug-eu").style.width = barPercent(totalB, TOTAL_POINTS_AVAILABLE);

  // Projected row and matches-complete chip.
  document.getElementById("projected-a").textContent = formatPoints(projTotalA);
  document.getElementById("projected-b").textContent = formatPoints(projTotalB);
  document.getElementById("matches-complete").textContent = `${completedMatches} of ${TOTAL_MATCHES}`;
}

render();

for (const round of ROUNDS) {
  onSnapshot(collection(db, "rounds", round.id, "matches"), (snapshot) => {
    const matches = snapshot.docs.map((docSnap) => docSnap.data());
    roundTotals[round.id] = {
      // Same totals as before (a, b, projectedA, projectedB)...
      ...sumMatchPoints(matches),
      // ...plus how many matches have all 18 holes in. scoreMatch is
      // the same function sumMatchPoints uses internally; we only read
      // its overall.complete flag here.
      completed: matches.filter((match) => scoreMatch(match).overall.complete).length,
    };
    render();
  });
}
