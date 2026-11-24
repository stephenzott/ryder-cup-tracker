// Shared logic for every round page (round1.html ... round4.html).
// Which round this is comes from a data attribute on the page's #app
// container (e.g. <div id="app" data-round-id="round1">), so this one
// file drives all four pages. It builds:
//
//   1. A navy header with the round, course and the round's score.
//   2. For admins only, a link to this round's pairings and strokes
//      (match setup lives on the Admin page, admin.html / admin.js).
//   3. One card per match with live status and a hole-by-hole score
//      entry panel: a current-hole bar, a tappable hole grid, big − / +
//      steppers around each score box, and Save.
//   4. If you've unlocked as a player, your own match goes first and a
//      slim "Your match" bar stays pinned at the top.
//
// The only Firestore write here is one hole's scores. Everything else is
// drawing or local UI state (which hole is open, unsaved drafts), which
// is never written to Firestore.
//
// Offline project, stage 1: Save no longer waits for the server. The
// score goes into Firestore's on-phone queue (kept even if the app is
// closed, see firebase-init.js) and the page moves straight on. Each
// card then shows which holes are still waiting to send, flips them to
// "Sent" when the server confirms, and warns if the server ends up
// with a different number for a hole this phone entered (see
// my-entries.js for how that's tracked).
//
// Sides are 'a' = USA and 'b' = EU, as in the Firestore data.

