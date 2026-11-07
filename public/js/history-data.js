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
// `playerId` links a name to that person's current player.html card
// when they're still on this year's roster -- null means either they
// aren't on the current roster, or (Keanan) there wasn't a confident
// match to make.
//
// PAST_TRIPS is a list so future years just add another entry: once
// the 2027 trip wraps, freeze its numbers the same way into a
// HISTORY_2027.js file and push it on here. stats.js always treats
// the LAST entry as "last year alone" and sums ALL entries (plus the
// live current year) into the career table.
export const HISTORY_2026 = {
  label: "2026 — Arizona (Grayhawk & WeKoPa)",
  players: [
    { name: "Doug", team: "europe", totalStrokes: 331, roundsPlayed: 4, points: 9.0, birdies: 4, bestRound: 2, playerId: "0YuSXaeGccvkYNvgrPOl" },
    { name: "Will", team: "europe", totalStrokes: 336, roundsPlayed: 4, points: 8.5, birdies: 5, bestRound: 6, playerId: "FekEeWoWl9oQeOrKxrIh" },
    { name: "Keanan", team: "europe", totalStrokes: 354, roundsPlayed: 4, points: 7.5, birdies: 2, bestRound: 7, playerId: null },
    { name: "Chris", team: "usa", totalStrokes: 345, roundsPlayed: 4, points: 7.0, birdies: 4, bestRound: 10, playerId: "IdcW38IokTn8O0hbECip" },
    { name: "Bennett", team: "usa", totalStrokes: 362, roundsPlayed: 4, points: 6.5, birdies: 2, bestRound: 10, playerId: "LrGzM4VMCECwlW1hyey1" },
    { name: "Stephen", team: "usa", totalStrokes: 334, roundsPlayed: 4, points: 6.0, birdies: 4, bestRound: 10, playerId: "FytfkAhCwnLsFdi2bFQi" },
    { name: "Ralph", team: "usa", totalStrokes: 338, roundsPlayed: 4, points: 6.0, birdies: 4, bestRound: 7, playerId: "HkE4p6uoliNuEKbqB79d" },
    { name: "Adam", team: "europe", totalStrokes: 380, roundsPlayed: 4, points: 5.5, birdies: 3, bestRound: 2, playerId: "pydBzYoUJtAGPY8sUBcy" },
    { name: "Sean", team: "usa", totalStrokes: 382, roundsPlayed: 4, points: 5.5, birdies: 2, bestRound: 10, playerId: "nDKjTHGs7BRrCLjBqZJV" },
    { name: "Jack", team: "europe", totalStrokes: 396, roundsPlayed: 4, points: 5.0, birdies: 3, bestRound: 6, playerId: "AXVlDNeL0LDFYMamITLQ" },
    { name: "Billy", team: "usa", totalStrokes: 356, roundsPlayed: 4, points: 3.0, birdies: 2, bestRound: 7, playerId: "NiEVbYANNFSSuuRe901C" },
    { name: "Tej", team: "europe", totalStrokes: 388, roundsPlayed: 4, points: 2.5, birdies: 1, bestRound: 11, playerId: "oVccsKGWXyNcgvTKYDRH" },
  ],
};

export const PAST_TRIPS = [HISTORY_2026];
