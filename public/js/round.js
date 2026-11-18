// Shared logic for every round page (round1.html ... round4.html).
// Which round this is comes from a data attribute on the page's #app
// container (e.g. <div id="app" data-round-id="round1">), so this one
// file drives all four pages. It builds:
//
//   1. A navy header with the round, course and the round's score.
//   2. An admin-only "match setup" section: pick who's playing each
//      match (saved as sideA/sideB) and set handicap strokes given.
//   3. One card per match with live status and a hole-by-hole score
//      entry panel: a current-hole bar, a tappable hole grid, big − / +
//      steppers around each score box, and Save.
//   4. If you've unlocked as a player, your own match goes first and a
//      slim "Your match" bar stays pinned at the top.
//
// Firestore writes are exactly the same three as before the restyle
// (pairings, strokes given, and one hole's scores); everything new here
// is drawing or local UI state (which hole is open, unsaved drafts),
// which is never written anywhere.
//
// Sides are 'a' = USA and 'b' = EU, as in the Firestore data.

import { db } from "./firebase-init.js";
import { renderUnlockBar, getUnlockLevel, getUnlockPlayerId } from "./auth.js";
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { ROUNDS, pointsAvailable } from "./rounds-config.js";
import { COURSES } from "./courses-config.js";
import { HOLE_TIPS } from "./hole-tips-config.js";
import { scoreMatch, sumMatchPoints, holeWinner } from "./scoring.js";
import { playerLink } from "./player-stats.js";
// Shared match-drawing pieces (also used by the scoreboard).
import {
  formatPoints,
  statusPill,
  sidesHtml,
  segmentChipsHtml,
  holeGridHtml,
  SKELETON_CARD,
} from "./match-ui.js";

const app = document.getElementById("app");
const roundId = app.dataset.roundId;
const round = ROUNDS.find((r) => r.id === roundId);
const course = COURSES[roundId];
const isBestBall = round.holeShape === "perPlayer";

document.title = `${round.label} — Ryder Cup Trip`;

// ------------------------------------------------------------------
// Page skeleton. Parts that never change are written once; the live
// parts (#round-total, #admin-setup, #rd-mybar, #matches) are redrawn
// by the Firestore listeners further down. The match area starts with
// grey placeholder cards until the data arrives.
// ------------------------------------------------------------------
app.innerHTML = `
  <header class="rd-header">
    <p class="rd-eyebrow">${round.day} · ${round.format}</p>
    <h1 class="rd-title">${round.label}</h1>
    <p class="rd-course">${course.name} · ${course.tee} tees</p>
    <p class="rd-format">
      ${round.matchCount} ${round.playersPerSide === 1 ? "1v1" : "2v2"} matches ·
      up to 3 Nassau points each (front 9 + back 9 + overall) · ${pointsAvailable(round)} points total
    </p>
    <div class="rd-score" id="round-total"></div>
  </header>

  <div id="unlock"></div>

  <section id="admin-setup" class="rd-admin" hidden>
    <h2>Match setup (admin)</h2>
    <p class="rd-admin-intro">Pick who's playing each match. Saving pairings never touches scores already entered.</p>
    <div id="setup-rows"></div>
  </section>

  <button type="button" class="rd-mybar" id="rd-mybar" hidden></button>

  <section id="matches" aria-busy="true" aria-label="Matches">${SKELETON_CARD.repeat(2)}</section>
`;

// Whether THIS browser can edit hole scores, and separately, whether
// it can also edit pairings. 'admin' satisfies both (see
// firestore.rules) -- score-only visitors never see the setup section.
let isScoreUnlocked = false;
let isAdminUnlocked = false;

// Which roster player picked themselves on the "Who are you?" screen
// -- null until someone's unlocked at the score level (or if they're
// on an admin-only browser that never picked a player). Used below to
// decide which specific matches THIS browser can enter scores for, and
// which match is "yours".
let currentPlayerId = null;

// Admin can edit any match; a plain score-level visitor can only edit
// a match they're actually playing in. The real gate is server-side
// in firestore.rules (this is only so the page shows the right view
// instead of silently failing on Save).
function canEditMatch(sideA, sideB) {
  if (!isScoreUnlocked) return false;
  if (isAdminUnlocked) return true;
  return sideA.includes(currentPlayerId) || sideB.includes(currentPlayerId);
}

