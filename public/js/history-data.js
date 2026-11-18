// Frozen stats from past trips -- unlike the live 2027 stats
// everywhere else in this app, these numbers do NOT recompute: those
// trips are over, so there's nothing left to change. Each trip's
// numbers were calculated once (same avg-score / points / birdies /
// best-round definitions used in player-stats.js) from that trip's
// real scorecards, then hardcoded here.
//
// `totalStrokes` + `roundsPlayed` (rather than a pre-divided average)
// are what's stored, so stats.js can correctly WEIGHT a player's
// average when merging multiple trips together for the career table
// -- e.g. 4 rounds at one average and 4 at another isn't the same as
// just averaging the two averages.
//
// `fullName` is how a person is identified across years. It must be
// spelled exactly as on the roster (Admin page), because a past entry is
// matched to a roster player by comparing the two names' "slugs" (see
// personSlug in player-stats.js: "Sean O'Neal" -> "sean-oneal"). Firestore
// IDs aren't used here on purpose: someone who skips a year is removed
// from the roster and comes back with a NEW Firestore ID, but their name
// stays the same, so their history still lines up.
//
// `record` = { wins, losses, halves } for that trip, counting the front
// nine, back nine and overall as three separate results per round (the
// same rule player-stats.js uses for the live year). null means "not
// entered yet"; the all-time Record tile then shows "—" for that person.
//
// `year` is the trip's year as a number, used for "Played: 2026" on a
// player card.
//
// PAST_TRIPS is a list so future years just add another entry: once
// the 2027 trip wraps, freeze its numbers the same way into a
// HISTORY_2027.js file and push it on here. stats.js always treats
// the LAST entry as "last year alone" and sums ALL entries (plus the
// live current year) into the career table.
export const HISTORY_2026 = {
  year: 2026,
  label: "2026 — Arizona (Grayhawk & WeKoPa)",
  players: [
    { fullName: "Doug Friedman", team: "europe", totalStrokes: 331, roundsPlayed: 4, points: 9.0, birdies: 4, bestRound: 2, record: null },
    { fullName: "Will Sahakian", team: "europe", totalStrokes: 336, roundsPlayed: 4, points: 8.5, birdies: 5, bestRound: 6, record: null },
    { fullName: "Keanan Smith", team: "europe", totalStrokes: 354, roundsPlayed: 4, points: 7.5, birdies: 2, bestRound: 7, record: null },
    { fullName: "Chris Watson", team: "usa", totalStrokes: 345, roundsPlayed: 4, points: 7.0, birdies: 4, bestRound: 10, record: null },
    { fullName: "Bennett Heussler", team: "usa", totalStrokes: 362, roundsPlayed: 4, points: 6.5, birdies: 2, bestRound: 10, record: null },
    { fullName: "Stephen Zott", team: "usa", totalStrokes: 334, roundsPlayed: 4, points: 6.0, birdies: 4, bestRound: 10, record: null },
    { fullName: "Ralph Hage", team: "usa", totalStrokes: 338, roundsPlayed: 4, points: 6.0, birdies: 4, bestRound: 7, record: null },
    { fullName: "Adam Zajac", team: "europe", totalStrokes: 380, roundsPlayed: 4, points: 5.5, birdies: 3, bestRound: 2, record: null },
    { fullName: "Sean Kohn", team: "usa", totalStrokes: 382, roundsPlayed: 4, points: 5.5, birdies: 2, bestRound: 10, record: null },
    { fullName: "Jack Heidenreich", team: "europe", totalStrokes: 396, roundsPlayed: 4, points: 5.0, birdies: 3, bestRound: 6, record: null },
    { fullName: "Billy Summa", team: "usa", totalStrokes: 356, roundsPlayed: 4, points: 3.0, birdies: 2, bestRound: 7, record: null },
    { fullName: "Tej Patel", team: "europe", totalStrokes: 388, roundsPlayed: 4, points: 2.5, birdies: 1, bestRound: 11, record: null },
  ],
};

export const PAST_TRIPS = [HISTORY_2026];
