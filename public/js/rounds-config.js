// Static trip structure — which 4 rounds exist, what course/format each
// is, and how many points each is worth. This never changes mid-trip,
// so rather than make you seed it into Firestore by hand, it just lives
// here as a plain JS file that index.html and each roundN.html import.
//
// `id` is also the Firestore subcollection path: matches for round 1
// live at rounds/round1/matches/{matchId}.
// playersPerSide: how many players make up one side of a match (2 for
// the team formats, 1 for singles).
//
// holeShape: how a side's score for one hole is recorded --
//   "single"    one shared number (scramble/greensomes: the team plays
//               one ball; singles: there's only one player anyway)
//   "perPlayer" an array of each player's own strokes (best ball: each
//               player plays their own ball, side score = the better one)
//
// strokesGivenEligible: whether admin can set per-player handicap
// strokes for this round (best ball and singles -- gross-only for
// scramble/greensomes per the trip's rules).
export const ROUNDS = [
  {
    id: "round1",
    label: "Round 1: River",
    day: "Thursday",
    course: "Blackwolf Run — River",
    format: "Scramble",
    matchCount: 4,
    playersPerSide: 2,
    holeShape: "single",
    strokesGivenEligible: false,
  },
  {
    id: "round2",
    label: "Round 2: Meadow Valleys",
    day: "Friday AM",
    course: "Blackwolf Run — Meadow Valleys",
    format: "Greensomes",
    matchCount: 4,
    playersPerSide: 2,
    holeShape: "single",
    strokesGivenEligible: false,
  },
  {
    id: "round3",
    label: "Round 3: Straits",
    day: "Friday PM",
    course: "Whistling Straits — Straits",
    format: "Best Ball",
    matchCount: 4,
    playersPerSide: 2,
    holeShape: "perPlayer",
    strokesGivenEligible: true,
  },
  {
    id: "round4",
    label: "Round 4: Irish",
    day: "Saturday",
    course: "Whistling Straits — Irish",
    format: "Singles",
    matchCount: 8,
    playersPerSide: 1,
    holeShape: "single",
    strokesGivenEligible: true,
  },
];

// Every match is worth up to 3 Nassau points (front 9 + back 9 +
// overall 18, 1 point each, split 0.5/0.5 on a halve).
const POINTS_PER_MATCH = 3;

export function pointsAvailable(round) {
  return round.matchCount * POINTS_PER_MATCH;
}

export const TOTAL_POINTS_AVAILABLE = ROUNDS.reduce(
  (sum, r) => sum + pointsAvailable(r),
  0
);
