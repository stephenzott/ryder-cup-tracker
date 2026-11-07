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
//      back 9 / overall) is computed live from those strokes via
//      scoring.js -- never stored separately. The detailed hole-by-hole
//      colors, points, and projections live on the Scoreboard page
//      instead -- this page is just for entering strokes.

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

// Which roster player picked themselves on the "Who are you?" screen
// -- null until someone's unlocked at the score level (or if they're
// on an admin-only browser that never picked a player). Used below to
// decide which specific matches THIS browser can enter scores for.
let currentPlayerId = null;

// Admin can edit any match; a plain score-level visitor can only edit
// a match they're actually playing in. The real gate is server-side
// in firestore.rules (this is only so the inputs/Save button look
// locked instead of silently failing on Save).
function canEditMatch(sideA, sideB) {
  if (!isScoreUnlocked) return false;
  if (isAdminUnlocked) return true;
  return sideA.includes(currentPlayerId) || sideB.includes(currentPlayerId);
}

// Live data, kept current by the two onSnapshot listeners below.
let players = [];
let matchesById = {};

// Which hole's entry panel each match is currently showing (1-18).
// Purely local UI state -- never written to Firestore -- so it
// survives re-renders but resets if you reload the page. Set lazily
// the first time a match is rendered (see currentHoleFor below).
const currentHoleByMatch = {};

function playerName(id) {
  const p = players.find((pl) => pl.id === id);
  return p ? p.name : "(unknown)";
}

