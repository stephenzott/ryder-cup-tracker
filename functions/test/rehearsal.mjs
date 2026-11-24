// Full-match rehearsal of score alerts, entirely in the emulators.
//
// Run from functions/:   npm run rehearse
//
// That command (see package.json) copies scoring.js etc. in, then starts
// the Firestore + Functions emulators under the offline-only project
// "demo-ryder-rehearsal" and runs this file. The real function code
// (index.js) runs exactly as deployed, except that under the emulator
// its mock sender is used: nothing ever reaches Firebase Cloud
// Messaging. The mock appends every pretend push to the file named in
// MOCK_PUSH_LOG, which this script reads back at the end.
//
// The story: a singles match (round 4, match 1), USA's Sam Smith vs
// EU's Ben Brown, scored hole by hole the way phones would, including a
// half-entered hole, a typo that's corrected, halved holes and a stroke
// given. Five people have alerts set up (see SUBSCRIBERS).

import { readFileSync, existsSync, rmSync } from "node:fs";

const HOST = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const PROJECT = process.env.GCLOUD_PROJECT || "demo-ryder-rehearsal";
const BASE = `http://${HOST}/v1/projects/${PROJECT}/databases/ryder-cup-tracker/documents`;
const LOG = process.env.MOCK_PUSH_LOG;
const MATCH = "rounds/round4/matches/match1";

// Wait this long after each save, so each trigger run finishes (and
// logs) before the next save. Real scoring is minutes apart.
const PAUSE_MS = 1500;

// ------------------------------------------------------------------
// Firestore emulator helpers (REST API; "Bearer owner" = admin, skips
// rules but still fires triggers, like a real phone's save would).
// ------------------------------------------------------------------
function enc(v) {
  if (v === null) return { nullValue: null };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return { integerValue: String(v) };
  if (typeof v === "string") return { stringValue: v };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
}

async function put(path, data) {
  const res = await fetch(`${BASE}/${path}`, {
    method: "PATCH",
    headers: { Authorization: "Bearer owner", "Content-Type": "application/json" },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) }),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
}

const pause = () => new Promise((r) => setTimeout(r, PAUSE_MS));

// ------------------------------------------------------------------
// The cast.
// ------------------------------------------------------------------
const PLAYERS = {
  usa1: ["Sam Smith", "A"],   // plays the match for USA
  eu1: ["Ben Brown", "B"],    // plays the match for EU
  usa2: ["Al Adams", "A"],
  eu2: ["Ed Evans", "B"],
  usa3: ["Cy Clark", "A"],
  none1: ["Nat Noteam", ""],  // confirmed but no team yet
  usa4: ["Dee Dunn", "A"],
};

// Subscribers: the document id doubles as a readable label.
const SUBSCRIBERS = {
  "1-hole-all-USA-ios": { playerId: "usa2", level: "hole", scope: "all", platform: "ios" },
  "2-segment-mine-EU-android": { playerId: "eu2", level: "segment", scope: "mine", platform: "android" },
  "3-final-opposing-USA-ios": { playerId: "usa3", level: "final", scope: "opposing", platform: "ios" },
  "4-hole-mine-NOTEAM": { playerId: "none1", level: "hole", scope: "mine" }, // old doc: no platform
  "5-OFF-hole-all-USA-ios": { playerId: "usa4", level: "hole", scope: "all", platform: "ios", enabled: false },
};

// ------------------------------------------------------------------
// The match, one save at a time. Strokes are gross; Ben (EU) gets a
// stroke on hole 5. Each step: what the save is, then the holes after it.
// ------------------------------------------------------------------
const STEPS = [];
let holes = {};
function save(note, hole, a, b) {
  holes = { ...holes, [String(hole)]: { a, b } };
  STEPS.push({ note, holes });
}
save("Hole 1: Sam 4, Ben 5", 1, 4, 5);
save("Hole 2: Sam 5, Ben 4", 2, 5, 4);
save("Hole 3: both 4 (halved)", 3, 4, 4);
save("Hole 4: Sam 3, Ben 4", 4, 3, 4);
save("Hole 5: both 5 gross, Ben's stroke makes it 5 v 4 net", 5, 5, 5);
save("Hole 6: Sam 4, Ben 5", 6, 4, 5);
save("Hole 7: both 3 (halved)", 7, 3, 3);
save("Hole 8, half-entered: only Sam's 4 so far", 8, 4, null);
save("Hole 8 TYPO: Ben's score typed as 5 (should be 3)", 8, 4, 5);
save("Hole 8 CORRECTED: Ben 3", 8, 4, 3);
save("Hole 9: Sam 4, Ben 5 (front 9 done)", 9, 4, 5);
save("Hole 10: Sam 5, Ben 4", 10, 5, 4);
save("Hole 11: Sam 5, Ben 4", 11, 5, 4);
save("Hole 12: both 4 (halved)", 12, 4, 4);
save("Hole 13: Sam 3, Ben 4", 13, 3, 4);
save("Hole 14: Sam 5, Ben 4", 14, 5, 4);
save("Hole 15: Sam 4, Ben 5", 15, 4, 5);
save("Hole 16: Sam 5, Ben 4", 16, 5, 4);
save("Hole 17: both 3 (halved)", 17, 3, 3);
save("Hole 18: Sam 5, Ben 4 (match over)", 18, 5, 4);

// ------------------------------------------------------------------
// Run it.
// ------------------------------------------------------------------
if (!LOG) throw new Error("MOCK_PUSH_LOG isn't set; run this with `npm run rehearse`.");
if (existsSync(LOG)) rmSync(LOG);

for (const [id, [name, team]] of Object.entries(PLAYERS)) await put(`players/${id}`, { name, team });
for (const [id, s] of Object.entries(SUBSCRIBERS)) {
  const { platform, enabled = true, ...rest } = s;
  await put(`pushSubscriptions/${id}`, { enabled, token: `fake-token-${id}`, ...rest, ...(platform ? { platform, installed: true } : {}) });
}
await put("notificationConfig/global", { enabled: true });

const base = { sideA: ["usa1"], sideB: ["eu1"], strokesGiven: { eu1: [5] } };
// Creating the match (pairings set by the admin) never triggers alerts.
await put(MATCH, { ...base, holes: {} });
await pause();

// Each save, then what was pushed because of it.
const readLog = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const received = Object.fromEntries(Object.keys(SUBSCRIBERS).map((id) => [id, []]));
let seen = 0;

console.log("\n================ REHEARSAL: round 4, match 1 (singles) ================\n");
for (const step of STEPS) {
  await put(MATCH, { ...base, holes: step.holes });
  await pause();
  const fresh = readLog().slice(seen);
  seen += fresh.length;
  console.log(`▶ ${step.note}`);
  if (fresh.length === 0) console.log("    (no pushes)");
  const byTitle = {};
  for (const p of fresh) {
    const id = p.to.split(" · ")[0];
    received[id]?.push(p);
    (byTitle[`${p.title} | ${p.body.replace(/\n/g, " / ")}`] ||= []).push(id.split("-")[0]);
  }
  for (const [text, who] of Object.entries(byTitle)) console.log(`    → subscribers ${who.join(", ")}: ${text}`);
}

console.log("\n================ WHAT EACH PHONE RECEIVED ================\n");
for (const [id, pushes] of Object.entries(received)) {
  console.log(`${id}: ${pushes.length} push${pushes.length === 1 ? "" : "es"}`);
  for (const p of pushes) console.log(`    ${p.title}  [tag ${p.tag}]`);
}
console.log("");
