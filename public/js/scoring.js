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
// effective score for that hole is whichever player did better.

// Reduces a hole's value for one side down to a single stroke count,
// whether it was recorded as one shared number (scramble/greensomes/
// singles) or as multiple players' individual scores (best ball).
function sideStrokes(value) {
  return Array.isArray(value) ? Math.min(...value) : value;
}

// Match-play "net" for a single hole, from Team A's perspective:
// +1 if A won the hole, -1 if B won it, 0 if halved.
function holeNet(hole) {
  const a = sideStrokes(hole.a);
  const b = sideStrokes(hole.b);
  if (a < b) return 1;
  if (b < a) return -1;
  return 0;
}

// Sums the match-play net across a range of holes (inclusive), only
// counting holes that have actually been entered for BOTH sides.
// Returns both the running margin and how many of the range's holes
// are in yet, so callers can tell "A is 2up" apart from "A is 2up, but
// only 3 holes have been played so this isn't final."
function marginForRange(holes, startHole, endHole) {
  let margin = 0;
  let holesEntered = 0;
  for (let h = startHole; h <= endHole; h++) {
    const hole = holes[String(h)];
    if (!hole || hole.a == null || hole.b == null) continue;
    margin += holeNet(hole);
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
  if (segment.margin > 0) return { a: 1, b: 0 };
  if (segment.margin < 0) return { a: 0, b: 1 };
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

  return {
    front,
    back,
    overall,
    points: {
      a: frontPts.a + backPts.a + overallPts.a,
      b: frontPts.b + backPts.b + overallPts.b,
    },
  };
}

// Convenience for anything that needs a round (or the whole trip's)
// point total: pass an array of match data objects (each just needs a
// `holes` field, e.g. straight off a Firestore snapshot) and get back
// the summed { a, b } points. Used by both the standings page (across
// all of a round's matches) and each round page (same thing, scoped to
// just that round).
export function sumMatchPoints(matches) {
  let a = 0;
  let b = 0;
  for (const match of matches) {
    const points = scoreMatch(match.holes || {}).points;
    a += points.a;
    b += points.b;
  }
  return { a, b };
}