// Live data, kept current by the two onSnapshot listeners below.
let players = [];
let matchesById = {};
let playersLoaded = false;
let matchesLoaded = false;

// Which hole's entry panel each match is currently showing (1-18).
// Purely local UI state -- never written to Firestore -- so it
// survives re-renders but resets if you reload the page. Set lazily
// the first time a match is rendered (see currentHoleFor below).
const currentHoleByMatch = {};

// Unsaved entries ("drafts"), keyed "match3:7" (match + hole) ->
// { a, b } in the same shape Save writes (a number, or an array of
// numbers for best ball). The page redraws whenever ANY match changes
// on any phone; without this, a redraw would wipe numbers you'd
// entered but not saved yet. Drafts live only in this page's memory:
// never written to Firestore, cleared when you press Save.
const drafts = {};
const draftKey = (matchId, hole) => `${matchId}:${hole}`;

function playerName(id) {
  const p = players.find((pl) => pl.id === id);
  return p ? p.name : "(unknown)";
}

function namesLinked(ids) {
  return ids.map((id) => playerLink(id, playerName(id))).join(" & ");
}

const people = (ids) => ids.map((id) => ({ id, name: playerName(id) }));

function matchRef(matchId) {
  return doc(db, "rounds", roundId, "matches", matchId);
}

// Predictable IDs (match1, match2, ...) rather than Firestore's random
// auto-IDs, so the page always knows exactly which match "slots" this
// round has -- even before an admin has set any of them up yet.
function matchIds() {
  return Array.from({ length: round.matchCount }, (_, i) => `match${i + 1}`);
}

// The match the unlocked player is in on this round, or null.
function myMatchId() {
  if (!currentPlayerId) return null;
  return (
    matchIds().find((id) => {
      const data = matchesById[id] || {};
      return (data.sideA || []).includes(currentPlayerId) || (data.sideB || []).includes(currentPlayerId);
    }) || null
  );
}

// ---------------------------------------------------------------
// Admin: match setup (pairings and strokes given)
// ---------------------------------------------------------------

// Dropdowns are filtered to the roster's team assignment (team "A" =
// USA, "B" = EU -- see roster.js) so admin isn't picking USA players
// out of a list that also has all of the EU team mixed in.
function playersOnTeam(team) {
  return players.filter((p) => p.team === team);
}

function playerSelect(name, selectedId, team, label) {
  const options = playersOnTeam(team)
    .map((p) => `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${p.name}</option>`)
    .join("");
  return `<select name="${name}" aria-label="${label}"><option value="">—</option>${options}</select>`;
}

// The N holes a player gets strokes on: always the hardest-by-stroke-
// index holes, in order -- that's how handicap allocation actually
// works (never picked hole-by-hole), which is why there's no manual
// per-hole override anywhere here. `avoidHoles` (closing holes 9/18,
// typically) gets skipped over in favor of the next hardest hole --
// some courses rate a closing hole as very low stroke index (e.g.
// Straits' 18th is index 2), and you may not want the match decided
// by a stroke on the last hole of a nine. Wraps past 18 candidates for
// counts above that (2nd stroke on the hardest holes), matching full
// handicap allocation for a high handicap. Works off course.holes'
// par/strokeIndex data generically, so this applies the same way to
// whatever courses get added in future years.
function hardestHoles(count, avoidHoles = []) {
  const sorted = [...course.holes]
    .filter((h) => !avoidHoles.includes(h.hole))
    .sort((a, b) => a.strokeIndex - b.strokeIndex);
  return Array.from({ length: count }, (_, i) => sorted[i % sorted.length].hole);
}

