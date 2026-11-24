// The "what happened, and who should hear about it" logic for score
// alerts, kept free of any Firebase code so plain Node can test it
// (test/events.test.js).
//
// Think of it as three functions:
//
//   detectEvents(before, after)        match before + after -> events
//   pickEvent(events, sub, team)       one subscriber -> their one event
//   buildMessage(event, ...)           event -> notification text
//
// All scoring comes from scoring.js, the SAME file the website uses
// (copied here by `npm run sync`), so a push can never disagree with
// what the scoreboard shows.

import { holeWinner, scoreMatch } from "./scoring.js";

// ------------------------------------------------------------------
// Levels, ranked. A higher rank is a "bigger" event, and a subscriber
// at level L receives every event of rank >= rank(L):
//   "hole"    (1) gets hole + segment + final
//   "segment" (2) gets segment + final
//   "final"   (3) gets final only
// ------------------------------------------------------------------
export const LEVEL_RANK = { hole: 1, segment: 2, final: 3 };

// Display names for the two sides, as everywhere on the site:
// side 'a' is USA, side 'b' is EU.
const SIDE_NAME = { a: "USA", b: "EU" };

// ==================================================================
// 1. EVENTS: what changed between `before` and `after`?
// ==================================================================

// Who's ahead from a margin: positive = USA ('a'), negative = EU ('b'),
// zero = nobody (null, i.e. halved).
function sideFromMargin(margin) {
  if (margin > 0) return "a";
  if (margin < 0) return "b";
  return null;
}

// The newest hole decided by this update: a hole whose winner was null
// (not decided) before and is not null after. If one save decides
// several holes at once, only the highest-numbered one counts. A hole
// that was ALREADY decided and changed is a correction: ignored.
function newestDecidedHole(before, after) {
  const holesBefore = before.holes || {};
  const holesAfter = after.holes || {};
  let newest = null;
  for (let h = 1; h <= 18; h++) {
    const was = holeWinner(holesBefore[String(h)], h, before);
    const now = holeWinner(holesAfter[String(h)], h, after);
    if (was == null && now != null) newest = { hole: h, winner: now };
  }
  return newest;
}

// The list of events for one match update. Each event is
//   { level: "hole" | "segment" | "final",
//     key:   "hole7" | "front" | "back" | "final"   (used for dedupe + tags)
//     hole:  7 (hole events only),
//     gainTeam: 'a' | 'b' | null }   null = halved
//
// Rules:
//   - final: the overall 18 goes from not complete to complete.
//     gainTeam = whoever has more match points (equal -> null).
//   - segment: front or back 9 goes from not complete to complete,
//     UNLESS the final also happened in this update (the final message
//     reports all three results, so the segment would be redundant).
//     gainTeam = sign of that segment's margin.
//   - hole: see newestDecidedHole. gainTeam = the hole's winner.
export function detectEvents(before, after) {
  const was = scoreMatch(before);
  const now = scoreMatch(after);
  const events = [];

  const finalHappened = !was.overall.complete && now.overall.complete;
  if (finalHappened) {
    const { a, b } = now.points;
    events.push({ level: "final", key: "final", gainTeam: a > b ? "a" : b > a ? "b" : null });
  } else {
    for (const key of ["front", "back"]) {
      if (!was[key].complete && now[key].complete) {
        events.push({ level: "segment", key, gainTeam: sideFromMargin(now[key].margin) });
      }
    }
  }

  const decided = newestDecidedHole(before, after);
  if (decided) {
    events.push({
      level: "hole",
      key: `hole${decided.hole}`,
      hole: decided.hole,
      gainTeam: decided.winner === "halved" ? null : decided.winner,
    });
  }

  return events;
}

// ==================================================================
// 2. WHO GETS WHAT
// ==================================================================

// A player's team value in Firestore -> 'a', 'b', or null (no team).
// "A"/"B" are what the Admin page writes; "usa"/"europe" are older
// values that match-ui.js's teamKey also accepts. Anything else (empty,
// "unconfirmed") means no team.
export function teamFromValue(team) {
  if (team === "A" || team === "usa") return "a";
  if (team === "B" || team === "europe") return "b";
  return null;
}

// Can this subscriber receive this event?
//   sub   { level, scope } from their pushSubscriptions document
//   team  'a' | 'b' | null, looked up from players/{playerId} at send time
function isEligible(event, sub, team) {
  const needed = LEVEL_RANK[sub.level];
  if (needed === undefined) return false;               // unknown level: send nothing
  if (LEVEL_RANK[event.level] < needed) return false;   // too small for their level

  // No team -> treated as "all", whatever they picked.
  const scope = team ? sub.scope : "all";
  if (scope === "all") return true;

  // "mine" / "opposing" never get halved (null) events.
  if (event.gainTeam == null) return false;
  if (scope === "mine") return event.gainTeam === team;
  if (scope === "opposing") return event.gainTeam !== team;
  return false;                                         // unknown scope
}

