// Live home-page standings. Subscribes to every round's matches
// subcollection and re-derives USA / EU point totals
// from raw hole scores any time anything changes — for anyone with
// the page open, from anyone else's phone. Internally still uses
// generic 'a'/'b' side identifiers (matches the Firestore data and
// scoring.js) -- team A = USA, team B = EU.
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
import { flash } from "./flash.js";
// formatPoints shows halves as "½" (e.g. 12½); shared with the scoreboard and round pages.
import { formatPoints, CURRENT_YEAR } from "./match-ui.js";
import { TRIP } from "./schedule-config.js";

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

// Header year and location from config (see schedule-config.js), so
// next year's trip only needs the config files updated.
document.getElementById("home-eyebrow").textContent = `${CURRENT_YEAR} Ryder Cup Trip`;
document.getElementById("home-location").innerHTML =
  `<span class="nowrap">${TRIP.courses}</span> · <span class="nowrap">${TRIP.place}</span>`;
document.title = `${CURRENT_YEAR} Ryder Cup Trip — Live Standings`;

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
    <a class="round-card${isTotal ? " round-card-total" : ""}" href="${href}" data-card="${isTotal ? "total" : href}">
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

// ------------------------------------------------------------------
// "Just changed" highlights. render() remembers the numbers it showed
// last time; when called with { highlight: true } (a real update after
// the first load), anything that differs gets flashed.
// ------------------------------------------------------------------
let shown = null;   // the numbers from the previous render, or null before the first

function render({ highlight = false } = {}) {
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

  const cardsEl = document.getElementById("round-cards");
  cardsEl.removeAttribute("aria-busy");   // real cards replace the skeletons now
  cardsEl.innerHTML =
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

  // Compare with the previous render and flash whatever changed.
  const now = {
    totalA, totalB, projTotalA, projTotalB,
    // One short "fingerprint" string per round card: if any of its
    // numbers change, the string changes.
    cards: Object.fromEntries(ROUNDS.map((r) => {
      const t = roundTotals[r.id];
      return [`${r.id}.html`, `${t.a}|${t.b}|${t.projectedA}|${t.projectedB}`];
    })),
  };
  if (highlight && shown) {
    if (now.totalA !== shown.totalA) flash(document.getElementById("score-a"), "usa");
    if (now.totalB !== shown.totalB) flash(document.getElementById("score-b"), "eu");
    if (now.projTotalA !== shown.projTotalA) flash(document.getElementById("projected-a"), "usa");
    if (now.projTotalB !== shown.projTotalB) flash(document.getElementById("projected-b"), "eu");
    let anyCard = false;
    for (const [href, fingerprint] of Object.entries(now.cards)) {
      if (fingerprint !== shown.cards[href]) {
        flash(cardsEl.querySelector(`[data-card="${href}"]`), "card");
        anyCard = true;
      }
    }
    if (anyCard) flash(cardsEl.querySelector('[data-card="total"]'), "card");
  }
  shown = now;
}

render();

// Rounds whose first snapshot has arrived. A round's FIRST snapshot is
// just the page loading (no highlight); every later one is a real
// change from someone's phone (highlight).
const loadedRounds = new Set();

for (const round of ROUNDS) {
  onSnapshot(collection(db, "rounds", round.id, "matches"), (snapshot) => {
    const isUpdate = loadedRounds.has(round.id);
    loadedRounds.add(round.id);
    const matches = snapshot.docs.map((docSnap) => docSnap.data());
    roundTotals[round.id] = {
      // Same totals as before (a, b, projectedA, projectedB)...
      ...sumMatchPoints(matches),
      // ...plus how many matches have all 18 holes in. scoreMatch is
      // the same function sumMatchPoints uses internally; we only read
      // its overall.complete flag here.
      completed: matches.filter((match) => scoreMatch(match).overall.complete).length,
    };
    render({ highlight: isUpdate });
  });
}
