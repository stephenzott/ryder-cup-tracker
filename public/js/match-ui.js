// Shared building blocks for drawing a match, used by both the
// scoreboard (scoreboard.js) and the round pages (round.js), so a
// label, color rule or layout change happens in ONE place.
//
// Everything here returns HTML strings (or small text helpers); nothing
// reads or writes Firestore. Scoring itself comes from scoring.js.
//
// Sides are 'a' = USA and 'b' = EU, matching the Firestore data. CSS
// classes keep the "sb-" prefix they got on the scoreboard; they're
// the shared match look now (styles in style.css section 6).

import { holeWinner, strokeSidesForHole } from "./scoring.js";
import { playerLink } from "./player-stats.js";

// Points come in halves: 12.5 is shown as "12½", 0.5 as "½".
export function formatPoints(n) {
  const whole = Math.floor(n);
  const fraction = n - whole;
  if (fraction === 0) return String(whole);
  if (fraction === 0.5) return whole === 0 ? "½" : `${whole}½`;
  return String(n);
}

// "Sean Kohn" -> "SK"; a single name -> its first letter; unknown -> "?".
export function initials(name) {
  if (name === "(unknown)") return "?";
  const parts = name.trim().split(/\s+/);
  const first = parts[0]?.[0] || "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase() || "?";
}

// Text for a front 9 / back 9 / overall segment, e.g. "USA 2 UP",
// "All square", "Halved", or "—" before any hole is in.
export function statusLabel(segment) {
  if (segment.holesEntered === 0) return "—";
  if (segment.margin === 0) return segment.complete ? "Halved" : "All square";
  const leader = segment.margin > 0 ? "USA" : "EU";
  return `${leader} ${Math.abs(segment.margin)} UP`;
}

// Who's ahead in a segment, as a CSS suffix: "usa", "eu" or "level".
// A positive margin means side a (USA) is ahead.
export function leaderOf(segment) {
  if (segment.holesEntered === 0 || segment.margin === 0) return "level";
  return segment.margin > 0 ? "usa" : "eu";
}

// Short text for the overall segment: "USA 2 UP · thru 11",
// "ALL SQUARE · thru 9", "FINAL · EU 1 UP", or "NOT STARTED".
export function overallStatusText(overall) {
  if (overall.holesEntered === 0) return "NOT STARTED";
  const standing =
    overall.margin === 0
      ? overall.complete ? "HALVED" : "ALL SQUARE"
      : `${overall.margin > 0 ? "USA" : "EU"} ${Math.abs(overall.margin)} UP`;
  return overall.complete ? `FINAL · ${standing}` : `${standing} · thru ${overall.holesEntered}`;
}

// The colored status pill: red when USA leads, blue when EU leads,
// grey when level or not started. Always text, never color alone.
export function statusPill(overall) {
  return `<span class="sb-pill sb-pill-${leaderOf(overall)}">${overallStatusText(overall)}</span>`;
}

// One side of a match: players (initials circle + linked name, one per
// line) and that side's points-so-far numeral.
//   side      "usa" or "eu"
//   people    [{ id, name }] in player order (empty = not assigned)
//   trailing  true if this side has fewer points (numeral shown grey)
export function sideHtml(side, people, points, trailing) {
  const playersHtml = people.length
    ? people
        .map(
          ({ id, name }) => `
            <li class="sb-player">
              <span class="sb-initials" aria-hidden="true">${initials(name)}</span>
              <span class="sb-player-name">${playerLink(id, name)}</span>
            </li>
          `
        )
        .join("")
    : `<li class="sb-player sb-player-tbd">TBD</li>`;

  return `
    <div class="sb-side sb-side-${side}">
      <ul class="sb-players">${playersHtml}</ul>
      <div class="sb-points${trailing ? " is-trailing" : ""}"><span class="visually-hidden">${side === "usa" ? "USA" : "EU"} points: </span>${formatPoints(points)}</div>
    </div>
  `;
}

// Both sides with the "vs" divider between them.
export function sidesHtml(peopleA, peopleB, points) {
  const { a, b } = points;
  return `
    <div class="sb-sides">
      ${sideHtml("usa", peopleA, a, a < b)}
      <div class="sb-vs" aria-hidden="true"><span>vs</span></div>
      ${sideHtml("eu", peopleB, b, b < a)}
    </div>
  `;
}