// The ONE event this subscriber should get from this update (or null):
// the highest-ranked one they're eligible for (final, then segment,
// then hole). Sorting a copy keeps the caller's list untouched.
export function pickEvent(events, sub, team) {
  const byRankDesc = [...events].sort((x, y) => LEVEL_RANK[y.level] - LEVEL_RANK[x.level]);
  return byRankDesc.find((event) => isEligible(event, sub, team)) || null;
}

// ==================================================================
// 3. MESSAGE TEXT
// ==================================================================

// Points come in halves: 2.5 -> "2½", 0.5 -> "½". A local copy of
// match-ui.js's formatPoints (that file imports browser-only code, so it
// can't be copied here like scoring.js).
export function formatPoints(n) {
  const whole = Math.floor(n);
  const fraction = n - whole;
  if (fraction === 0) return String(whole);
  if (fraction === 0.5) return whole === 0 ? "½" : `${whole}½`;
  return String(n);
}

// "match2" -> "Match 2", the same label the site shows.
export function matchLabel(matchId) {
  return matchId.replace("match", "Match ");
}

// "Sean Kohn" -> "Kohn"; a single name stays as it is.
function lastName(fullName) {
  const parts = String(fullName || "").trim().split(/\s+/);
  return parts[parts.length - 1] || "?";
}

// One side's players as last names: "Smith/Jones", or "TBD" if empty.
function sideNames(playerIds, namesById) {
  const names = (playerIds || []).map((id) => lastName(namesById[id]));
  return names.length ? names.join("/") : "TBD";
}

// The running standing, e.g. "USA 2 UP thru 7" or "All square thru 7".
// "thru N" counts decided holes, the same convention as the scoreboard.
function standingText(overall) {
  const thru = `thru ${overall.holesEntered}`;
  if (overall.margin === 0) return `All square ${thru}`;
  return `${SIDE_NAME[sideFromMargin(overall.margin)]} ${Math.abs(overall.margin)} UP ${thru}`;
}

// A finished segment's result in one word: "USA", "EU" or "Halved".
function segmentWord(segment) {
  const side = sideFromMargin(segment.margin);
  return side ? SIDE_NAME[side] : "Halved";
}

// The data-only push payload for one event. Every value is a string
// (FCM requires it). The service worker reads exactly these keys.
//
//   event      from detectEvents
//   roundId    "round2"
//   matchId    "match2"
//   after      the match document after the update
//   namesById  { playerId: "Full Name" }
export function buildMessage(event, { roundId, matchId, after, namesById }) {
  const scored = scoreMatch(after);
  const label = matchLabel(matchId);
  const names = `${sideNames(after.sideA, namesById)} vs ${sideNames(after.sideB, namesById)}`;
  const g = event.gainTeam;

  let title;
  let body;
  let tag;

  if (event.level === "hole") {
    title = g ? `${SIDE_NAME[g]} wins hole ${event.hole}` : `Hole ${event.hole} halved`;
    body = `${label} · ${names}\n${standingText(scored.overall)}`;
    // All hole alerts for a match share one tag, so a newer one
    // replaces the older one on the lock screen instead of stacking.
    tag = `${roundId}-${matchId}-hole`;
  } else if (event.level === "segment") {
    const nine = event.key === "front" ? "front 9" : "back 9";
    title = g ? `${label} ${nine}: ${SIDE_NAME[g]} wins` : `${label} ${nine} halved`;
    body = `${names}\n${standingText(scored.overall)}`;
    tag = `${roundId}-${matchId}-${event.key}`;
  } else {
    const { a, b } = scored.points;
    title = `${label} final: USA ${formatPoints(a)} – EU ${formatPoints(b)}`;
    const overallText = scored.overall.margin === 0 ? "Halved" : standingText(scored.overall).replace(/ thru \d+$/, "");
    body = `${names}\nFront ${segmentWord(scored.front)} · Back ${segmentWord(scored.back)} · Overall ${overallText}`;
    tag = `${roundId}-${matchId}-final`;
  }

  return { title, body, tag, url: `/scoreboard.html#${roundId}` };
}

// The notificationLog document id for one event, e.g.
// "2027_round2_match2_hole7" or "2027_round2_match2_final". The trip
// year is part of it because the same round/match ids are reused every
// year: without it, last year's entries would block this year's alerts.
export function logId(year, roundId, matchId, event) {
  return `${year}_${roundId}_${matchId}_${event.key}`;
}

// The test push sent by the "Send me a test notification" button.
export const TEST_MESSAGE = {
  title: "Test notification",
  body: "Score alerts are working on this phone.",
  tag: "test",
  url: "/alerts.html",
};