function namesLinked(ids) {
  return ids.map((id) => playerLink(id, playerName(id))).join(" & ");
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

// Read-only strip showing where a player's strokes currently land --
// view only, not clickable, since strokes are always set via the shot
// count + "Apply," never picked hole-by-hole. Each box always shows
// that hole's stroke index, so you can see the difficulty ranking (and
// which holes a given count would hit) before even entering a number
// -- a "*" after the index flags a 2nd stroke there (only possible for
// shot counts above 18).
function strokesDisplayStrip(playerId, currentHoles) {
  let html = "";
  for (let h = 1; h <= 18; h++) {
    const count = currentHoles.filter((x) => x === h).length;
    const strokeIndex = course.holes[h - 1].strokeIndex;
    const label = count > 1 ? `${strokeIndex}*` : String(strokeIndex);
    html += `<div class="hole-toggle-btn${count > 0 ? " toggled" : ""}"
               data-player-id="${playerId}" data-hole="${h}" data-stroke-count="${count}">${label}</div>`;
    if (h === 9) html += `<div class="hole-gap"></div>`;
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
          <strong>${playerLink(pid, playerName(pid))}</strong>
          <input type="number" min="0" max="36" class="strokes-count-input" data-player-id="${pid}" value="${current.length}" />
          <label><input type="checkbox" class="avoid-closing-checkbox" data-player-id="${pid}" /> Avoid 9 &amp; 18</label>
          <button type="button" class="secondary apply-strokes" data-player-id="${pid}">Apply to hardest holes</button>
          <div class="hole-strip strokes-toggle-strip" data-player-id="${pid}">${strokesDisplayStrip(pid, current)}</div>
        </div>
      `;
    })
    .join("");

  return `
    <div class="strokes-given-row" data-strokes-match-id="${matchId}">
      <h4>${matchId.replace("match", "Match ")} — Strokes Given</h4>
      <p class="status-msg">Enter a shot count and click Apply -- strokes always go on the hardest holes in order, same as real handicap allocation.</p>
      ${playerRows}
      <button type="button" class="save-strokes" data-match-id="${matchId}">Save Strokes Given</button>
      <span class="status-msg" data-save-status="${matchId}-strokes"></span>
    </div>
  `;
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
        ${renderStrokesGivenRow(matchId, data)}
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

  // "Apply to hardest holes": fills the (read-only) strip from the
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
          holeBox.textContent = strokeCount > 1 ? `${strokeIndex}*` : String(strokeIndex);
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

// playerIndex is only used for best ball (round.holeShape ===
// "perPlayer"), where a side's value is an array of each player's own
// strokes instead of one shared number.
function holeInputValue(data, holeNum, side, playerIndex = null) {
  const hole = (data.holes || {})[String(holeNum)];
  if (!hole) return "";
  let v = hole[side];
  if (playerIndex != null) v = Array.isArray(v) ? v[playerIndex] : null;
  return v == null ? "" : v;
}

// How many strokes a player is given on a specific hole, so the entry
// panel can show "(+1)" next to their name -- scorers enter what was
// actually shot; the app applies the stroke when scoring, not here.
function strokesOnHoleFor(data, playerId, holeNum) {
  const given = data.strokesGiven && data.strokesGiven[playerId];
  if (!given) return 0;
  return given.filter((h) => h === holeNum).length;
}

function strokeBadge(count) {
  if (count === 0) return "";
  return ` <span class="status-msg">(+${count})</span>`;
}

// Builds the actual score inputs for the current hole. Rounds 1/2/4
// share one combined number per side ("USA"/"EUR"); round 3 (best
// ball) needs one input per player, labeled with their actual name,
// since each player plays their own ball.
function renderHoleInputs(matchId, data, currentHole, sideA, sideB, canEdit) {
  if (round.holeShape !== "perPlayer") {
    const aVal = holeInputValue(data, currentHole, "a");
    const bVal = holeInputValue(data, currentHole, "b");
    // Singles can still have strokes given (round 4) -- sideA[0]/sideB[0]
    // are the two players.
    const aBadge = strokeBadge(strokesOnHoleFor(data, sideA[0], currentHole));
    const bBadge = strokeBadge(strokesOnHoleFor(data, sideB[0], currentHole));
    return `
      <label>USA${aBadge}
        <input type="number" min="1" max="15" inputmode="numeric" class="hole-score-input"
               data-match-id="${matchId}" data-side="a" value="${aVal}" ${canEdit ? "" : "disabled"} />
      </label>
      <label>EUR${bBadge}
        <input type="number" min="1" max="15" inputmode="numeric" class="hole-score-input"
               data-match-id="${matchId}" data-side="b" value="${bVal}" ${canEdit ? "" : "disabled"} />
      </label>
    `;
  }

  const sideInputs = (side, ids) =>
    ids
      .map((pid, i) => {
        const val = holeInputValue(data, currentHole, side, i);
        const badge = strokeBadge(strokesOnHoleFor(data, pid, currentHole));
        return `
          <label>${playerLink(pid, playerName(pid))}${badge}
            <input type="number" min="1" max="15" inputmode="numeric" class="hole-score-input"
                   data-match-id="${matchId}" data-side="${side}" data-player-index="${i}"
                   value="${val}" ${canEdit ? "" : "disabled"} />
          </label>
        `;
      })
      .join("");

  return `
    <span class="hole-entry-side">USA: ${sideInputs("a", sideA)}</span>
    <span class="hole-entry-side">EUR: ${sideInputs("b", sideB)}</span>
  `;
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

  const aNames = namesLinked(sideA) || "TBD";
  const bNames = namesLinked(sideB) || "TBD";
  const scored = scoreMatch(data);

  const currentHole = currentHoleFor(matchId, data);
  const holeInfo = course.holes[currentHole - 1];
  const holeTip = HOLE_TIPS[roundId][currentHole - 1];
  const canEdit = canEditMatch(sideA, sideB);

  // Shown instead of a silent disabled state so it's obvious WHY entry
  // is locked here but not on another match -- only once someone's
  // actually unlocked (score or admin), never for a totally locked page.
  const lockedNote =
    isScoreUnlocked && !canEdit
      ? `<p class="status-msg">Only ${aNames} or ${bNames} can enter scores for this match.</p>`
      : "";

  // Lets the scorer jump straight to any hole instead of only stepping
  // one at a time with Prev/Next -- handy for going back to fix an
  // earlier hole without clicking through everything in between.
  const holeOptions = Array.from({ length: 18 }, (_, i) => i + 1)
    .map((h) => `<option value="${h}" ${h === currentHole ? "selected" : ""}>Hole ${h}</option>`)
    .join("");

  return `
    <div class="match-card">
      <h3>${matchId.replace("match", "Match ")}: USA (${aNames}) vs EUR (${bNames})</h3>
      <p>
        Front 9: <strong>${statusLabel(scored.front)}</strong> ·
        Back 9: <strong>${statusLabel(scored.back)}</strong> ·
        Overall: <strong>${statusLabel(scored.overall)}</strong>
      </p>
      ${lockedNote}

      <div class="hole-entry">
        <button type="button" class="secondary prev-hole" data-match-id="${matchId}" ${currentHole <= 1 ? "disabled" : ""}>◀ Prev</button>
        <select class="hole-select" data-match-id="${matchId}" aria-label="Jump to hole">${holeOptions}</select>
        <!-- "Hole N" links out to Kohler's yardage PDF for this hole,
             "(how to play)" links to their hole-description page.
             rel="noopener" is standard practice for target="_blank"
             links: without it, the page we open gets a handle back to
             this tab via window.opener and could redirect it -- a
             known phishing trick called "tabnabbing". -->
        <a href="${holeTip.yardageUrl}" target="_blank" rel="noopener">Hole ${currentHole}</a>
        (<a href="${holeTip.tipUrl}" target="_blank" rel="noopener">how to play</a>)
        — Par ${holeInfo.par}, Stroke Index ${holeInfo.strokeIndex}
        <button type="button" class="secondary next-hole" data-match-id="${matchId}" ${currentHole >= 18 ? "disabled" : ""}>Next ▶</button>
        <div>
          ${renderHoleInputs(matchId, data, currentHole, sideA, sideB, canEdit)}
          <button type="button" class="save-hole" data-match-id="${matchId}" ${canEdit ? "" : "disabled"}>Save</button>
          <span class="status-msg" data-save-status="${matchId}-hole"></span>
        </div>
      </div>
    </div>
  `;
}

function goToHole(matchId, hole) {
  currentHoleByMatch[matchId] = Math.min(18, Math.max(1, hole));
  renderMatches();
}

function renderMatches() {
  // If a score input is focused when this re-renders (e.g. because
  // someone on another phone just saved a different match), rebuild
  // the DOM but put the cursor back where it was instead of silently
  // dropping focus out from under whoever's mid-entry. Since the
  // current hole is stable across a re-render (it's in
  // currentHoleByMatch, not derived fresh each time), matching on
  // match+side is enough -- the hole number will be the same input.
  const active = document.activeElement;
  const activeSelector =
    active && active.matches(".hole-score-input")
      ? `.hole-score-input[data-match-id="${active.dataset.matchId}"][data-side="${active.dataset.side}"]`
      : null;

  document.getElementById("matches").innerHTML = matchIds().map(renderMatchCard).join("");

  document.querySelectorAll(".hole-select").forEach((select) => {
    select.addEventListener("change", () => {
      goToHole(select.dataset.matchId, parseInt(select.value, 10));
    });
  });

  document.querySelectorAll(".prev-hole").forEach((btn) => {
    btn.addEventListener("click", () => {
      goToHole(btn.dataset.matchId, currentHoleByMatch[btn.dataset.matchId] - 1);
    });
  });

  document.querySelectorAll(".next-hole").forEach((btn) => {
    btn.addEventListener("click", () => {
      goToHole(btn.dataset.matchId, currentHoleByMatch[btn.dataset.matchId] + 1);
    });
  });

  // Reads a side's inputs for the hole currently open on a match card.
  // Best ball (holeShape "perPlayer") has one input per player and
  // needs them back as an array in player order; everything else has
  // just the one shared input.
  function readSideValue(card, side) {
    const inputs = [...card.querySelectorAll(`.hole-score-input[data-side="${side}"]`)];
    const parsed = (input) => (input.value === "" ? null : parseInt(input.value, 10));
    if (round.holeShape !== "perPlayer") return parsed(inputs[0]);
    return inputs
      .sort((x, y) => x.dataset.playerIndex - y.dataset.playerIndex)
      .map(parsed);
  }

  function sideComplete(value) {
    return round.holeShape === "perPlayer" ? value.every((v) => v != null) : value != null;
  }

  document.querySelectorAll(".save-hole").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const matchId = btn.dataset.matchId;
      const card = btn.closest(".match-card");
      const hole = currentHoleByMatch[matchId];
      const aValue = readSideValue(card, "a");
      const bValue = readSideValue(card, "b");

      await updateDoc(matchRef(matchId), {
        [`holes.${hole}.a`]: aValue,
        [`holes.${hole}.b`]: bValue,
      });

      // Once both scores for this hole are in, move on to the next
      // one automatically -- matches walking down the fairway hole by
      // hole rather than making you click "Next" every time.
      if (sideComplete(aValue) && sideComplete(bValue) && hole < 18) {
        currentHoleByMatch[matchId] = hole + 1;
      }
      renderMatches();
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
  currentPlayerId = getUnlockPlayerId();
  render();
});
