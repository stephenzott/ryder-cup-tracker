// Shared logic for every round page (round1.html, round2.html, and
// later round3/round4). Which round this is comes from a data
// attribute on the page's #app container -- see e.g. round1.html --
// so this one file drives all of them instead of copy-pasting per
// round. Builds two things:
//
//   1. An admin-only "match setup" section: pick who's playing each
//      match. Saved as `sideA`/`sideB` (arrays of player IDs) on each
//      match document.
//   2. A hole-by-hole scorecard per match, open to anyone with the
//      score code: enter strokes, and the match-play status (front 9 /
//      back 9 / overall, and points earned so far) is computed live
//      from those strokes via scoring.js -- never stored separately.

import { db } from "./firebase-init.js";
import { renderUnlockBar, getUnlockLevel } from "./auth.js";
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { ROUNDS, pointsAvailable } from "./rounds-config.js";
import { COURSES } from "./courses-config.js";
import { scoreMatch, sumMatchPoints } from "./scoring.js";

const app = document.getElementById("app");
const roundId = app.dataset.roundId;
const round = ROUNDS.find((r) => r.id === roundId);
const course = COURSES[roundId];

document.title = `${round.label} — Ryder Cup Trip`;

// The parts of the page that never change after load get written once
// here. The live bits (#admin-setup, #matches, #round-total) get
// re-rendered by the Firestore listeners further down.
app.innerHTML = `
  <h1>${round.label}</h1>
  <p>${round.day} — ${course.name} (${course.tee} tees) — ${round.format}.
     ${round.matchCount} ${round.playersPerSide === 1 ? "1v1" : "2v2"} matches,
     up to 3 Nassau points each (front 9 + back 9 + overall), ${pointsAvailable(round)} points total.</p>

  <div id="unlock"></div>

  <section id="admin-setup" style="display: none;">
    <h2>Match Setup (admin)</h2>
    <p>Pick who's playing each match. Saving pairings never touches scores already entered.</p>
    <div id="setup-rows"></div>
  </section>

  <section id="matches"></section>

  <p id="round-total">Round total: loading…</p>
`;

// Whether THIS browser can edit hole scores, and separately, whether
// it can also edit pairings. 'admin' satisfies both (see
// firestore.rules) -- score-only visitors never see the setup section.
let isScoreUnlocked = false;
let isAdminUnlocked = false;

// Live data, kept current by the two onSnapshot listeners below.
let players = [];
let matchesById = {};

function playerName(id) {
  const p = players.find((pl) => pl.id === id);
  return p ? p.name : "(unknown)";
}

function matchRef(matchId) {
  return doc(db, "rounds", roundId, "matches", matchId);
}

// Predictable IDs (match1, match2, ...) rather than Firestore's random
// auto-IDs, so the page always knows exactly which match "slots" this
// round has -- even before an admin has set any of them up yet.
function matchIds() {
  return Array.from({ length: round.matchCount }, (_, i) => `match${i + 1}`);
}

// ---------------------------------------------------------------
// Admin: match setup (pairings)
// ---------------------------------------------------------------

// Dropdowns are filtered to the roster's team assignment (team "A" =
// USA, "B" = Europe -- see roster.js) so admin isn't picking USA
// players out of a list that also has all of Europe mixed in.
function playersOnTeam(team) {
  return players.filter((p) => p.team === team);
}

function playerSelect(name, selectedId, team) {
  const options = playersOnTeam(team)
    .map((p) => `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${p.name}</option>`)
    .join("");
  return `<select name="${name}"><option value="">—</option>${options}</select>`;
}

function renderAdminSetup() {
  const section = document.getElementById("admin-setup");
  section.style.display = isAdminUnlocked ? "" : "none";
  if (!isAdminUnlocked) return;

  const usaCount = playersOnTeam("A").length;
  const eurCount = playersOnTeam("B").length;
  const teamWarning =
    usaCount === 0 || eurCount === 0
      ? `<p class="status-msg error">No players assigned to a team yet — assign teams on the <a href="roster.html">Roster</a> page first.</p>`
      : "";

  document.getElementById("setup-rows").innerHTML =
    teamWarning +
    matchIds()
      .map((matchId) => {
        const data = matchesById[matchId] || {};
        const sideA = data.sideA || [];
        const sideB = data.sideB || [];
        const aSelects = Array.from({ length: round.playersPerSide }, (_, i) =>
          playerSelect(`${matchId}-a-${i}`, sideA[i], "A")
        ).join(" ");
        const bSelects = Array.from({ length: round.playersPerSide }, (_, i) =>
          playerSelect(`${matchId}-b-${i}`, sideB[i], "B")
        ).join(" ");
        return `
        <div class="unlock-bar" data-setup-row="${matchId}">
          <strong>${matchId.replace("match", "Match ")}:</strong>
          USA ${aSelects} vs EUR ${bSelects}
          <button type="button" class="save-pairing" data-match-id="${matchId}">Save</button>
          <span class="status-msg" data-save-status="${matchId}"></span>
        </div>
      `;
    })
    .join("");

  document.querySelectorAll(".save-pairing").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const matchId = btn.dataset.matchId;
      const row = document.querySelector(`[data-setup-row="${matchId}"]`);
      const sideA = Array.from({ length: round.playersPerSide }, (_, i) =>
        row.querySelector(`[name="${matchId}-a-${i}"]`).value
      ).filter(Boolean);
      const sideB = Array.from({ length: round.playersPerSide }, (_, i) =>
        row.querySelector(`[name="${matchId}-b-${i}"]`).value
      ).filter(Boolean);
      // merge: true means this only ever touches sideA/sideB -- any
      // `holes` data already saved for this match is left alone.
      await setDoc(matchRef(matchId), { sideA, sideB }, { merge: true });
      const status = row.querySelector(`[data-save-status="${matchId}"]`);
      status.textContent = "Saved.";
      status.className = "status-msg ok";
    });
  });
}

