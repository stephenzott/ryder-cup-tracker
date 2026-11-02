// Turns raw hole-by-hole strokes into Nassau match-play points. This is
// the ONE place that logic lives — round-entry pages and the standings
// page both call into here, so there's never a separately-stored
// "winner" field that could disagree with the actual strokes entered.
//
// A match document's `holes` field looks like:
//   { "1": { a: 4, b: 5 }, "2": { a: 4, b: 4 }, ... }
// — one entry per hole that's been played so far (missing holes just
// aren't in the object yet), keyed by hole number as a string because
// that's how Firestore stores map keys.
//
// For best ball (round 3), a side's value is an ARRAY of each player's
// strokes instead of a single number — e.g. a: [4, 5] — and the side's
// effective score for that hole is whichever player did better. The
// hole only counts as decided once every player in the array has a
// score in; a: [4, null] reads as "not entered yet," same as a: null.

// Reduces a hole's value for one side down to a single stroke count,
// whether it was recorded as one shared number (scramble/greensomes/
// singles) or as multiple players' individual scores (best ball).
// For best ball, the side doesn't have a score for the hole at all
// until EVERY player on it has entered one -- a half-filled pair
// (e.g. [4, null]) isn't "4," it's "not yet," so this returns null
// rather than letting null coerce to 0 in a Math.min.
function sideStrokes(value) {
  if (Array.isArray(value)) {
    if (value.length === 0 || value.some((v) => v == null)) return null;
    return Math.min(...value);
  }
  return value;
}

// Who won a single hole: 'a', 'b', 'halved', or null if it hasn't
// been entered for both sides yet. Exported because the scoreboard
// page wants this directly (to color a box per hole) without caring
// about margins or points at all.
export function holeWinner(hole) {
  if (!hole) return null;
  const a = sideStrokes(hole.a);
  const b = sideStrokes(hole.b);
  if (a == null || b == null) return null;
  if (a < b) return "a";
  if (b < a) return "b";
  return "halved";
}

// Sums the match-play net across a range of holes (inclusive), only
// counting holes that have actually been decided for BOTH sides (via
// holeWinner, so a half-entered best-ball pair correctly doesn't count
// yet). Returns both the running margin and how many of the range's
// holes are in, so callers can tell "A is 2up" apart from "A is 2up,
// but only 3 holes have been played so this isn't final."
function marginForRange(holes, startHole, endHole) {
  let margin = 0;
  let holesEntered = 0;
  for (let h = startHole; h <= endHole; h++) {
    const winner = holeWinner(holes[String(h)]);
    if (winner == null) continue;
    if (winner === "a") margin += 1;
    else if (winner === "b") margin -= 1;
    holesEntered++;
  }
  const holesTotal = endHole - startHole + 1;
  return { margin, holesEntered, holesTotal, complete: holesEntered === holesTotal };
}

// A segment (front 9 / back 9 / overall) only pays out Nassau points
// once every hole in it has been entered — otherwise a margin of 0
// just means "not enough holes played yet," not "halved."
function pointsForSegment(segment) {
  if (!segment.complete) return { a: 0, b: 0 };
  return marginToPoints(segment.margin);
}

// "If the current margin held" version -- same scoring, but doesn't
// wait for the segment to be complete. Used for a projected/"what if
// it ended right now" display alongside the real, only-counts-when-
// finished points. Whoever's currently ahead gets the full point here
// even mid-segment; it's a what-if, not a partial award.
//
// A segment with ZERO holes entered isn't "currently tied" -- it just
// hasn't started, so it shouldn't contribute anything (not even a
// phantom 0.5/0.5 halve) to the projection yet.
function projectedPointsForSegment(segment) {
  if (segment.holesEntered === 0) return { a: 0, b: 0 };
  return marginToPoints(segment.margin);
}

function marginToPoints(margin) {
  if (margin > 0) return { a: 1, b: 0 };
  if (margin < 0) return { a: 0, b: 1 };
  return { a: 0.5, b: 0.5 };
}

// The main export. Given a match's `holes` map, returns the front 9,
// back 9, and overall margins/status, plus the Nassau points each side
// has actually earned so far (0 for any segment still in progress).
export function scoreMatch(holes) {
  const front = marginForRange(holes, 1, 9);
  const back = marginForRange(holes, 10, 18);
  // "Overall" (the 18-hole bet) is just the two 9-hole margins
  // combined — matches how Nassau is actually settled, not a separate
  // stroke comparison.
  const overall = {
    margin: front.margin + back.margin,
    holesEntered: front.holesEntered + back.holesEntered,
    holesTotal: 18,
    complete: front.complete && back.complete,
  };

  const frontPts = pointsForSegment(front);
  const backPts = pointsForSegment(back);
  const overallPts = pointsForSegment(overall);

  const frontProj = projectedPointsForSegment(front);
  const backProj = projectedPointsForSegment(back);
  const overallProj = projectedPointsForSegment(overall);

  return {
    front,
    back,
    overall,
    // Real points: only ever nonzero once a segment is actually done.
    points: {
      a: frontPts.a + backPts.a + overallPts.a,
      b: frontPts.b + backPts.b + overallPts.b,
    },
    // Projected points: "if the current margin on every segment held
    // as-is." Equals `points` once everything's complete. A segment
    // that hasn't started yet contributes nothing (not a phantom
    // halve) -- so e.g. 2up on the front with the back untouched
    // projects as a clean 2-0 (1 for front, 1 for overall), not 2.5-0.5.
    projected: {
      a: frontProj.a + backProj.a + overallProj.a,
      b: frontProj.b + backProj.b + overallProj.b,
    },
  };
}

// Convenience for anything that needs a round (or the whole trip's)
// point total: pass an array of match data objects (each just needs a
// `holes` field, e.g. straight off a Firestore snapshot) and get back
// the summed real AND projected points. Used by both the standings
// page (across all of a round's matches) and each round page (same
// thing, scoped to just that round).
export function sumMatchPoints(matches) {
  const totals = { a: 0, b: 0, projectedA: 0, projectedB: 0 };
  for (const match of matches) {
    const scored = scoreMatch(match.holes || {});
    totals.a += scored.points.a;
    totals.b += scored.points.b;
    totals.projectedA += scored.projected.a;
    totals.projectedB += scored.projected.b;
  }
  return totals;
}
