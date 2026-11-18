// Trip details for the Schedule page (and the Home header) that aren't
// already in rounds-config.js or courses-config.js. Together, those
// three files are everything that changes from year to year:
//
//   rounds-config.js   which rounds, day, format, match count
//   courses-config.js  each round's course name, tee played, and the
//                      per-hole par / stroke index / yardage
//   schedule-config.js (this file) trip location, "good to know"
//                      notes, each course's full tee chart, scorecard
//                      PDF, and any special wording about the tee
//
// schedule.html has NO year-specific text in it; js/schedule.js builds
// the page from these files. To set up a new year, update all three
// (and drop the new scorecard PDFs into public/scorecards/).
//
// Rating / slope / yardage on the itinerary are looked up from the tee
// chart below, using the tee named in courses-config.js. Change the
// tee there (e.g. Round 1 moves to Green) and the itinerary, the
// "Our tee" highlight and the scoring all follow.

// Shown in the Home header and the Schedule header.
export const TRIP = {
  courses: "Whistling Straits & Blackwolf Run",
  place: "Sheboygan, WI",
};

// "Good to know" bullets on the Schedule page.
export const NOTES = [
  "The Straits course at Whistling Straits is walking-only with a caddie — Friday is a long double round.",
  "Not playing the ~7,200-yard back tees anywhere; targeting roughly 6,000–6,400 depending on course.",
  "Scramble (Thursday) may move up to the Green tees for extra length — not finalized.",
  "Best ball and singles: players can generally choose their own tee within reason.",
  "Singles goes last by design.",
];

// Per round (keyed by round id, same as COURSES):
//   teeChart      every tee: { tee, rating, slope, yards }
//   scorecardPdf  path to the full scorecard, relative to the site root
//   teeNote       optional: how to describe the tee on the itinerary,
//                 when it's more than just the tee name
//   teeTag        optional: label on the highlighted row in the tee
//                 chart (defaults to "Our tee")
export const SCHEDULE_EXTRAS = {
  round1: {
    scorecardPdf: "scorecards/scorecard-the-river.pdf",
    teeNote: "White (or Green, TBD)",
    teeTag: "Our tee (Green TBD)",
    teeChart: [
      { tee: "Black", rating: 76.2, slope: 151, yards: 7404 },
      { tee: "Blue", rating: 73.7, slope: 144, yards: 6865 },
      { tee: "Green", rating: 72.1, slope: 139, yards: 6465 },
      { tee: "White", rating: 70.3, slope: 132, yards: 6095 },
      { tee: "White/Red", rating: 68.0, slope: 127, yards: 5602 },
      { tee: "Red", rating: 65.7, slope: 123, yards: 5120 },
    ],
  },
  round2: {
    scorecardPdf: "scorecards/scorecard-the-meadow-valleys.pdf",
    teeChart: [
      { tee: "Black", rating: 75.3, slope: 145, yards: 7314 },
      { tee: "Blue", rating: 75.3, slope: 139, yards: 6884 },
      { tee: "Green", rating: 71.5, slope: 136, yards: 6450 },
      { tee: "White", rating: 70.3, slope: 132, yards: 6140 },
      { tee: "White/Red", rating: 67.8, slope: 128, yards: 5702 },
      { tee: "Red", rating: 65.2, slope: 123, yards: 5065 },
    ],
  },
  round3: {
    scorecardPdf: "scorecards/scorecard-the-straits.pdf",
    teeChart: [
      { tee: "Black", rating: 77.2, slope: 152, yards: 7790 },
      { tee: "Blue", rating: 74.2, slope: 145, yards: 7142 },
      { tee: "Green", rating: 71.9, slope: 141, yards: 6663 },
      { tee: "White", rating: 70.4, slope: 137, yards: 6360 },
      { tee: "White/Red", rating: 68.6, slope: 134, yards: 5922 },
      { tee: "Red", rating: 66.4, slope: 129, yards: 5564 },
    ],
  },
  round4: {
    scorecardPdf: "scorecards/scorecard-the-irish.pdf",
    teeNote: "Player's choice",
    teeTag: "Suggested",
    teeChart: [
      { tee: "Black", rating: 75.6, slope: 146, yards: 7201 },
      { tee: "Blue", rating: 73.5, slope: 141, yards: 6750 },
      { tee: "Green", rating: 72.0, slope: 137, yards: 6366 },
      { tee: "White", rating: 70.3, slope: 133, yards: 5992 },
      { tee: "White/Red", rating: 67.9, slope: 127, yards: 5613 },
      { tee: "Red", rating: 65.6, slope: 122, yards: 5109 },
    ],
  },
};