import { db } from "./firebase-init.js";
import { renderUnlockBar, getUnlockLevel, getUnlockPlayerId } from "./auth.js";
import {
  collection,
  doc,
  onSnapshot,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { ROUNDS, pointsAvailable } from "./rounds-config.js";
import { COURSES } from "./courses-config.js";
import { HOLE_TIPS } from "./hole-tips-config.js";
import { scoreMatch, sumMatchPoints, holeWinner } from "./scoring.js";
import { playerLink } from "./player-stats.js";
// Offline project: is the server reachable right now? (Also shows the
// "No signal" banner; see connection.js.)
import { isConnected, onConnectionChange, checkConnectionNow } from "./connection.js";
// Offline project: this phone's notes of which holes it entered.
import {
  recordEntry,
  entriesForMatch,
  reconcileMatch,
  markRefused,
  warningsForMatch,
  dismissWarning,
} from "./my-entries.js";
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
// parts (#round-total, #rd-mybar, #matches) are redrawn
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

  <!-- Admins only: a shortcut to this round's pairings and strokes,
       which live on the Admin page. Shown once unlocked as admin. -->
  <a class="rd-admin-link" id="rd-admin-link" href="admin.html#${roundId}" hidden>Set up pairings &amp; strokes for this round →</a>

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

// For each match: does the phone hold changes to it that the server
// hasn't confirmed yet? (Firestore's metadata.hasPendingWrites, which
// is per match document, not per hole.) Filled in by the matches
// listener at the bottom of this file.
const pendingByMatch = {};

// Matches whose waiting holes have just been confirmed by the server,
// mapped to the time until which to show "✓ Sent" on the card. Purely
// local, a few seconds of reassurance after signal returns.
const justSentUntil = {};
const SENT_FLASH_MS = 4000;

// For this long after a save, a connected phone says "Sending…"; after
// that, a save that still hasn't gone through is described as "saved on
// this phone · will send when you have signal" (on weak signal the
// connection can look fine while nothing actually gets through).
const SENDING_GRACE_MS = 10000;
let regraceTimer = null;

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
// Sync status (offline project, stage 1)
// ---------------------------------------------------------------

// "5", or "4/5" for best ball (one number per player), or "–" if empty.
function formatSide(value) {
  if (Array.isArray(value)) return value.map((v) => (v == null ? "–" : v)).join("/");
  return value == null ? "–" : String(value);
}

function formatHoleScore({ a, b }) {
  return `USA ${formatSide(a)} – EU ${formatSide(b)}`;
}

// "Hole 5" or "Holes 5, 6, 7".
function holesPhrase(holes) {
  return holes.length === 1 ? `Hole ${holes[0]}` : `Holes ${holes.join(", ")}`;
}

// The amber notes for holes this phone entered that the server now shows
// differently, or that the server refused. Each stays (even after the
// app is reopened) until its OK button is tapped.
function warningsHtml(matchId) {
  return warningsForMatch(roundId, matchId)
    .map((w) => {
      let text;
      if (w.type === "refused") {
        text = `Hole ${w.hole} (${formatHoleScore(w.entered)}) didn't save: the server refused it${w.reason ? ` (${w.reason})` : ""}. Check you picked your own name, then enter it again.`;
      } else if (w.now.a == null && w.now.b == null) {
        text = `Hole ${w.hole} has no score on the server, but this phone entered ${formatHoleScore(w.entered)}. Please enter it again.`;
      } else {
        text = `Hole ${w.hole} was changed on another phone: now ${formatHoleScore(w.now)} (you entered ${formatHoleScore(w.entered)}).`;
      }
      return `
        <div class="rd-sync-warning" role="alert">
          <p>${text}</p>
          <button type="button" class="secondary rd-sync-ok" data-warning-key="${w.key}">OK</button>
        </div>
      `;
    })
    .join("");
}

// The one-line sync status under the hole bar. Shown only while
// something is waiting to send, then "✓ Sent" for a few seconds.
function syncLineHtml(matchId) {
  const pendingNotes = entriesForMatch(roundId, matchId).filter((note) => note.status === "pending");
  const waiting = pendingNotes.map((note) => note.hole);

  if (waiting.length > 0 || pendingByMatch[matchId]) {
    // If Firestore says the match has unsent changes but this phone has
    // no note of which holes (e.g. its notes were cleared), say so
    // without naming holes.
    const what = waiting.length > 0 ? holesPhrase(waiting) : "Scores";
    // "Sending…" only while connected AND within a few seconds of the
    // latest save; past that, the honest description is "on the phone".
    const latestSave = Math.max(0, ...pendingNotes.map((note) => note.at || 0));
    const sinceSave = Date.now() - latestSave;
    const sending = isConnected() && sinceSave < SENDING_GRACE_MS;
    // Redraw once when the grace ends, to re-word the line. (One shared
    // timer, restarted each time, so frequent redraws don't pile up timers.)
    if (sending) {
      clearTimeout(regraceTimer);
      regraceTimer = setTimeout(renderMatches, SENDING_GRACE_MS - sinceSave + 100);
    }
    const text = sending
      ? `Sending ${what.toLowerCase()}…`
      : `${what} saved on this phone · will send when you have signal`;
    return `<p class="rd-sync-line is-pending" role="status">⏳ ${text}</p>`;
  }
  if ((justSentUntil[matchId] || 0) > Date.now()) {
    return `<p class="rd-sync-line is-sent" role="status">✓ Sent</p>`;
  }
  return "";
}

// Small status beside Save for the hole on screen, if this phone
// entered it: "Saved on phone" while waiting, "Sent ✓" once confirmed.
function holeSyncStatus(matchId, hole) {
  const note = entriesForMatch(roundId, matchId).find((n) => n.hole === hole);
  if (!note) return { text: "", cls: "" };
  return note.status === "pending" ? { text: "Saved on phone", cls: "" } : { text: "Sent ✓", cls: " ok" };
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

  const holeSync = holeSyncStatus(matchId, currentHole);

  const entry = canEdit
    ? `
      ${renderHoleInputs(matchId, data, currentHole, sideA, sideB)}
      <div class="rd-save-row">
        <button type="button" class="save-hole rd-save" data-match-id="${matchId}">Save hole ${currentHole}</button>
        <span class="rd-unsaved"${hasDraft ? "" : " hidden"}>Not saved yet</span>
        <span class="status-msg${holeSync.cls}" data-save-status="${matchId}-hole">${holeSync.text}</span>
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
        ${warningsHtml(matchId)}
        ${syncLineHtml(matchId)}
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

  // OK on a "hole was changed / didn't save" warning: forget it.
  if (target.classList.contains("rd-sync-ok")) {
    dismissWarning(target.dataset.warningKey);
    return renderMatches();
  }

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

    // Only write a side that has at least one number in it. If both
    // scorers are offline and one enters only their own side, writing
    // the other side as blank would ERASE the number the other phone
    // entered once both sync. The trade-off (chosen deliberately):
    // emptying a box and saving no longer clears a number; type the
    // right number instead. (Best ball: a side counts as entered if any
    // of its players has a number.)
    const hasNumber = (value) => (Array.isArray(value) ? value.some((v) => v != null) : value != null);
    const update = {};
    if (hasNumber(aValue)) update[`holes.${hole}.a`] = aValue;
    if (hasNumber(bValue)) update[`holes.${hole}.b`] = bValue;
    if (Object.keys(update).length === 0) return;   // nothing entered: nothing to save

    // Note what this phone saved, so the card can show it as waiting
    // and later confirm or flag it (see my-entries.js).
    recordEntry(roundId, matchId, hole, aValue, bValue);

    // Hand the write to Firestore WITHOUT waiting (no `await`). Firestore
    // applies it to the phone's copy at once (so the page redraws with
    // it) and queues it on the phone until the server can be reached;
    // the promise it returns only settles when the SERVER answers, which
    // with no signal could be an hour from now. So we move on right away
    // and only listen for a refusal (.catch below). updateDoc can also
    // throw immediately for badly formed data; the try/catch turns that
    // into the same kind of refusal so both are handled in one place.
    let write;
    try {
      write = updateDoc(matchRef(matchId), update);
    } catch (err) {
      write = Promise.reject(err);
    }
    write.catch((err) => {
      // Only reachable while this page stays open. If the app was
      // closed before the server refused the write, the refusal is
      // noticed instead by reconcileMatch (the server shows a different
      // number than this phone entered) and shown as a warning.
      console.error(`Saving hole ${hole} of ${matchId} failed`, err);
      const reason = err && err.code === "permission-denied" ? "not allowed" : err && err.code;
      markRefused(roundId, matchId, hole, { a: aValue, b: bValue }, reason);
      renderMatches();
    });

    // Check the connection now, so a dead one shows up within seconds.
    checkConnectionNow();

    // Saved on the phone, so this hole's draft is no longer needed.
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
  document.getElementById("rd-admin-link").hidden = !isAdminUnlocked;
  renderMatches();
}

render();

onSnapshot(collection(db, "players"), (snapshot) => {
  players = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  playersLoaded = true;
  render();
});

// includeMetadataChanges: true also calls us when only the sync status
// changes (a waiting save is confirmed, or the connection drops), not
// just when the scores themselves change. Without it the "waiting"
// badges would never flip to "Sent".
onSnapshot(collection(db, "rounds", roundId, "matches"), { includeMetadataChanges: true }, (snapshot) => {
  matchesById = {};
  snapshot.forEach((d) => {
    matchesById[d.id] = d.data();
    pendingByMatch[d.id] = d.metadata.hasPendingWrites;

    // When the server has confirmed this match's current state (nothing
    // of ours still waiting, and not the phone's saved copy), compare
    // it with what this phone entered: mark matching holes "sent", and
    // turn any contradicted ones into warnings.
    if (!d.metadata.hasPendingWrites && !d.metadata.fromCache) {
      const newlySent = reconcileMatch(roundId, d.id, d.data().holes || {});
      if (newlySent.length > 0) {
        justSentUntil[d.id] = Date.now() + SENT_FLASH_MS;
        setTimeout(renderMatches, SENT_FLASH_MS + 100);
      }
    }
  });
  matchesLoaded = true;
  render();
});

// Redraw when the connection comes or goes, so "will send when you
// have signal" and "Sending…" swap without waiting for new data.
onConnectionChange(() => renderMatches());

renderUnlockBar(document.getElementById("unlock"), "score", () => {
  isScoreUnlocked = true;
  isAdminUnlocked = getUnlockLevel() === "admin";
  currentPlayerId = getUnlockPlayerId();
  render();
});