// Read-only grid showing where a player's strokes currently land --
// view only, not clickable, since strokes are always set via the shot
// count + "Apply," never picked hole-by-hole. Each box always shows
// that hole's stroke index, so you can see the difficulty ranking (and
// which holes a given count would hit) before even entering a number
// -- a "*" after the index flags a 2nd stroke there (only possible for
// shot counts above 18). Laid out as a 9-column grid (front nine on
// top, back nine below) by CSS. Each box has two parts: a small
// "Hole 7" label on top and the stroke index below it (.ht-si), so
// "Apply" can update just the index.
function strokesDisplayStrip(playerId, currentHoles) {
  let html = "";
  for (let h = 1; h <= 18; h++) {
    const count = currentHoles.filter((x) => x === h).length;
    const strokeIndex = course.holes[h - 1].strokeIndex;
    const label = count > 1 ? `${strokeIndex}*` : String(strokeIndex);
    html += `<div class="hole-toggle-btn${count > 0 ? " toggled" : ""}"
               data-player-id="${playerId}" data-hole="${h}" data-stroke-count="${count}">
               <span class="ht-hole">Hole ${h}</span><span class="ht-si">${label}</span>
             </div>`;
  }
  return html;
}

// Strokes-given setup for one match -- only for rounds where it's
// eligible (3 and 4), and only once pairings are actually set (no
// point picking strokes for players that aren't assigned yet).
function renderStrokesGivenRow(matchId, data) {
  if (!round.strokesGivenEligible) return "";
  const sideA = data.sideA || [];
  const sideB = data.sideB || [];
  if (sideA.length === 0 || sideB.length === 0) return "";

  const playerRows = [...sideA, ...sideB]
    .map((pid) => {
      const current = (data.strokesGiven && data.strokesGiven[pid]) || [];
      return `
        <div class="strokes-player">
          <div class="strokes-player-name">${playerLink(pid, playerName(pid))}</div>
          <div class="strokes-player-controls">
            <label class="strokes-count-label">Shots
              <input type="number" min="0" max="36" class="strokes-count-input" data-player-id="${pid}" value="${current.length}" />
            </label>
            <label class="strokes-avoid-label"><input type="checkbox" class="avoid-closing-checkbox" data-player-id="${pid}" /> Avoid 9 &amp; 18</label>
            <button type="button" class="secondary apply-strokes" data-player-id="${pid}">Apply to hardest holes</button>
          </div>
          <div class="strokes-toggle-strip" data-player-id="${pid}" aria-label="Stroke index per hole; highlighted holes get a stroke">${strokesDisplayStrip(pid, current)}</div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="strokes-given-row" data-strokes-match-id="${matchId}">
      <h3 class="rd-setup-subtitle">${matchId.replace("match", "Match ")} — strokes given</h3>
      <p class="rd-help">Enter a shot count and tap Apply. Strokes always go on the hardest holes in order, same as real handicap allocation. Numbers in the grid are each hole's stroke index.</p>
      ${playerRows}
      <div class="rd-actions">
        <button type="button" class="save-strokes" data-match-id="${matchId}">Save strokes given</button>
        <span class="status-msg" data-save-status="${matchId}-strokes"></span>
      </div>
    </div>
  `;
}

function renderAdminSetup() {
  const section = document.getElementById("admin-setup");
  section.hidden = !isAdminUnlocked;
  if (!isAdminUnlocked) return;

  const usaCount = playersOnTeam("A").length;
  const euCount = playersOnTeam("B").length;
  const teamWarning =
    usaCount === 0 || euCount === 0
      ? `<p class="status-msg error">No players assigned to a team yet — assign teams on the <a href="roster.html">Roster</a> page first.</p>`
      : "";

  document.getElementById("setup-rows").innerHTML =
    teamWarning +
    matchIds()
      .map((matchId) => {
        const data = matchesById[matchId] || {};
        const sideA = data.sideA || [];
        const sideB = data.sideB || [];
        const label = matchId.replace("match", "Match ");
        const aSelects = Array.from({ length: round.playersPerSide }, (_, i) =>
          playerSelect(`${matchId}-a-${i}`, sideA[i], "A", `${label}, USA player ${i + 1}`)
        ).join("");
        const bSelects = Array.from({ length: round.playersPerSide }, (_, i) =>
          playerSelect(`${matchId}-b-${i}`, sideB[i], "B", `${label}, EU player ${i + 1}`)
        ).join("");
        return `
        <div class="rd-setup-card">
          <div class="rd-setup-row" data-setup-row="${matchId}">
            <h3 class="rd-setup-subtitle">${label}</h3>
            <div class="rd-setup-sides">
              <div class="rd-setup-side rd-setup-usa"><span class="rd-setup-team">USA</span>${aSelects}</div>
              <div class="rd-setup-side rd-setup-eu"><span class="rd-setup-team">EU</span>${bSelects}</div>
            </div>
            <div class="rd-actions">
              <button type="button" class="save-pairing" data-match-id="${matchId}">Save pairing</button>
              <span class="status-msg" data-save-status="${matchId}"></span>
            </div>
          </div>
          ${renderStrokesGivenRow(matchId, data)}
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

  // "Apply to hardest holes": fills the (read-only) grid from the
  // number input and the "avoid 9 & 18" checkbox. The only way
  // strokes ever get set -- nothing here is directly clickable.
  // Doesn't touch other players or save anything by itself.
  document.querySelectorAll(".apply-strokes").forEach((btn) => {
    btn.addEventListener("click", () => {
      const playerId = btn.dataset.playerId;
      const count = parseInt(
        document.querySelector(`.strokes-count-input[data-player-id="${playerId}"]`).value || "0",
        10
      );
      const avoidClosing = document.querySelector(`.avoid-closing-checkbox[data-player-id="${playerId}"]`).checked;
      const holes = hardestHoles(count, avoidClosing ? [9, 18] : []);
      document
        .querySelectorAll(`.strokes-toggle-strip[data-player-id="${playerId}"] .hole-toggle-btn`)
        .forEach((holeBox) => {
          const h = parseInt(holeBox.dataset.hole, 10);
          const strokeCount = holes.filter((x) => x === h).length;
          const strokeIndex = course.holes[h - 1].strokeIndex;
          holeBox.dataset.strokeCount = strokeCount;
          // Only the stroke-index part changes; the "Hole N" label stays.
          holeBox.querySelector(".ht-si").textContent = strokeCount > 1 ? `${strokeIndex}*` : String(strokeIndex);
          holeBox.classList.toggle("toggled", strokeCount > 0);
        });
    });
  });

  document.querySelectorAll(".save-strokes").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const matchId = btn.dataset.matchId;
      const row = document.querySelector(`[data-strokes-match-id="${matchId}"]`);
      const strokesGiven = {};
      row.querySelectorAll(".strokes-player").forEach((playerBlock) => {
        const strip = playerBlock.querySelector(".strokes-toggle-strip");
        const playerId = strip.dataset.playerId;
        const holes = [];
        strip.querySelectorAll(".hole-toggle-btn").forEach((holeBtn) => {
          const count = parseInt(holeBtn.dataset.strokeCount, 10);
          for (let i = 0; i < count; i++) holes.push(parseInt(holeBtn.dataset.hole, 10));
        });
        strokesGiven[playerId] = holes;
      });
      await setDoc(matchRef(matchId), { strokesGiven }, { merge: true });
      const status = row.querySelector(`[data-save-status="${matchId}-strokes"]`);
      status.textContent = "Saved.";
      status.className = "status-msg ok";
    });
  });
}

// ---------------------------------------------------------------
// Score entry helpers
// ---------------------------------------------------------------

// The value to show in a score box: an unsaved draft if there is one,
// otherwise what's saved in Firestore, otherwise empty.
// playerIndex is only used for best ball (round.holeShape ===
// "perPlayer"), where a side's value is an array of each player's own
// strokes instead of one shared number.
function holeInputValue(data, matchId, holeNum, side, playerIndex = null, { savedOnly = false } = {}) {
  const draft = savedOnly ? null : drafts[draftKey(matchId, holeNum)];
  let v;
  if (draft) {
    v = draft[side];
  } else {
    const hole = (data.holes || {})[String(holeNum)];
    if (!hole) return "";
    v = hole[side];
  }
  if (playerIndex != null) v = Array.isArray(v) ? v[playerIndex] : null;
  return v == null ? "" : v;
}

// How many strokes a player is given on a specific hole, so the entry
// panel can show a "+1" badge next to their name -- scorers enter what
// was actually shot; the app applies the stroke when scoring, not here.
function strokesOnHoleFor(data, playerId, holeNum) {
  const given = data.strokesGiven && data.strokesGiven[playerId];
  if (!given) return 0;
  return given.filter((h) => h === holeNum).length;
}

function strokeBadge(count) {
  if (count === 0) return "";
  const words = count === 1 ? "gets 1 stroke on this hole" : `gets ${count} strokes on this hole`;
  return ` <span class="rd-stroke-badge" title="${words}"><span aria-hidden="true">+${count}</span><span class="visually-hidden">${words}</span></span>`;
}

// Reads a side's inputs for the hole currently open on a match card.
// Best ball (holeShape "perPlayer") has one input per player and
// needs them back as an array in player order; everything else has
// just the one shared input.
function readSideValue(card, side) {
  const inputs = [...card.querySelectorAll(`.hole-score-input[data-side="${side}"]`)];
  const parsed = (input) => (input.value === "" ? null : parseInt(input.value, 10));
  if (!isBestBall) return parsed(inputs[0]);
  return inputs
    .sort((x, y) => x.dataset.playerIndex - y.dataset.playerIndex)
    .map(parsed);
}

function sideComplete(value) {
  return isBestBall ? value.every((v) => v != null) : value != null;
}

// One − [ box ] + stepper. The buttons only change the box's value
// (see the click handler below); Save reads the boxes exactly as before.
// The empty box shows par as a faint hint (placeholder).
function stepperHtml(matchId, side, playerIndex, value, par, who, holeNum) {
  const indexAttr = playerIndex == null ? "" : ` data-player-index="${playerIndex}"`;
  const target = `data-match-id="${matchId}" data-side="${side}"${indexAttr}`;
  return `
    <div class="rd-stepper">
      <button type="button" class="rd-step" ${target} data-step="-1" aria-label="One less for ${who}">−</button>
      <input type="number" min="1" max="15" inputmode="numeric" class="hole-score-input" ${target}
             value="${value}" placeholder="${par}" aria-label="${who}, hole ${holeNum} strokes" />
      <button type="button" class="rd-step" ${target} data-step="1" aria-label="One more for ${who}">+</button>
    </div>
  `;
}

// The score inputs for the current hole (editable cards). Rounds 1/2/4
// have one number per side; round 3 (best ball) has one per player,
// labeled with their name, since each player plays their own ball.
function renderHoleInputs(matchId, data, currentHole, sideA, sideB) {
  const par = course.holes[currentHole - 1].par;
  const value = (side, i = null) => holeInputValue(data, matchId, currentHole, side, i);

  if (!isBestBall) {
    // Singles (round 4) shows the player's name; team formats show the team.
    const who = (team, ids) => (round.playersPerSide === 1 && ids[0] ? `${team} · ${playerName(ids[0])}` : team);
    const group = (sideKey, team, ids) => `
      <div class="rd-input-group rd-input-${team.toLowerCase()}">
        <div class="rd-input-label">${who(team, ids)}${strokeBadge(strokesOnHoleFor(data, ids[0], currentHole))}</div>
        ${stepperHtml(matchId, sideKey, null, value(sideKey), par, who(team, ids), currentHole)}
      </div>
    `;
    return `<div class="rd-inputs">${group("a", "USA", sideA)}${group("b", "EU", sideB)}</div>`;
  }

  const group = (sideKey, team, ids) => `
    <div class="rd-input-group rd-input-${team.toLowerCase()}">
      <div class="rd-input-team">${team}</div>
      ${ids
        .map(
          (pid, i) => `
            <div class="rd-input-label">${playerName(pid)}${strokeBadge(strokesOnHoleFor(data, pid, currentHole))}</div>
            ${stepperHtml(matchId, sideKey, i, value(sideKey, i), par, playerName(pid), currentHole)}
          `
        )
        .join("")}
    </div>
  `;
  return `<div class="rd-inputs">${group("a", "USA", sideA)}${group("b", "EU", sideB)}</div>`;
}

// Read-only version for cards this browser can't score: the current
// hole's SAVED scores as plain numbers ("—" if not entered yet).
function renderHoleReadOnly(matchId, data, currentHole, sideA, sideB) {
  const shown = (side, i = null) => holeInputValue(data, matchId, currentHole, side, i, { savedOnly: true }) || "—";
  const line = (team, side, ids) => {
    if (!isBestBall) {
      return `<div class="rd-ro-side rd-ro-${team.toLowerCase()}"><span class="rd-ro-team">${team}</span><span class="rd-ro-value">${shown(side)}</span></div>`;
    }
    const each = ids
      .map((pid, i) => `<span class="rd-ro-player">${playerName(pid).split(" ")[0]} <strong>${shown(side, i)}</strong></span>`)
      .join("");
    return `<div class="rd-ro-side rd-ro-${team.toLowerCase()}"><span class="rd-ro-team">${team}</span>${each}</div>`;
  };
  return `<div class="rd-readonly" aria-label="Scores entered for hole ${currentHole}">${line("USA", "a", sideA)}${line("EU", "b", sideB)}</div>`;
}

// Which hole's entry panel to show for a match by default: the first
// one that's missing a score for either side, or 18 if the whole
// match is fully entered. Only computed once per match (see the
// currentHoleByMatch cache) so it doesn't jump around on every
// re-render while someone's actively using it.
function currentHoleFor(matchId, data) {
  if (currentHoleByMatch[matchId] == null) {
    const holes = data.holes || {};
    const firstOpen = course.holes.find((h) => holeWinner(holes[String(h.hole)], h.hole, data) == null);
    currentHoleByMatch[matchId] = firstOpen ? firstOpen.hole : 18;
  }
  return currentHoleByMatch[matchId];
}

// ---------------------------------------------------------------
// Match cards
// ---------------------------------------------------------------

function renderMatchCard(matchId, mine) {
  const data = matchesById[matchId] || {};
  const sideA = data.sideA || [];
  const sideB = data.sideB || [];
  const label = matchId.replace("match", "Match ");

  if (sideA.length === 0 && sideB.length === 0) {
    return `
      <article class="sb-card rd-card rd-card-empty" id="card-${matchId}" data-match-id="${matchId}">
        <h3 class="sb-match-no">${label}</h3>
        <p class="rd-empty-note">Pairings not set yet.</p>
      </article>
    `;
  }

  const scored = scoreMatch(data);
  const currentHole = currentHoleFor(matchId, data);
  const holeInfo = course.holes[currentHole - 1];
  const holeTip = HOLE_TIPS[roundId][currentHole - 1];
  const canEdit = canEditMatch(sideA, sideB);
  const hasDraft = Boolean(drafts[draftKey(matchId, currentHole)]);

  // Shown on locked cards once someone's unlocked, so it's obvious WHY
  // entry is locked here but not on another match. Never shown on a
  // fully locked page (spectators just see the read-only view).
  const lockedNote =
    isScoreUnlocked && !canEdit
      ? `<p class="rd-locked-note">Only ${namesLinked(sideA) || "TBD"} or ${namesLinked(sideB) || "TBD"} can enter scores for this match.</p>`
      : "";

  const entry = canEdit
    ? `
      ${renderHoleInputs(matchId, data, currentHole, sideA, sideB)}
      <div class="rd-save-row">
        <button type="button" class="save-hole rd-save" data-match-id="${matchId}">Save hole ${currentHole}</button>
        <span class="rd-unsaved"${hasDraft ? "" : " hidden"}>Not saved yet</span>
        <span class="status-msg" data-save-status="${matchId}-hole"></span>
      </div>
    `
    : renderHoleReadOnly(matchId, data, currentHole, sideA, sideB) + lockedNote;

  return `
    <article class="sb-card rd-card${mine ? " is-mine" : ""}" id="card-${matchId}" data-match-id="${matchId}">
      <div class="sb-card-top">
        <h3 class="sb-match-no">${label}${mine ? ' <span class="rd-mine-tag">Your match</span>' : ""}</h3>
        ${statusPill(scored.overall)}
      </div>
      ${sidesHtml(people(sideA), people(sideB), scored.points)}
      ${segmentChipsHtml(scored)}

      <div class="rd-entry">
        <!-- Current-hole bar: previous / hole info / next. -->
        <div class="rd-holebar">
          <button type="button" class="rd-nav prev-hole" data-match-id="${matchId}" aria-label="Previous hole" ${currentHole <= 1 ? "disabled" : ""}>◀</button>
          <div class="rd-holeinfo">
            <span class="rd-holeno">Hole ${currentHole}</span>
            <span class="rd-holemeta">Par ${holeInfo.par} · SI ${holeInfo.strokeIndex}</span>
          </div>
          <button type="button" class="rd-nav next-hole" data-match-id="${matchId}" aria-label="Next hole" ${currentHole >= 18 ? "disabled" : ""}>▶</button>
        </div>
        <!-- Links out to Kohler's yardage PDF and hole-description page.
             rel="noopener" is standard practice for target="_blank"
             links: without it, the opened page gets a handle back to
             this tab via window.opener and could redirect it -- a
             known phishing trick called "tabnabbing". -->
        <div class="rd-holelinks">
          <a href="${holeTip.yardageUrl}" target="_blank" rel="noopener">Yardage guide ↗</a>
          <a href="${holeTip.tipUrl}" target="_blank" rel="noopener">How to play ↗</a>
        </div>
        ${holeGridHtml(data, { interactive: true, currentHole })}
        ${entry}
      </div>
    </article>
  `;
}

// The slim pinned "Your match" bar (only when you're in a match here).
function renderMyBar(myId) {
  const bar = document.getElementById("rd-mybar");
  const data = myId ? matchesById[myId] || {} : {};
  const paired = myId && ((data.sideA || []).length || (data.sideB || []).length);
  bar.hidden = !paired;
  if (!paired) return;
  const scored = scoreMatch(data);
  bar.dataset.target = `card-${myId}`;
  bar.innerHTML = `
    <span class="rd-mybar-label">Your match</span>
    <span class="rd-mybar-hole">${myId.replace("match", "Match ")} · Hole ${currentHoleFor(myId, data)}</span>
    ${statusPill(scored.overall)}
  `;
}

function renderRoundTotal() {
  const totals = sumMatchPoints(Object.values(matchesById));
  document.getElementById("round-total").innerHTML = `
    <div class="rd-score-line">
      <span class="rd-team rd-team-usa">USA ${formatPoints(totals.a)}</span>
      <span class="rd-dash">–</span>
      <span class="rd-team rd-team-eu">EU ${formatPoints(totals.b)}</span>
      <span class="rd-available">of ${pointsAvailable(round)} available</span>
    </div>
    <div class="rd-proj">Projected USA ${formatPoints(totals.projectedA)} – EU ${formatPoints(totals.projectedB)}</div>
  `;
}

// A short description of the focused control inside the match list
// (which kind of control, for which match/side/player/hole), so that
// after a redraw the same control can be found and focused again.
// Keeps keyboard and screen-reader users in place.
const FOCUS_CLASSES = ["hole-score-input", "rd-step", "prev-hole", "next-hole", "rd-hole-btn", "save-hole"];
function focusSelector(el) {
  if (!el || !el.closest || !el.closest("#matches")) return null;
  const cls = FOCUS_CLASSES.find((c) => el.classList.contains(c));
  if (!cls) return null;
  const card = el.closest(".rd-card");
  let selector = `[data-match-id="${card.dataset.matchId}"] .${cls}`;
  for (const attr of ["side", "playerIndex", "step", "hole"]) {
    if (el.dataset[attr] != null) {
      const name = attr.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);   // playerIndex -> player-index
      selector += `[data-${name}="${el.dataset[attr]}"]`;
    }
  }
  return selector;
}

function renderMatches() {
  const matchesEl = document.getElementById("matches");
  renderRoundTotal();

  // Until both the matches and the players have arrived, keep the grey
  // placeholder cards (names would otherwise flash as "(unknown)").
  if (!matchesLoaded || !playersLoaded) return;
  matchesEl.removeAttribute("aria-busy");

  // Remember focus and scroll position before replacing the cards.
  const toRefocus = focusSelector(document.activeElement);
  const savedScrollY = window.scrollY;

  const mine = myMatchId();
  const order = mine ? [mine, ...matchIds().filter((id) => id !== mine)] : matchIds();
  matchesEl.innerHTML = order.map((id) => renderMatchCard(id, id === mine)).join("");
  renderMyBar(mine);

  if (window.scrollY !== savedScrollY) window.scrollTo(0, savedScrollY);
  if (toRefocus) document.querySelector(toRefocus)?.focus();
}

function goToHole(matchId, hole) {
  currentHoleByMatch[matchId] = Math.min(18, Math.max(1, hole));
  renderMatches();
}

// Save whatever is in a card's score boxes as an unsaved draft and
// show the "Not saved yet" note.
function updateDraft(card) {
  const matchId = card.dataset.matchId;
  drafts[draftKey(matchId, currentHoleByMatch[matchId])] = {
    a: readSideValue(card, "a"),
    b: readSideValue(card, "b"),
  };
  const note = card.querySelector(".rd-unsaved");
  if (note) note.hidden = false;
}

// ---------------------------------------------------------------
// Event handling. The cards are redrawn often, so instead of
// attaching listeners to every button on every redraw, ONE listener
// on the #matches container catches clicks from anything inside it
// and checks what was tapped (standard "event delegation").
// ---------------------------------------------------------------
const matchesEl = document.getElementById("matches");

matchesEl.addEventListener("click", async (event) => {
  const target = event.target.closest("button");
  if (!target || target.disabled) return;
  // The card is found by its class. (Not by data-match-id: the buttons
  // and inputs carry that attribute too, so "closest element with
  // data-match-id" would return the button itself.)
  const card = target.closest(".rd-card");
  if (!card) return;
  const matchId = card.dataset.matchId;

  if (target.classList.contains("prev-hole")) return goToHole(matchId, currentHoleByMatch[matchId] - 1);
  if (target.classList.contains("next-hole")) return goToHole(matchId, currentHoleByMatch[matchId] + 1);
  if (target.classList.contains("rd-hole-btn")) return goToHole(matchId, parseInt(target.dataset.hole, 10));

  // − / + : change the matching box by one. An empty box starts at par
  // on the first tap. Kept between 1 and 15 (the box's min/max).
  if (target.classList.contains("rd-step")) {
    const index = target.dataset.playerIndex;
    const input = card.querySelector(
      `.hole-score-input[data-side="${target.dataset.side}"]${index == null ? "" : `[data-player-index="${index}"]`}`
    );
    const par = course.holes[currentHoleByMatch[matchId] - 1].par;
    const current = input.value === "" ? null : parseInt(input.value, 10);
    const next = current == null ? par : current + parseInt(target.dataset.step, 10);
    input.value = Math.min(15, Math.max(1, next));
    updateDraft(card);
    return;
  }

  if (target.classList.contains("save-hole")) {
    const hole = currentHoleByMatch[matchId];
    const aValue = readSideValue(card, "a");
    const bValue = readSideValue(card, "b");

    await updateDoc(matchRef(matchId), {
      [`holes.${hole}.a`]: aValue,
      [`holes.${hole}.b`]: bValue,
    });

    // Saved, so this hole's draft is no longer needed.
    delete drafts[draftKey(matchId, hole)];

    // Once both scores for this hole are in, move on to the next
    // one automatically -- matches walking down the fairway hole by
    // hole rather than making you click "Next" every time.
    if (sideComplete(aValue) && sideComplete(bValue) && hole < 18) {
      currentHoleByMatch[matchId] = hole + 1;
    }
    renderMatches();
  }
});

// Typing in a box directly also counts as an unsaved draft.
matchesEl.addEventListener("input", (event) => {
  if (!event.target.matches(".hole-score-input")) return;
  updateDraft(event.target.closest(".rd-card"));
});

// Tapping the pinned "Your match" bar scrolls to your card.
document.getElementById("rd-mybar").addEventListener("click", (event) => {
  const card = document.getElementById(event.currentTarget.dataset.target);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  card?.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
});

function render() {
  renderAdminSetup();
  renderMatches();
}

render();

onSnapshot(collection(db, "players"), (snapshot) => {
  players = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  playersLoaded = true;
  render();
});

onSnapshot(collection(db, "rounds", roundId, "matches"), (snapshot) => {
  matchesById = {};
  snapshot.forEach((d) => {
    matchesById[d.id] = d.data();
  });
  matchesLoaded = true;
  render();
});

renderUnlockBar(document.getElementById("unlock"), "score", () => {
  isScoreUnlocked = true;
  isAdminUnlocked = getUnlockLevel() === "admin";
  currentPlayerId = getUnlockPlayerId();
  render();
});
