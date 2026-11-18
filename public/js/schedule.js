// Builds the Schedule page from the config files, so the page itself
// never needs editing from year to year:
//   rounds-config.js   day, format, round order
//   courses-config.js  course name, tee played, per-hole par
//   schedule-config.js location, notes, tee charts, PDFs, tee wording
//
// No Firestore here: everything is static trip information, so the
// page draws instantly (these are small local files).

import { ROUNDS } from "./rounds-config.js";
import { COURSES } from "./courses-config.js";
import { TRIP, NOTES, SCHEDULE_EXTRAS } from "./schedule-config.js";
import { CURRENT_YEAR } from "./match-ui.js";

// ------------------------------------------------------------------
// Small formatting helpers
// ------------------------------------------------------------------
const yards = (n) => n.toLocaleString("en-US");   // 6095 -> "6,095"
const rating = (n) => n.toFixed(1);                // 68 -> "68.0"
const coursePar = (course) => course.holes.reduce((sum, h) => sum + h.par, 0);

// The tee-chart row for the tee this round is played from (named in
// courses-config.js), or null if the chart doesn't list that tee.
function ourTeeRow(round) {
  const extras = SCHEDULE_EXTRAS[round.id] || {};
  const tee = COURSES[round.id].tee;
  return (extras.teeChart || []).find((row) => row.tee === tee) || null;
}

// ------------------------------------------------------------------
// Header
// ------------------------------------------------------------------
document.getElementById("sch-eyebrow").textContent = `${CURRENT_YEAR} · ${TRIP.place}`;
document.getElementById("sch-sub").textContent =
  `${ROUNDS.length} rounds at ${TRIP.courses}. Tap a round for its scorecard and live scores.`;

// ------------------------------------------------------------------
// Itinerary: one card per round, in schedule order.
// ------------------------------------------------------------------
function itineraryCardHtml(round, index) {
  const course = COURSES[round.id];
  const extras = SCHEDULE_EXTRAS[round.id] || {};
  const row = ourTeeRow(round);

  // When the tee needs explaining ("Player's choice"), the numbers
  // shown are for the config's tee, so say which, e.g. "(White)".
  // Skipped when the note already starts with that tee's name.
  const teeText = extras.teeNote || course.tee;
  const whichTee = extras.teeNote && !extras.teeNote.startsWith(course.tee) ? ` (${course.tee})` : "";
  const ratingSlope = row ? `${rating(row.rating)} / ${row.slope}${whichTee}` : "—";
  const length = row ? `${yards(row.yards)}${whichTee}` : "—";

  const pdfLink = extras.scorecardPdf
    ? `<a class="sch-btn sch-btn-secondary" href="${extras.scorecardPdf}" target="_blank" rel="noopener">Scorecard PDF ↗</a>`
    : "";

  // <dl> = "description list": a standard HTML way to mark up label /
  // value pairs (dt = the label, dd = the value).
  return `
    <article class="sb-card sch-card">
      <div class="sch-card-top">
        <div>
          <div class="sch-day">${round.day}</div>
          <h3 class="sch-round">Round ${index + 1}</h3>
        </div>
        <span class="sch-format">${round.format}</span>
      </div>
      <div class="sch-course">${course.name}</div>
      <dl class="sch-facts">
        <div><dt>Tee</dt><dd>${teeText}</dd></div>
        <div><dt>Rating / Slope</dt><dd>${ratingSlope}</dd></div>
        <div><dt>Yardage</dt><dd>${length}</dd></div>
      </dl>
      <div class="sch-links">
        <a class="sch-btn" href="${round.id}.html">Round page</a>
        ${pdfLink}
      </div>
    </article>
  `;
}

document.getElementById("sch-itinerary").innerHTML = ROUNDS.map(itineraryCardHtml).join("");

// ------------------------------------------------------------------
// Notes
// ------------------------------------------------------------------
document.getElementById("sch-notes").innerHTML = NOTES.map((note) => `<li>${note}</li>`).join("");

// ------------------------------------------------------------------
// Par line under the handicap formula: one sentence if every course
// has the same par, otherwise one value per course.
// ------------------------------------------------------------------
const pars = ROUNDS.map((round) => ({ name: COURSES[round.id].name, par: coursePar(COURSES[round.id]) }));
document.getElementById("sch-par").textContent = pars.every((p) => p.par === pars[0].par)
  ? `Par is ${pars[0].par} at every course this year.`
  : `Par by course: ${pars.map((p) => `${p.name} ${p.par}`).join(" · ")}.`;

// ------------------------------------------------------------------
// Tee charts: one collapsible section per course (closed by default),
// in round order. The tee this round is played from is highlighted.
// <details>/<summary> open and close on tap with no JavaScript.
// ------------------------------------------------------------------
function teeChartHtml(round, index) {
  const course = COURSES[round.id];
  const extras = SCHEDULE_EXTRAS[round.id] || {};
  if (!extras.teeChart) return "";
  const rows = extras.teeChart
    .map((row) => {
      const ours = row.tee === course.tee;
      const tag = ours ? ` <span class="sch-tag">${extras.teeTag || "Our tee"}</span>` : "";
      return `
        <tr${ours ? ' class="is-ours"' : ""}>
          <td class="sch-tee-name">${row.tee}${tag}</td>
          <td class="lb-num">${rating(row.rating)}</td>
          <td class="lb-num">${row.slope}</td>
          <td class="lb-num">${yards(row.yards)}</td>
        </tr>
      `;
    })
    .join("");
  const pdfLink = extras.scorecardPdf
    ? `<a class="sch-pdf-link" href="${extras.scorecardPdf}" target="_blank" rel="noopener">Full scorecard PDF ↗</a>`
    : "";
  return `
    <details class="scoring-details sch-tee-details">
      <summary>
        <span class="sch-summary">
          <span class="sch-summary-title">${course.name}</span>
          <span class="sch-summary-sub">Round ${index + 1} · ${round.day}</span>
        </span>
      </summary>
      <div class="lb-wrap">
        <table class="leaderboard sch-tee-table">
          <thead>
            <tr>
              <th scope="col">Tee</th>
              <th class="lb-num" scope="col">Rating</th>
              <th class="lb-num" scope="col">Slope</th>
              <th class="lb-num" scope="col">Yards</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      ${pdfLink}
    </details>
  `;
}

document.getElementById("sch-tees").innerHTML = ROUNDS.map(teeChartHtml).join("");
