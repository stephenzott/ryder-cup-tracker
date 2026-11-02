// Real per-hole course data, transcribed from the printed scorecards
// (scorecard-the-*.pdf in the project root) for the White tees, which
// is what the group is playing per schedule.html. Round 1 (River) is
// listed as "White or Green, TBD" there -- if that gets finalized to
// Green, update this file's round1 entry to match.
//
// `par` and `strokeIndex` don't vary by tee (they're properties of the
// hole itself), only `yards` does. strokeIndex is the hole's difficulty
// rank (1 = hardest, 18 = easiest) -- it's what you'd use to decide
// which holes a player gets a handicap stroke on, if/when strokes-given
// scoring gets built.
//
// Each courses holes array is index 0 = hole 1 ... index 17 = hole 18.
export const COURSES = {
  round1: {
    name: "Blackwolf Run — River",
    tee: "White",
    holes: [
      { hole: 1, par: 5, strokeIndex: 5, yards: 501 },
      { hole: 2, par: 4, strokeIndex: 13, yards: 345 },
      { hole: 3, par: 4, strokeIndex: 1, yards: 389 },
      { hole: 4, par: 3, strokeIndex: 15, yards: 146 },
      { hole: 5, par: 4, strokeIndex: 3, yards: 376 },
      { hole: 6, par: 4, strokeIndex: 17, yards: 308 },
      { hole: 7, par: 4, strokeIndex: 7, yards: 352 },
      { hole: 8, par: 5, strokeIndex: 9, yards: 470 },
      { hole: 9, par: 4, strokeIndex: 11, yards: 302 },
      { hole: 10, par: 3, strokeIndex: 14, yards: 175 },
      { hole: 11, par: 5, strokeIndex: 6, yards: 522 },
      { hole: 12, par: 4, strokeIndex: 2, yards: 372 },
      { hole: 13, par: 3, strokeIndex: 10, yards: 135 },
      { hole: 14, par: 4, strokeIndex: 16, yards: 294 },
      { hole: 15, par: 4, strokeIndex: 18, yards: 329 },
      { hole: 16, par: 5, strokeIndex: 8, yards: 511 },
      { hole: 17, par: 3, strokeIndex: 12, yards: 153 },
      { hole: 18, par: 4, strokeIndex: 4, yards: 415 },
    ],
  },

  round2: {
    name: "Blackwolf Run — Meadow Valleys",
    tee: "White",
    holes: [
      { hole: 1, par: 4, strokeIndex: 7, yards: 335 },
      { hole: 2, par: 4, strokeIndex: 5, yards: 375 },
      { hole: 3, par: 3, strokeIndex: 15, yards: 142 },
      { hole: 4, par: 5, strokeIndex: 9, yards: 473 },
      { hole: 5, par: 4, strokeIndex: 11, yards: 340 },
      { hole: 6, par: 4, strokeIndex: 1, yards: 406 },
      { hole: 7, par: 5, strokeIndex: 17, yards: 475 },
      { hole: 8, par: 3, strokeIndex: 13, yards: 160 },
      { hole: 9, par: 4, strokeIndex: 3, yards: 413 },
      { hole: 10, par: 4, strokeIndex: 10, yards: 320 },
      { hole: 11, par: 5, strokeIndex: 14, yards: 487 },
      { hole: 12, par: 4, strokeIndex: 2, yards: 395 },
      { hole: 13, par: 4, strokeIndex: 8, yards: 304 },
      { hole: 14, par: 4, strokeIndex: 6, yards: 376 },
      { hole: 15, par: 3, strokeIndex: 16, yards: 150 },
      { hole: 16, par: 5, strokeIndex: 12, yards: 478 },
      { hole: 17, par: 3, strokeIndex: 18, yards: 138 },
      { hole: 18, par: 4, strokeIndex: 4, yards: 373 },
    ],
  },

  round3: {
    name: "Whistling Straits — Straits",
    tee: "White",
    holes: [
      { hole: 1, par: 4, strokeIndex: 15, yards: 361 },
      { hole: 2, par: 5, strokeIndex: 7, yards: 508 },
      { hole: 3, par: 3, strokeIndex: 17, yards: 154 },
      { hole: 4, par: 4, strokeIndex: 1, yards: 404 },
      { hole: 5, par: 5, strokeIndex: 5, yards: 527 },
      { hole: 6, par: 4, strokeIndex: 13, yards: 352 },
      { hole: 7, par: 3, strokeIndex: 9, yards: 172 },
      { hole: 8, par: 4, strokeIndex: 3, yards: 405 },
      { hole: 9, par: 4, strokeIndex: 11, yards: 371 },
      { hole: 10, par: 4, strokeIndex: 12, yards: 320 },
      { hole: 11, par: 5, strokeIndex: 6, yards: 519 },
      { hole: 12, par: 3, strokeIndex: 18, yards: 99 },
      { hole: 13, par: 4, strokeIndex: 14, yards: 336 },
      { hole: 14, par: 4, strokeIndex: 16, yards: 332 },
      { hole: 15, par: 4, strokeIndex: 4, yards: 402 },
      { hole: 16, par: 5, strokeIndex: 10, yards: 513 },
      { hole: 17, par: 3, strokeIndex: 8, yards: 165 },
      { hole: 18, par: 4, strokeIndex: 2, yards: 420 },
    ],
  },

  round4: {
    name: "Whistling Straits — Irish",
    tee: "White",
    holes: [
      { hole: 1, par: 4, strokeIndex: 4, yards: 359 },
      { hole: 2, par: 4, strokeIndex: 6, yards: 340 },
      { hole: 3, par: 3, strokeIndex: 18, yards: 118 },
      { hole: 4, par: 4, strokeIndex: 2, yards: 405 },
      { hole: 5, par: 5, strokeIndex: 14, yards: 477 },
      { hole: 6, par: 3, strokeIndex: 16, yards: 123 },
      { hole: 7, par: 4, strokeIndex: 12, yards: 339 },
      { hole: 8, par: 5, strokeIndex: 10, yards: 459 },
      { hole: 9, par: 4, strokeIndex: 8, yards: 308 },
      { hole: 10, par: 4, strokeIndex: 5, yards: 361 },
      { hole: 11, par: 3, strokeIndex: 15, yards: 169 },
      { hole: 12, par: 4, strokeIndex: 13, yards: 349 },
      { hole: 13, par: 3, strokeIndex: 17, yards: 145 },
      { hole: 14, par: 5, strokeIndex: 11, yards: 469 },
      { hole: 15, par: 4, strokeIndex: 1, yards: 370 },
      { hole: 16, par: 4, strokeIndex: 3, yards: 383 },
      { hole: 17, par: 4, strokeIndex: 7, yards: 325 },
      { hole: 18, par: 5, strokeIndex: 9, yards: 493 },
    ],
  },
};
