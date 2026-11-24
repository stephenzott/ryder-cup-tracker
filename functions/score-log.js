// Score-change log: the pure "what changed?" logic (Prompt 4).
//
// The trigger in index.js (logScoreEdit) calls diffHoles() with a match
// document's data before and after one save, and writes one scoreEdits
// entry per hole this returns. Kept in its own file, with no Firebase
// code, so it can be tested directly (test/score-log.test.js), the same
// way events.js is.
//
// A hole in Firestore looks like { a, b, t }:
//   a, b  the USA / EU score: a number, or null if not entered yet, or
//         for best ball (round 3) an array with one number per player;
//   t     when the phone's Save was tapped, in milliseconds by the
//         phone's clock (added in Prompt 4; older holes don't have it);
//   u     the saving browser's anonymous sign-in id, as the PHONE
//         reports it: a backup for "who" (see index.js, logScoreEdit).

// One side's value in a single comparable form: undefined -> null, and
// arrays keep their order with missing entries as null. JSON text of
// that is then compared, which is a simple standard way to test two
// small values (numbers, nulls, arrays) for equality.
function normalize(value) {
  if (Array.isArray(value)) return value.map((v) => (v == null ? null : v));
  return value == null ? null : value;
}

function same(x, y) {
  return JSON.stringify(normalize(x)) === JSON.stringify(normalize(y));
}

// Does a side's value contain any number at all?
function hasNumber(value) {
  return Array.isArray(value) ? value.some((v) => v != null) : value != null;
}

// Did a side that already HAD a number end up different? That's what
// the Admin log marks as CHANGED ("edited after first entry"). Filling
// in a side that was still empty (the second team's score arriving)
// is not a change. For best ball, compared player by player.
function sideChanged(before, after) {
  if (Array.isArray(before) || Array.isArray(after)) {
    const b = Array.isArray(before) ? before : [];
    const a = Array.isArray(after) ? after : [];
    return b.some((v, i) => v != null && normalize(a[i]) !== v);
  }
  return before != null && normalize(after) !== before;
}

// A hole's { a, b } for the log, or null if the hole has no numbers.
function scoresOf(hole) {
  if (!hole || (!hasNumber(hole.a) && !hasNumber(hole.b))) return null;
  return { a: normalize(hole.a), b: normalize(hole.b) };
}

// The phone's tap time, if it's a believable number of milliseconds
// (after 2020, and not absurdly far in the future); otherwise null.
function tapTime(hole) {
  const t = hole && hole.t;
  const year2020 = 1577836800000;
  if (typeof t !== "number" || !Number.isFinite(t) || t < year2020 || t > Date.now() + 365 * 24 * 3600 * 1000) return null;
  return t;
}

// Every hole whose USA or EU score changed in this save, in hole
// order. A save that only changed the tap time (same numbers re-saved)
// is skipped, as you chose. Each item:
//   { hole, before: {a,b} | null, after: {a,b} | null,
//     changed: true if a number that was already there is now different,
//     tappedAtMs: the phone's tap time, or null,
//     phoneUid: the browser id the phone stamped, or null }
export function diffHoles(beforeData, afterData) {
  const beforeHoles = (beforeData && beforeData.holes) || {};
  const afterHoles = (afterData && afterData.holes) || {};
  const edits = [];
  for (let h = 1; h <= 18; h++) {
    const b = beforeHoles[String(h)] || {};
    const a = afterHoles[String(h)] || {};
    if (same(b.a, a.a) && same(b.b, a.b)) continue;   // numbers unchanged
    edits.push({
      hole: h,
      before: scoresOf(b),
      after: scoresOf(a),
      changed: sideChanged(b.a, a.a) || sideChanged(b.b, a.b),
      tappedAtMs: tapTime(a),
      phoneUid: typeof a.u === "string" && a.u.length > 0 && a.u.length < 200 ? a.u : null,
    });
  }
  return edits;
}

// Which browser saved, and how sure we are:
//   - the server reported a signed-in browser (authType "app_user"):
//     use its id, source "server";
//   - otherwise, if the phone stamped its id in the hole: use that,
//     source "phone" (honor system, like "Who are you?");
//   - otherwise nobody: source null.
export function pickUid(authType, authId, phoneUid) {
  if (authType === "app_user" && authId) return { uid: authId, source: "server" };
  if (phoneUid) return { uid: phoneUid, source: "phone" };
  return { uid: null, source: null };
}

// A readable "who" for the log, from the saving browser's unlock record
// (unlocks/{uid}: { level, playerId, playerName }) and how it was signed
// in (the trigger's authType). Never copies the admin code that an
// admin unlock record also contains.
//   uid     from pickUid (null if no browser could be identified)
export function describeWho(authType, unlock, uid = authType === "app_user" ? "?" : null) {
  if (!uid) {
    if (authType === "service_account" || authType === "api_key" || authType === "system") {
      return { level: null, playerId: null, whoName: "Firebase console / server" };
    }
    if (authType === "unauthenticated") return { level: null, playerId: null, whoName: "Not signed in" };
    return { level: null, playerId: null, whoName: "Unknown (not reported)" };
  }
  if (!unlock) return { level: null, playerId: null, whoName: "Unknown browser" };
  const playerId = typeof unlock.playerId === "string" ? unlock.playerId : null;
  const playerName = typeof unlock.playerName === "string" ? unlock.playerName : null;
  if (unlock.level === "admin") return { level: "admin", playerId, whoName: playerName ? `${playerName} (admin)` : "Admin" };
  return { level: unlock.level || null, playerId, whoName: playerName || "Unknown player" };
}
