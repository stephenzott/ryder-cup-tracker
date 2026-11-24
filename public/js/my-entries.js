// "What did THIS phone enter?" memory for the round pages (offline
// project, stage 1). Used only by round.js.
//
// WHY THIS EXISTS. Firestore can tell us "this match has changes saved
// on the phone that the server hasn't confirmed yet"
// (metadata.hasPendingWrites), but only for the match as a whole: all 18
// holes live in one match document, so it can't say WHICH holes are
// waiting. So each time this phone saves a hole, we write down what it
// saved. That lets the round page:
//   1. list exactly which holes are still waiting to send;
//   2. flip them to "Sent" once the server confirms the match;
//   3. warn if the server later shows a DIFFERENT number for a hole this
//      phone entered (another phone overwrote it, or the save was
//      refused or lost), so a score is never silently replaced.
//
// It's kept in localStorage (a small key/value store each browser keeps
// per website, which survives the app being closed), so it outlives a
// reload just like Firestore's own queue of unsent writes does. Nothing
// here is ever sent anywhere; it's purely this phone's own notes.
//
// Every function re-reads localStorage instead of keeping a copy in
// memory, so two open tabs of the site can't overwrite each other's notes
// with a stale copy.
//
// The keys include the trip year (CURRENT_YEAR, from match-ui.js), so
// next year's trip starts with a clean slate.

import { CURRENT_YEAR } from "./match-ui.js";

const ENTRIES_KEY = `rydercup_my_entries_${CURRENT_YEAR}`;
const WARNINGS_KEY = `rydercup_sync_warnings_${CURRENT_YEAR}`;

// One note per hole this phone saved, keyed "round1/match3/7":
//   { a, b, status: "pending" | "sent", at: <ms> }
// where a/b are exactly what was saved (a number or null, or for best
// ball an array of numbers/nulls, one per player).
//
// One warning per hole that needs the player's attention, same key:
//   { type: "changed" | "refused", roundId, matchId, hole,
//     entered: { a, b }, now: { a, b } (changed only), reason (refused only) }

function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key)) || {};
  } catch {
    return {};   // storage unavailable or unreadable: behave as if empty
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable (some private modes): the page still works,
       it just can't show per-hole badges or warnings */
  }
}

export function noteKey(roundId, matchId, hole) {
  return `${roundId}/${matchId}/${hole}`;
}

// Called the moment Save is tapped.
export function recordEntry(roundId, matchId, hole, a, b) {
  const entries = load(ENTRIES_KEY);
  entries[noteKey(roundId, matchId, hole)] = { a, b, status: "pending", at: Date.now() };
  store(ENTRIES_KEY, entries);
  // A fresh save of this hole supersedes any old warning about it.
  const warnings = load(WARNINGS_KEY);
  if (warnings[noteKey(roundId, matchId, hole)]) {
    delete warnings[noteKey(roundId, matchId, hole)];
    store(WARNINGS_KEY, warnings);
  }
}

// This phone's notes for one match, as [{ hole, a, b, status }],
// sorted by hole number.
export function entriesForMatch(roundId, matchId) {
  const prefix = `${roundId}/${matchId}/`;
  return Object.entries(load(ENTRIES_KEY))
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, note]) => ({ hole: Number(key.slice(prefix.length)), ...note }))
    .sort((x, y) => x.hole - y.hole);
}

// Does the server's value for one side contradict what this phone
// entered? Only numbers this phone actually ENTERED count: if this
// phone left a box empty (null) and someone else filled it in later,
// that's not a contradiction, just the rest of the hole arriving.
// For best ball the values are arrays (one per player), compared
// position by position.
function sideConflicts(entered, server) {
  if (Array.isArray(entered)) {
    const serverArray = Array.isArray(server) ? server : [];
    return entered.some((v, i) => v != null && serverArray[i] !== v);
  }
  return entered != null && server !== entered;
}

// Called whenever the SERVER has confirmed a match's current state (no
// unsent changes on this phone, and not from the phone's saved copy).
// `holes` is that match's holes map from Firestore. For each hole this
// phone entered:
//   - server agrees      -> mark "sent" (and report it as newly sent if
//                           it was still pending);
//   - server disagrees   -> turn the note into a "changed" warning.
// Returns the hole numbers that just became "sent".
export function reconcileMatch(roundId, matchId, holes) {
  const entries = load(ENTRIES_KEY);
  const warnings = load(WARNINGS_KEY);
  const prefix = `${roundId}/${matchId}/`;
  const newlySent = [];
  let changed = false;

  for (const [key, note] of Object.entries(entries)) {
    if (!key.startsWith(prefix)) continue;
    const hole = Number(key.slice(prefix.length));
    const server = holes[String(hole)] || {};

    if (sideConflicts(note.a, server.a) || sideConflicts(note.b, server.b)) {
      // Keep any "refused" warning already there (it's the more
      // specific explanation of the same event).
      if (!warnings[key]) {
        warnings[key] = {
          type: "changed",
          roundId,
          matchId,
          hole,
          entered: { a: note.a, b: note.b },
          now: { a: server.a ?? null, b: server.b ?? null },
        };
      }
      delete entries[key];   // we warn once; after that it's not "ours"
      changed = true;
    } else if (note.status === "pending") {
      note.status = "sent";
      newlySent.push(hole);
      changed = true;
    }
  }

  if (changed) {
    store(ENTRIES_KEY, entries);
    store(WARNINGS_KEY, warnings);
  }
  return newlySent;
}

// Called if the server rejects a save while the page is still open
// (for example the rules say this phone may not edit this match).
export function markRefused(roundId, matchId, hole, entered, reason) {
  const key = noteKey(roundId, matchId, hole);
  const entries = load(ENTRIES_KEY);
  delete entries[key];
  store(ENTRIES_KEY, entries);
  const warnings = load(WARNINGS_KEY);
  warnings[key] = { type: "refused", roundId, matchId, hole, entered, reason };
  store(WARNINGS_KEY, warnings);
}

// Warnings for one match, sorted by hole, each with its storage `key`
// (used by the OK button to dismiss it).
export function warningsForMatch(roundId, matchId) {
  const prefix = `${roundId}/${matchId}/`;
  return Object.entries(load(WARNINGS_KEY))
    .filter(([key]) => key.startsWith(prefix))
    .map(([key, w]) => ({ key, ...w }))
    .sort((x, y) => x.hole - y.hole);
}

// The OK button.
export function dismissWarning(key) {
  const warnings = load(WARNINGS_KEY);
  delete warnings[key];
  store(WARNINGS_KEY, warnings);
}
