// DEMO ONLY. Stands in for Firebase's Firestore library on the demo
// page (via the import map in demo.html). It offers the same handful
// of functions the app uses -- collection, doc, query, orderBy,
// onSnapshot, setDoc, updateDoc, addDoc, deleteDoc -- but reads and
// writes the made-up data in ./state.js instead of the real database.
// Saves therefore work, but only inside this browser tab.

import { ready, getState, persist, playNextHoleSomewhere } from "./state.js";

// A "reference" is just the path, e.g. "rounds/round3/matches".
export function collection(db, ...segments) {
  return { path: segments.join("/") };
}
export function doc(db, ...segments) {
  return { path: segments.join("/") };
}
// The roster page sorts with query(..., orderBy("name")); players are
// always handed out sorted by name below, so these can be pass-throughs.
export function query(ref) {
  return ref;
}
export function orderBy() {
  return null;
}

const listeners = [];
const clone = (value) => JSON.parse(JSON.stringify(value ?? {}));

// What a listener on `path` should currently see.
function snapshotFor(path) {
  const state = getState();
  let docs = [];
  if (path === "players") {
    docs = [...state.players]
      .sort((x, y) => x.name.localeCompare(y.name))
      .map(({ id, ...data }) => ({ id, data: () => clone(data) }));
  } else {
    const [, roundId] = path.split("/");   // "rounds/round3/matches"
    docs = Object.entries(state.rounds[roundId] || {}).map(([id, data]) => ({ id, data: () => clone(data) }));
  }
  return { docs, forEach: (fn) => docs.forEach(fn) };
}

// Like Firestore: call back once with the current data, then again
// after every change.
export function onSnapshot(ref, callback) {
  const listener = { path: ref.path, callback };
  listeners.push(listener);
  ready.then(() => callback(snapshotFor(listener.path)));
  return () => listeners.splice(listeners.indexOf(listener), 1);
}

// After a change, tell every listener (a moment later, like the real
// thing, so the saving code finishes first).
function notifyAll() {
  persist();
  setTimeout(() => listeners.forEach((l) => l.callback(snapshotFor(l.path))), 0);
}

// The match (or player) object a document path points at.
function target(path, create = true) {
  const state = getState();
  const parts = path.split("/");
  if (parts[0] === "players") return state.players.find((p) => p.id === parts[1]);
  const round = state.rounds[parts[1]];
  if (!round[parts[3]] && create) round[parts[3]] = {};
  return round[parts[3]];
}

// updateDoc supports dotted field paths like "holes.10.a", which is how
// the round page saves one hole.
export async function updateDoc(ref, fields) {
  await ready;
  const obj = target(ref.path);
  for (const [key, value] of Object.entries(fields)) {
    const keys = key.split(".");
    let node = obj;
    for (const k of keys.slice(0, -1)) node = node[k] ??= {};
    node[keys[keys.length - 1]] = value;
  }
  notifyAll();
}

// setDoc with { merge: true } replaces only the fields given (that's
// all the app uses it for: pairings and strokes given).
export async function setDoc(ref, data, options = {}) {
  await ready;
  const obj = target(ref.path);
  if (!options.merge) Object.keys(obj).forEach((k) => delete obj[k]);
  Object.assign(obj, clone(data));
  notifyAll();
}

export async function addDoc(ref, data) {
  await ready;
  if (ref.path === "players") getState().players.push({ id: `demo-${Date.now()}`, ...clone(data) });
  notifyAll();
}

export async function deleteDoc(ref) {
  await ready;
  const state = getState();
  const parts = ref.path.split("/");
  if (parts[0] === "players") state.players = state.players.filter((p) => p.id !== parts[1]);
  else delete state.rounds[parts[1]][parts[3]];
  notifyAll();
}

// "Live" demo: every `seconds`, another group finishes a hole and every
// listener on the page gets the update, exactly as if it came from
// another phone through Firestore. Returns a function that stops it.
// `onTick` receives a short description of what happened (or null
// once every other match has finished).
export function startLiveSimulation(seconds, onTick) {
  const timer = setInterval(() => {
    const what = playNextHoleSomewhere();
    if (what) notifyAll();
    onTick?.(what);
    if (!what) clearInterval(timer);
  }, seconds * 1000);
  return () => clearInterval(timer);
}