// ---------------------------------------------------------------
// Scorecards
// ---------------------------------------------------------------

// Turns a match-play margin into a short live-ticker label, e.g.
// "USA 2 UP", "All square", or "—" if not enough holes are in yet to
// say anything.
function statusLabel(segment) {
  if (segment.holesEntered === 0) return "—";
  if (segment.margin === 0) return segment.complete ? "Halved" : "All square";
  const leader = segment.margin > 0 ? "USA" : "EUR";
  return `${leader} ${Math.abs(segment.margin)} UP`;
}

function holeInputValue(data, holeNum, side) {
  const hole = (data.holes || {})[String(holeNum)];
  const v = hole ? hole[side] : null;
  return v == null ? "" : v;
}

function renderMatchCard(matchId) {
  const data = matchesById[matchId] || {};
  const sideA = data.sideA || [];
  const sideB = data.sideB || [];

  if (sideA.length === 0 && sideB.length === 0) {
    return `
      <div class="match-card">
        <h3>${matchId.replace("match", "Match ")}</h3>
        <p><em>Pairings not set yet.</em></p>
      </div>
    `;
  }

  const aNames = sideA.map(playerName).join(" & ") || "TBD";
  const bNames = sideB.map(playerName).join(" & ") || "TBD";
  const scored = scoreMatch(data.holes || {});

  const holesRows = course.holes
    .map((h) => {
      const aVal = holeInputValue(data, h.hole, "a");
      const bVal = holeInputValue(data, h.hole, "b");
      return `
        <tr>
          <td>${h.hole}</td>
          <td>${h.par}</td>
          <td>${h.strokeIndex}</td>
          <td><input type="number" min="1" max="15" inputmode="numeric"
                data-match-id="${matchId}" data-hole="${h.hole}" data-side="a"
                value="${aVal}" ${isScoreUnlocked ? "" : "disabled"} /></td>
          <td><input type="number" min="1" max="15" inputmode="numeric"
                data-match-id="${matchId}" data-hole="${h.hole}" data-side="b"
                value="${bVal}" ${isScoreUnlocked ? "" : "disabled"} /></td>
        </tr>
      `;
    })
    .join("");

  // Projected points only mean anything once at least one hole is in
  // -- before that every segment reads as a meaningless 0.5/0.5 halve.
  const holesEntered = scored.front.holesEntered + scored.back.holesEntered;
  const projectedLine =
    holesEntered > 0
      ? ` <span class="status-msg">(projected if it held: USA ${scored.projected.a}, EUR ${scored.projected.b})</span>`
      : "";

  return `
    <div class="match-card">
      <h3>${matchId.replace("match", "Match ")}: USA (${aNames}) vs EUR (${bNames})</h3>
      <p>
        Front 9: <strong>${statusLabel(scored.front)}</strong> ·
        Back 9: <strong>${statusLabel(scored.back)}</strong> ·
        Overall: <strong>${statusLabel(scored.overall)}</strong><br>
        Points so far — USA ${scored.points.a}, EUR ${scored.points.b}${projectedLine}
      </p>
      <table>
        <thead><tr><th>Hole</th><th>Par</th><th>Idx</th><th>USA</th><th>EUR</th></tr></thead>
        <tbody>${holesRows}</tbody>
      </table>
    </div>
  `;
}

function renderMatches() {
  // If a hole input is focused when this re-renders (e.g. because
  // someone on another phone just saved a different match), rebuild
  // the DOM but put the cursor back where it was instead of silently
  // dropping focus out from under whoever's mid-entry.
  const active = document.activeElement;
  const activeSelector =
    active && active.matches('#matches input[type="number"]')
      ? `input[data-match-id="${active.dataset.matchId}"][data-hole="${active.dataset.hole}"][data-side="${active.dataset.side}"]`
      : null;

  document.getElementById("matches").innerHTML = matchIds().map(renderMatchCard).join("");

  document.querySelectorAll('#matches input[type="number"]').forEach((input) => {
    input.addEventListener("change", async (e) => {
      const { matchId, hole, side } = e.target.dataset;
      const raw = e.target.value;
      const value = raw === "" ? null : parseInt(raw, 10);
      await updateDoc(matchRef(matchId), { [`holes.${hole}.${side}`]: value });
    });
  });

  if (activeSelector) {
    const toRefocus = document.querySelector(activeSelector);
    if (toRefocus) toRefocus.focus();
  }

  const totals = sumMatchPoints(Object.values(matchesById));
  document.getElementById("round-total").textContent =
    `Round total — USA ${totals.a}, EUR ${totals.b} (of ${pointsAvailable(round)} available) · ` +
    `projected if current margins held: USA ${totals.projectedA}, EUR ${totals.projectedB}`;
}

function render() {
  renderAdminSetup();
  renderMatches();
}

render();

onSnapshot(collection(db, "players"), (snapshot) => {
  players = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  render();
});

onSnapshot(collection(db, "rounds", roundId, "matches"), (snapshot) => {
  matchesById = {};
  snapshot.forEach((d) => {
    matchesById[d.id] = d.data();
  });
  render();
});

renderUnlockBar(document.getElementById("unlock"), "score", () => {
  isScoreUnlocked = true;
  isAdminUnlocked = getUnlockLevel() === "admin";
  render();
});