// The Front 9 / Back 9 / Overall chips, tinted by who leads.
export function segmentChipsHtml(scored) {
  const chip = (label, segment) => `
    <div class="sb-chip sb-chip-${leaderOf(segment)}">
      <span class="sb-chip-label">${label}</span>
      <span class="sb-chip-value">${statusLabel(segment)}</span>
    </div>
  `;
  return `
    <div class="sb-segments">
      ${chip("Front 9", scored.front)}
      ${chip("Back 9", scored.back)}
      ${chip("Overall", scored.overall)}
    </div>
  `;
}

// The 2x9 hole grid. Played holes show only color (USA red, EU blue,
// halved grey with a dash); unplayed holes show their number. A corner
// dot marks a handicap stroke. Every box has a spoken label.
//
// options.interactive  true on the round pages: each box is a <button>
//                      that jumps to that hole (class "rd-hole-btn").
// options.currentHole  the hole being entered; outlined, and its number
//                      is shown even if it's been played.
export function holeGridHtml(data, { interactive = false, currentHole = null } = {}) {
  const holes = data.holes || {};
  let boxes = "";
  for (let h = 1; h <= 18; h++) {
    const winner = holeWinner(holes[String(h)], h, data);
    let fill = "empty";
    let words = "not played";
    if (winner === "a") { fill = "usa"; words = "USA won"; }
    else if (winner === "b") { fill = "eu"; words = "EU won"; }
    else if (winner === "halved") { fill = "halved"; words = "halved"; }

    const strokes = strokeSidesForHole(data, h);
    let dot = "";
    if (strokes.a && strokes.b) { dot = " sb-dot-both"; words += ", strokes for both sides"; }
    else if (strokes.a) { dot = " sb-dot-usa"; words += ", stroke for USA"; }
    else if (strokes.b) { dot = " sb-dot-eu"; words += ", stroke for EU"; }

    const isCurrent = h === currentHole;
    // What's printed inside: the number on unplayed holes (and on the
    // current hole), a dash on halved holes, nothing on won holes.
    const mark = fill === "empty" || isCurrent ? h : fill === "halved" ? "–" : "";
    const classes = `sb-hole sb-hole-${fill}${dot}${isCurrent ? " is-current" : ""}`;

    if (interactive) {
      // aria-current marks the hole being entered for screen readers.
      boxes += `<button type="button" class="${classes} rd-hole-btn" data-hole="${h}"
                  aria-label="Go to hole ${h}, ${words}"${isCurrent ? ' aria-current="step"' : ""}>${mark}</button>`;
    } else {
      boxes += `<div class="${classes}" role="img" aria-label="Hole ${h}, ${words}">${mark}</div>`;
    }
  }
  const label = interactive ? "Holes: tap one to enter its score" : "Hole by hole, front nine then back nine";
  return `<div class="sb-holes${interactive ? " rd-holes" : ""}" role="group" aria-label="${label}">${boxes}</div>`;
}

// The color legend (swatches reuse the hole-box classes so they always
// match the grid).
export const LEGEND_HTML = `
  <section class="sb-legend" aria-label="Legend">
    <div class="sb-legend-item"><span class="sb-hole sb-hole-usa sb-swatch"></span>USA won hole</div>
    <div class="sb-legend-item"><span class="sb-hole sb-hole-eu sb-swatch"></span>EU won hole</div>
    <div class="sb-legend-item"><span class="sb-hole sb-hole-halved sb-swatch">–</span>Halved</div>
    <div class="sb-legend-item"><span class="sb-hole sb-hole-empty sb-swatch">7</span>Not played (hole number)</div>
    <div class="sb-legend-item"><span class="sb-hole sb-hole-empty sb-dot-usa sb-swatch"></span>Handicap stroke (dot color = team)</div>
  </section>
`;

// Placeholder card shown before data arrives.
export const SKELETON_CARD = `
  <div class="skeleton-card sb-skeleton" aria-hidden="true">
    <div class="skeleton skeleton-line skeleton-title"></div>
    <div class="skeleton skeleton-block"></div>
    <div class="skeleton skeleton-grid"></div>
  </div>
`;
