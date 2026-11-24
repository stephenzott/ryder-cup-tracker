// The Admin page (admin.html): organizer tools behind the admin code.
//
// Tabs:
//   Players       add a player, change this year's team, remove a player
//   R1 ... R4     that round's match setup: who plays each match
//                 (pairings) and, for rounds 3-4, handicap strokes given
//   Log           the score-change log (Prompt 4): every change to a
//                 hole's score, newest first, read-only. Entries are
//                 written by the Cloud Function logScoreEdit; this page
//                 only reads them (and the rules let only the admin
//                 code read them at all)
//
// These tools used to live on the Roster page (players) and on each
// round page (match setup). The Firestore writes are exactly the same
// as there:
//   players        addDoc / updateDoc { team } / deleteDoc
//   pairings       setDoc(match, { sideA, sideB }, { merge: true })
//   strokes        setDoc(match, { strokesGiven }, { merge: true })
// and Firestore's rules still refuse them without the admin code.
//
// Two things work better than before:
//   1. "Saved." messages stay visible for a few seconds. (The old pages
//      redrew the instant a save landed, which wiped the message.)
//   2. A match's setup card is only rebuilt when THAT match's saved
//      pairings or strokes change, so score entries from other phones
//      don't reset dropdowns you're halfway through.

import { db } from "./firebase-init.js";
import { renderUnlockBar } from "./auth.js";
import {
  collection,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  setDoc,
  updateDoc,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { ROUNDS } from "./rounds-config.js";
import { COURSES } from "./courses-config.js";
import { playerLink } from "./player-stats.js";
import { avatarHtml, teamPillHtml, teamOptionsHtml, ROSTER_GROUPS, CURRENT_YEAR } from "./match-ui.js";

// ------------------------------------------------------------------
// State
// ------------------------------------------------------------------
let unlocked = false;
let players = [];                 // sorted by name
let playersLoaded = false;
const matchesByRound = {};        // roundId -> { matchId -> data }
for (const round of ROUNDS) matchesByRound[round.id] = {};

// Tabs: "players", then one per round. Remembered in the address
// (#round4) so a link like admin.html#round4 opens that round.
const TABS = [{ id: "players", day: "Players", sub: "Roster" }]
  .concat(ROUNDS.map((r, i) => ({ id: r.id, day: `R${i + 1}`, sub: r.format })))
  .concat([{ id: "log", day: "Log", sub: "Changes" }]);
function tabFromHash() {
  const id = location.hash.slice(1);
  return TABS.some((t) => t.id === id) ? id : null;
}
let selectedTab = tabFromHash() || "players";

// What's currently drawn, so redraws can skip anything unchanged:
// drawnTab / drawnPlayersKey say when the whole tab must be rebuilt;
// drawnSigs remembers each setup card's saved-data fingerprint (see
// setupSignature), keyed by the card's element id.
let drawnTab = null;
let drawnPlayersKey = null;
const drawnSigs = {};

const contentEl = document.getElementById("ad-content");

// ------------------------------------------------------------------
// Small helpers
// ------------------------------------------------------------------

// Basic escaping so a player name can never inject HTML (same helper
// as the roster page had).
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

function playerName(id) {
  const p = players.find((pl) => pl.id === id);
  return p ? p.name : "(unknown)";
}

function playersOnTeam(team) {
  return players.filter((p) => p.team === team);
}

function matchRef(roundId, matchId) {
  return doc(db, "rounds", roundId, "matches", matchId);
}

// Predictable match IDs (match1, match2, ...) for a round.
function matchIds(round) {
  return Array.from({ length: round.matchCount }, (_, i) => `match${i + 1}`);
}

// ------------------------------------------------------------------
// "Saved." messages that survive redraws. Each message is stored by a
// key (e.g. "round4/match2" or "player-abc") with the time it was set;
// after every redraw, messages younger than 5 seconds are painted back
// into whatever element now carries that key.
// ------------------------------------------------------------------
const MESSAGE_MS = 5000;
const messages = {};

function setStatus(key, text, kind = "ok") {
  messages[key] = { text, kind, at: Date.now() };
  paintStatuses();
  setTimeout(paintStatuses, MESSAGE_MS + 50);   // clear it once it's old
}

function paintStatuses() {
  contentEl.querySelectorAll("[data-save-status]").forEach((el) => {
    const m = messages[el.dataset.saveStatus];
    const fresh = m && Date.now() - m.at < MESSAGE_MS;
    el.textContent = fresh ? m.text : "";
    el.className = fresh ? `status-msg ${m.kind}` : "status-msg";
  });
}

// ------------------------------------------------------------------
// Players tab
// ------------------------------------------------------------------
function playerRowHtml(p) {
  const name = escapeHtml(p.name);
  return `
    <li class="roster-row">
      ${avatarHtml(p.name, p.team)}
      <span class="roster-name">${playerLink(p.id, name)}</span>
      <span class="roster-hcp"><span class="roster-hcp-label">HCP</span> ${p.handicapIndex ?? "—"}</span>
      <div class="roster-row-admin">
        <select data-id="${p.id}" class="team-select" aria-label="${CURRENT_YEAR} team for ${name}">
          ${teamOptionsHtml(p.team)}
        </select>
        <button type="button" class="secondary remove-player" data-id="${p.id}">Remove</button>
      </div>
      <span class="status-msg roster-row-status" data-save-status="player-${p.id}"></span>
    </li>
  `;
}

function playersTabHtml() {
  // Same groups as the Roster page (ROSTER_GROUPS in match-ui.js):
  // USA, EU, Confirmed (no team yet), Unconfirmed.
  const groups = ROSTER_GROUPS.map((g) => ({ ...g, members: players.filter(g.match) }));
  const groupsHtml = groups
    .filter((g) => g.members.length || g.alwaysShow)
    .map(
      (g) => `
        <section class="roster-group">
          <h2 class="roster-group-title">
            ${teamPillHtml(g.team)}
            <span class="roster-count">${g.members.length} player${g.members.length === 1 ? "" : "s"}</span>
          </h2>
          <ul class="roster-list">
            ${g.members.map(playerRowHtml).join("") || `<li class="roster-row roster-row-empty">No one yet.</li>`}
          </ul>
        </section>
      `
    )
    .join("");

  return `
    <div class="roster-add-card">
      <h2 class="rd-setup-subtitle">Add player</h2>
      <form id="add-player-form" class="roster-form">
        <label class="roster-field">Name
          <input type="text" id="new-player-name" placeholder="Player name" required />
        </label>
        <label class="roster-field">Handicap index
          <input type="number" id="new-player-handicap" placeholder="e.g. 12.4" step="0.1" />
        </label>
        <label class="roster-field">Team (${CURRENT_YEAR})
          <select id="new-player-team">
            ${teamOptionsHtml(null)}
          </select>
        </label>
        <div class="rd-actions">
          <button type="submit">Add player</button>
          <span class="status-msg" data-save-status="add-player"></span>
        </div>
      </form>
    </div>
    <p class="rd-help">Teams are redrawn every year; these are ${CURRENT_YEAR}'s. A team change saves as soon as you pick it.</p>
    ${groupsHtml}
  `;
}

// ------------------------------------------------------------------
// Round tabs: match setup (pairings + strokes given)
// ------------------------------------------------------------------

function playerSelect(name, selectedId, team, label) {
  const options = playersOnTeam(team)
    .map((p) => `<option value="${p.id}" ${p.id === selectedId ? "selected" : ""}>${escapeHtml(p.name)}</option>`)
    .join("");
  return `<select name="${name}" aria-label="${label}"><option value="">—</option>${options}</select>`;
}

// The N holes a player gets strokes on: always the hardest-by-stroke-
// index holes, in order -- that's how handicap allocation actually
// works (never picked hole-by-hole). `avoidHoles` (closing holes 9/18,
// typically) gets skipped in favor of the next hardest hole. Wraps
// past 18 for counts above that (a 2nd stroke on the hardest holes).
function hardestHoles(course, count, avoidHoles = []) {
  const sorted = [...course.holes]
    .filter((h) => !avoidHoles.includes(h.hole))
    .sort((a, b) => a.strokeIndex - b.strokeIndex);
  return Array.from({ length: count }, (_, i) => sorted[i % sorted.length].hole);
}

// Read-only grid showing where a player's strokes land: each box has a
// small "Hole 7" label over that hole's stroke index ("*" = a 2nd
// stroke there). Navy boxes get a stroke. Set via shot count + Apply.
function strokesDisplayStrip(course, playerId, currentHoles) {
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

function strokesRowHtml(round, matchId, data) {
  if (!round.strokesGivenEligible) return "";
  const sideA = data.sideA || [];
  const sideB = data.sideB || [];
  if (sideA.length === 0 || sideB.length === 0) {
    return `<p class="rd-help">Save a pairing first, then set strokes here.</p>`;
  }
  const course = COURSES[round.id];
  const key = `${round.id}/${matchId}`;
  const rows = [...sideA, ...sideB]
    .map((pid) => {
      const current = (data.strokesGiven && data.strokesGiven[pid]) || [];
      return `
        <div class="strokes-player">
          <div class="strokes-player-name">${playerLink(pid, escapeHtml(playerName(pid)))}</div>
          <div class="strokes-player-controls">
            <label class="strokes-count-label">Shots
              <input type="number" min="0" max="36" class="strokes-count-input" data-player-id="${pid}" value="${current.length}" />
            </label>
            <label class="strokes-avoid-label"><input type="checkbox" class="avoid-closing-checkbox" data-player-id="${pid}" /> Avoid 9 &amp; 18</label>
            <button type="button" class="secondary apply-strokes" data-player-id="${pid}">Apply to hardest holes</button>
          </div>
          <div class="strokes-toggle-strip" data-player-id="${pid}" aria-label="Stroke index per hole; highlighted holes get a stroke">${strokesDisplayStrip(course, pid, current)}</div>
        </div>
      `;
    })
    .join("");
  return `
    <div class="strokes-given-row" data-strokes-key="${key}">
      <h4 class="rd-setup-subtitle">Strokes given</h4>
      <p class="rd-help">Enter a shot count and tap Apply. Strokes always go on the hardest holes in order, same as real handicap allocation. The big number in each box is that hole's stroke index.</p>
      ${rows}
      <div class="rd-actions">
        <button type="button" class="save-strokes" data-key="${key}">Save strokes given</button>
        <span class="status-msg" data-save-status="${key}-strokes"></span>
      </div>
    </div>
  `;
}

// A fingerprint of the saved data a setup card shows: if this string
// is unchanged, the card doesn't need rebuilding.
function setupSignature(data) {
  return JSON.stringify({ a: data.sideA || [], b: data.sideB || [], s: data.strokesGiven || {} });
}

function setupCardHtml(round, matchId) {
  const data = matchesByRound[round.id][matchId] || {};
  const sideA = data.sideA || [];
  const sideB = data.sideB || [];
  const key = `${round.id}/${matchId}`;
  const label = matchId.replace("match", "Match ");
  const aSelects = Array.from({ length: round.playersPerSide }, (_, i) =>
    playerSelect(`${matchId}-a-${i}`, sideA[i], "A", `${label}, USA player ${i + 1}`)
  ).join("");
  const bSelects = Array.from({ length: round.playersPerSide }, (_, i) =>
    playerSelect(`${matchId}-b-${i}`, sideB[i], "B", `${label}, EU player ${i + 1}`)
  ).join("");
  // Remember what this card shows, so later redraws can skip it if
  // its saved data hasn't changed.
  drawnSigs[`setup-${round.id}-${matchId}`] = setupSignature(data);
  return `
    <div class="rd-setup-card" id="setup-${round.id}-${matchId}">
      <div class="rd-setup-row" data-setup-key="${key}">
        <h3 class="rd-setup-subtitle">${label}</h3>
        <div class="rd-setup-sides">
          <div class="rd-setup-side rd-setup-usa"><span class="rd-setup-team">USA</span>${aSelects}</div>
          <div class="rd-setup-side rd-setup-eu"><span class="rd-setup-team">EU</span>${bSelects}</div>
        </div>
        <div class="rd-actions">
          <button type="button" class="save-pairing" data-key="${key}">Save pairing</button>
          <span class="status-msg" data-save-status="${key}"></span>
        </div>
      </div>
      ${strokesRowHtml(round, matchId, data)}
    </div>
  `;
}

function roundTabHtml(round) {
  const course = COURSES[round.id];
  const index = ROUNDS.indexOf(round) + 1;
  const teamWarning =
    playersOnTeam("A").length === 0 || playersOnTeam("B").length === 0
      ? `<p class="status-msg error">No players on a team yet. Assign teams on the Players tab first; the dropdowns only list players on each team.</p>`
      : "";
  return `
    <div class="ad-round-head">
      <h2 class="section-title">Round ${index} · ${round.day} · ${round.format}</h2>
      <p class="rd-help">${course.name} · ${round.matchCount} matches. Saving a pairing never touches scores already entered. <a href="${round.id}.html">Open the round page</a></p>
    </div>
    ${teamWarning}
    ${matchIds(round).map((id) => setupCardHtml(round, id)).join("")}
  `;
}

// ------------------------------------------------------------------
// Log tab: the score-change log (Prompt 4)
// ------------------------------------------------------------------
// The entries live in the scoreEdits collection, one per changed hole
// (see functions/index.js, logScoreEdit). This tab keeps ONE live
// listener on the whole collection, newest first, while it's open, and
// filters by round and match on the page itself (the whole trip is a
// few hundred entries, so loading them all is cheap and simple).

let logEntries = [];
let logLoaded = false;
let logError = null;
let stopLog = null;          // the listener's "unsubscribe" function
let logFailed = false;       // true after an error, until the next deliberate retry
let logRound = "all";        // filter: "all" or a round id
let logMatch = "all";        // filter: "all" or a match id
let drawnLogSig = null;      // what's on screen, to skip identical redraws

function startLogListener() {
  // After an error we don't retry on every redraw (that could become a
  // loop of refused reads); only when the Log tab is opened again or
  // the admin code is re-entered (see retryLog).
  if (stopLog || logFailed) return;
  stopLog = onSnapshot(
    query(collection(db, "scoreEdits"), orderBy("syncedAt", "desc")),
    (snapshot) => {
      logEntries = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      logLoaded = true;
      logError = null;
      render();
    },
    (error) => {
      // Most likely the admin unlock is missing or stale on the server.
      // Firestore has already stopped this listener after an error.
      logError = error;
      logFailed = true;
      stopLog = null;
      render();
    }
  );
}

// A deliberate retry: forget the last error so the next render starts
// the listener again.
function retryLog() {
  if (!logFailed) return;
  logFailed = false;
  logError = null;
  drawnLogSig = null;
}

function stopLogListener() {
  if (!stopLog) return;
  stopLog();
  stopLog = null;
}

// "10:52 AM", or "Thu 10:52 AM" if not today. Firestore timestamps
// arrive as Timestamp objects; toDate() turns them into a JS Date.
function logTime(ts) {
  if (!ts || typeof ts.toDate !== "function") return "—";
  const d = ts.toDate();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

// One side's value: "5", best ball "4/5", empty "–".
function logSide(value) {
  if (Array.isArray(value)) return value.map((v) => (v == null ? "–" : v)).join("/");
  return value == null ? "–" : String(value);
}

// A hole's scores, or "—" if it had none.
function logScores(scores) {
  return scores ? `USA ${logSide(scores.a)} – EU ${logSide(scores.b)}` : "—";
}

// "R1 · Match 2 · Hole 7"
function logWhere(entry) {
  const index = ROUNDS.findIndex((r) => r.id === entry.roundId) + 1;
  return `R${index || "?"} · ${String(entry.matchId || "").replace("match", "Match ")} · Hole ${entry.hole}`;
}

function filteredLogEntries() {
  return logEntries.filter(
    (e) => (logRound === "all" || e.roundId === logRound) && (logMatch === "all" || e.matchId === logMatch)
  );
}

function logRowHtml(entry) {
  // Show the tap time only when it differs from the sync time by a
  // minute or more (i.e. the score was saved with no signal).
  let when = "";
  if (entry.tappedAt && entry.syncedAt && typeof entry.tappedAt.toMillis === "function") {
    const gap = Math.abs(entry.syncedAt.toMillis() - entry.tappedAt.toMillis());
    if (gap >= 60 * 1000) when = ` · tapped ${logTime(entry.tappedAt)} (synced ${logTime(entry.syncedAt)})`;
  }
  return `
    <li class="lg-row${entry.changed ? " is-changed" : ""}">
      <div class="lg-top">
        <span class="lg-time">${logTime(entry.syncedAt)}</span>
        <span class="lg-where">${escapeHtml(logWhere(entry))}</span>
        ${entry.changed ? '<span class="lg-tag">Changed</span>' : ""}
      </div>
      <div class="lg-scores">${logScores(entry.before)} <span aria-hidden="true">→</span><span class="visually-hidden">changed to</span> ${logScores(entry.after)}</div>
      <div class="lg-who">${escapeHtml(entry.whoName || "Unknown")}${entry.whoSource === "phone" ? " (as reported by the phone)" : ""}${when}</div>
    </li>
  `;
}

function renderLogTab() {
  const entries = filteredLogEntries();
  // Redraw only if something visible changed (new entries or filters),
  // so a score saved elsewhere doesn't reset an open dropdown.
  const sig = JSON.stringify([logLoaded, logError && logError.code, logRound, logMatch, entries.map((e) => e.id)]);
  if (drawnTab === "log" && sig === drawnLogSig) return;
  drawnLogSig = sig;

  const roundOptions =
    `<option value="all">All rounds</option>` +
    ROUNDS.map((r, i) => `<option value="${r.id}" ${r.id === logRound ? "selected" : ""}>R${i + 1} · ${r.format}</option>`).join("");
  const round = ROUNDS.find((r) => r.id === logRound);
  const matchOptions =
    `<option value="all">All matches</option>` +
    (round ? matchIds(round) : [])
      .map((id) => `<option value="${id}" ${id === logMatch ? "selected" : ""}>${id.replace("match", "Match ")}</option>`)
      .join("");

  // Holes edited after their first entry, once each, oldest first.
  const changedHoles = [...new Set(entries.filter((e) => e.changed).reverse().map(logWhere))];
  const summary = changedHoles.length
    ? `<p class="lg-summary">⚠ Changed after first entry: ${changedHoles.map((w) => escapeHtml(w.replace(/ · Match /, " M").replace(/ · Hole /, " h"))).join(", ")}</p>`
    : "";

  let body;
  if (logError) {
    body = `<p class="status-msg error">Couldn't load the log (${escapeHtml(logError.code || "error")}). Try "Use a different code" and enter the admin code again.</p>`;
  } else if (!logLoaded) {
    body = `<div class="skeleton-card"><div class="skeleton skeleton-line skeleton-title"></div><div class="skeleton skeleton-block"></div></div>`;
  } else if (entries.length === 0) {
    body = `<p class="st-note">No score changes logged${logRound === "all" ? " yet" : " for this selection"}.</p>`;
  } else {
    body = `${summary}<p class="st-note">${entries.length} ${entries.length === 1 ? "entry" : "entries"}, newest first.</p><ol class="lg-list">${entries.map(logRowHtml).join("")}</ol>`;
  }

  contentEl.innerHTML = `
    <div class="ad-round-head">
      <h2 class="section-title">Score-change log</h2>
      <p class="rd-help">Every change to a hole's score: who, when, and from what to what. Read-only.</p>
    </div>
    <div class="lg-filters">
      <label>Round <select id="log-round">${roundOptions}</select></label>
      <label>Match <select id="log-match" ${round ? "" : "disabled"}>${matchOptions}</select></label>
    </div>
    ${body}
  `;
}

// ------------------------------------------------------------------
// Drawing
// ------------------------------------------------------------------
function renderTabs() {
  const tabsEl = document.getElementById("ad-tabs");
  const focused = document.activeElement?.closest?.(".sb-tab")?.dataset.tab;
  tabsEl.innerHTML = TABS.map(
    (t) => `<button type="button" class="sb-tab${t.id === selectedTab ? " is-selected" : ""}"
              data-tab="${t.id}" aria-pressed="${t.id === selectedTab}">
              <span class="sb-tab-day">${t.day}</span><span class="sb-tab-format">${t.sub}</span>
            </button>`
  ).join("");
  if (focused) tabsEl.querySelector(`[data-tab="${focused}"]`)?.focus();
}

// Redraw the content. A full rebuild happens only when the tab changes
// or the roster changes (names/teams feed every dropdown); otherwise
// each round setup card is rebuilt only if its saved data changed, and
// the Players tab is left alone unless the roster changed.
function render() {
  renderTabs();
  if (!unlocked) return;

  const playersKey = JSON.stringify(players.map((p) => [p.id, p.name, p.team, p.handicapIndex]));
  const fullRebuild = drawnTab !== selectedTab || drawnPlayersKey !== playersKey;

  if (!playersLoaded) {
    contentEl.innerHTML = `<div class="skeleton-card"><div class="skeleton skeleton-line skeleton-title"></div><div class="skeleton skeleton-block"></div></div>`;
    return;
  }

  // The Log tab is drawn by its own code (see "Log tab" below) and only
  // listens to the log while it's open.
  if (selectedTab === "log") {
    startLogListener();
    renderLogTab();
    drawnTab = "log";
    return;
  }
  stopLogListener();

  if (fullRebuild) {
    // Keep the add-player form's typed values if the roster redraws
    // underneath it (e.g. after adding someone, or another admin edit).
    const draft = ["new-player-name", "new-player-handicap", "new-player-team"].map(
      (id) => document.getElementById(id)?.value ?? ""
    );
    const savedScrollY = window.scrollY;
    const round = ROUNDS.find((r) => r.id === selectedTab);
    contentEl.innerHTML = round ? roundTabHtml(round) : playersTabHtml();
    if (!round && drawnTab === "players") {
      ["new-player-name", "new-player-handicap", "new-player-team"].forEach((id, i) => {
        const el = document.getElementById(id);
        if (el) el.value = draft[i];
      });
    }
    if (drawnTab === selectedTab) window.scrollTo(0, savedScrollY);
    drawnTab = selectedTab;
    drawnPlayersKey = playersKey;
  } else {
    const round = ROUNDS.find((r) => r.id === selectedTab);
    if (round) {
      for (const matchId of matchIds(round)) {
        const cardId = `setup-${round.id}-${matchId}`;
        const card = document.getElementById(cardId);
        const sig = setupSignature(matchesByRound[round.id][matchId] || {});
        if (card && drawnSigs[cardId] !== sig) card.outerHTML = setupCardHtml(round, matchId);
      }
    }
  }
  paintStatuses();
}

// ------------------------------------------------------------------
// Events. One listener on the content area handles every button and
// field inside it, even ones created by later redraws ("event
// delegation").
// ------------------------------------------------------------------
document.getElementById("ad-tabs").addEventListener("click", (event) => {
  const button = event.target.closest(".sb-tab");
  if (!button) return;
  selectedTab = button.dataset.tab;
  history.replaceState(null, "", `#${selectedTab}`);   // no extra Back-button step
  if (selectedTab === "log") retryLog();
  render();
});

window.addEventListener("hashchange", () => {
  const id = tabFromHash();
  if (id && id !== selectedTab) {
    selectedTab = id;
    render();
  }
});

contentEl.addEventListener("click", async (event) => {
  const button = event.target.closest("button");
  if (!button) return;

  // Save pairing: same write as the old round page.
  if (button.classList.contains("save-pairing")) {
    const [roundId, matchId] = button.dataset.key.split("/");
    const round = ROUNDS.find((r) => r.id === roundId);
    const row = button.closest(".rd-setup-row");
    const sideA = Array.from({ length: round.playersPerSide }, (_, i) =>
      row.querySelector(`[name="${matchId}-a-${i}"]`).value
    ).filter(Boolean);
    const sideB = Array.from({ length: round.playersPerSide }, (_, i) =>
      row.querySelector(`[name="${matchId}-b-${i}"]`).value
    ).filter(Boolean);
    try {
      // merge: true means this only ever touches sideA/sideB -- any
      // `holes` data already saved for this match is left alone.
      await setDoc(matchRef(roundId, matchId), { sideA, sideB }, { merge: true });
      setStatus(button.dataset.key, "Saved.");
    } catch {
      setStatus(button.dataset.key, "Not saved: check the admin code.", "error");
    }
    return;
  }

  // Apply to hardest holes: fills the read-only grid from the shot count
  // and the "avoid 9 & 18" box. Doesn't save by itself.
  if (button.classList.contains("apply-strokes")) {
    const playerId = button.dataset.playerId;
    const block = button.closest(".strokes-player");
    const course = COURSES[button.closest("[data-strokes-key]").dataset.strokesKey.split("/")[0]];
    const count = parseInt(block.querySelector(".strokes-count-input").value || "0", 10);
    const avoidClosing = block.querySelector(".avoid-closing-checkbox").checked;
    const holes = hardestHoles(course, count, avoidClosing ? [9, 18] : []);
    block.querySelectorAll(`.strokes-toggle-strip[data-player-id="${playerId}"] .hole-toggle-btn`).forEach((holeBox) => {
      const h = parseInt(holeBox.dataset.hole, 10);
      const strokeCount = holes.filter((x) => x === h).length;
      const strokeIndex = course.holes[h - 1].strokeIndex;
      holeBox.dataset.strokeCount = strokeCount;
      // Only the stroke-index part changes; the "Hole N" label stays.
      holeBox.querySelector(".ht-si").textContent = strokeCount > 1 ? `${strokeIndex}*` : String(strokeIndex);
      holeBox.classList.toggle("toggled", strokeCount > 0);
    });
    return;
  }

  // Save strokes given: same write as the old round page.
  if (button.classList.contains("save-strokes")) {
    const key = button.dataset.key;
    const [roundId, matchId] = key.split("/");
    const row = button.closest("[data-strokes-key]");
    const strokesGiven = {};
    row.querySelectorAll(".strokes-player").forEach((playerBlock) => {
      const strip = playerBlock.querySelector(".strokes-toggle-strip");
      const holes = [];
      strip.querySelectorAll(".hole-toggle-btn").forEach((holeBtn) => {
        const count = parseInt(holeBtn.dataset.strokeCount, 10);
        for (let i = 0; i < count; i++) holes.push(parseInt(holeBtn.dataset.hole, 10));
      });
      strokesGiven[strip.dataset.playerId] = holes;
    });
    try {
      await setDoc(matchRef(roundId, matchId), { strokesGiven }, { merge: true });
      setStatus(`${key}-strokes`, "Saved.");
    } catch {
      setStatus(`${key}-strokes`, "Not saved: check the admin code.", "error");
    }
    return;
  }

  // Remove a player (with the browser's own "are you sure?" box).
  if (button.classList.contains("remove-player")) {
    const playerId = button.dataset.id;
    const player = players.find((p) => p.id === playerId);
    if (confirm(`Remove ${player?.name ?? "this player"}?`)) {
      await deleteDoc(doc(db, "players", playerId));
    }
  }
});

// Team change saves immediately (same write as the old roster page).
// Log tab filters. Choosing a round resets the match filter, since
// match numbers belong to a round.
contentEl.addEventListener("change", (event) => {
  if (event.target.id === "log-round") {
    logRound = event.target.value;
    logMatch = "all";
    renderLogTab();
  } else if (event.target.id === "log-match") {
    logMatch = event.target.value;
    renderLogTab();
  }
});

contentEl.addEventListener("change", async (event) => {
  const select = event.target;
  if (!select.matches(".team-select")) return;
  const playerId = select.dataset.id;
  const team = select.value || null;
  try {
    await updateDoc(doc(db, "players", playerId), { team });
    setStatus(`player-${playerId}`, "Team saved.");
  } catch {
    setStatus(`player-${playerId}`, "Not saved: check the admin code.", "error");
  }
});

// Add player (same write as the old roster page).
contentEl.addEventListener("submit", async (event) => {
  if (event.target.id !== "add-player-form") return;
  event.preventDefault();
  const nameInput = document.getElementById("new-player-name");
  const handicapInput = document.getElementById("new-player-handicap");
  const teamInput = document.getElementById("new-player-team");
  const name = nameInput.value.trim();
  if (!name) return;
  setStatus("add-player", "Adding…", "");
  try {
    await addDoc(collection(db, "players"), {
      name,
      handicapIndex: handicapInput.value ? parseFloat(handicapInput.value) : null,
      team: teamInput.value || null,
    });
    nameInput.value = "";
    handicapInput.value = "";
    teamInput.value = "";
    setStatus("add-player", `Added ${name}.`);
  } catch {
    setStatus("add-player", "Failed: are you unlocked with the admin code?", "error");
  }
});

// ------------------------------------------------------------------
// Start: draw the tabs, subscribe to the data (public reads), and show
// the tools once the admin code is accepted.
// ------------------------------------------------------------------
render();

onSnapshot(query(collection(db, "players"), orderBy("name")), (snapshot) => {
  players = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  playersLoaded = true;
  render();
});

for (const round of ROUNDS) {
  onSnapshot(collection(db, "rounds", round.id, "matches"), (snapshot) => {
    const current = {};
    snapshot.forEach((d) => {
      current[d.id] = d.data();
    });
    matchesByRound[round.id] = current;
    render();
  });
}

renderUnlockBar(document.getElementById("unlock"), "admin", () => {
  unlocked = true;
  retryLog();   // a fresh admin unlock may fix an earlier "permission denied"
  document.getElementById("ad-locked-note").hidden = true;
  contentEl.hidden = false;
  render();
});
