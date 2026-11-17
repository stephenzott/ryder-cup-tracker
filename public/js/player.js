// Individual player card: ?id=<playerId> in the URL. Pulls the same
// live match data every other page uses and runs it through
// player-stats.js's shared computation, so these numbers always match
// what's shown on the stats page.
//
// Layout: a navy header (initials, name, handicap, and a
// "2027 · Team USA" pill -- teams are redrawn every year, so the team
// is shown as this year's, not as who the player is), stat tiles, then
// one card per match this year with the shared match pieces (status,
// sides, front/back/overall, hole grid).

import { db } from "./firebase-init.js";
import {
  collection,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { ROUNDS } from "./rounds-config.js";
import { computePlayerStats, playerLink, formatToPar } from "./player-stats.js";
import { scoreMatch } from "./scoring.js";
import {
  formatPoints,
  statusPill,
  sidesHtml,
  segmentChipsHtml,
  holeGridHtml,
  avatarHtml,
  teamPillHtml,
  CURRENT_YEAR,
} from "./match-ui.js";

const app = document.getElementById("app");
const playerId = new URLSearchParams(location.search).get("id");

// "Not found" page, used for a missing ?id= and for an id that isn't on
// the roster.
function notFound(message) {
  app.innerHTML = `
    <header class="page-header">
      <p class="page-eyebrow">Player</p>
      <h1 class="page-title">Player not found</h1>
      <p class="page-sub">${message}</p>
    </header>
    <p class="st-note"><a href="roster.html">Go to the roster</a> to pick a player.</p>
  `;
}

let players = [];
let playersLoaded = false;
const matchesByRound = {};
for (const round of ROUNDS) {
  matchesByRound[round.id] = {};
}
const roundsLoaded = new Set();

function playerName(id) {
  const p = players.find((pl) => pl.id === id);
  return p ? p.name : "(unknown)";
}

function namesLinked(ids) {
  return ids.map((id) => playerLink(id, playerName(id))).join(" & ") || "—";
}

const people = (ids) => ids.map((id) => ({ id, name: playerName(id) }));

// Grey placeholder version of the page, shown until the data arrives.
const SKELETON_PAGE = `
  <header class="page-header" aria-hidden="true">
    <div class="player-hero"><span class="skeleton skeleton-avatar-lg"></span>
      <div class="player-hero-text"><div class="skeleton skeleton-line skeleton-title"></div><div class="skeleton skeleton-line skeleton-short"></div></div>
    </div>
  </header>
  <div class="stat-tiles" aria-hidden="true">${'<div class="stat-tile"><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line skeleton-short"></div></div>'.repeat(5)}</div>
`;

// One stat tile: a small label over a big number, plus an optional note.
function tileHtml(label, value, note = "") {
  return `
    <div class="stat-tile">
      <div class="stat-tile-label">${label}</div>
      <div class="stat-tile-value">${value}</div>
      ${note ? `<div class="stat-tile-note">${note}</div>` : ""}
    </div>
  `;
}

// One card per match the player was in this year.
function roundCardHtml(d) {
  const round = ROUNDS.find((r) => r.id === d.roundId);
  const match = matchesByRound[d.roundId][d.matchId] || {};
  const scoreLine =
    d.total == null
      ? "Round in progress"
      : `Round ${d.total} (${formatToPar(d.toPar)}) · ${d.birdies} birdie${d.birdies === 1 ? "" : "s"}`;
  return `
    <article class="sb-card">
      <div class="sb-card-top">
        <h3 class="sb-match-no"><a href="${d.roundId}.html">${d.roundLabel}</a></h3>
        ${statusPill(d.overall)}
      </div>
      <p class="player-match-meta">
        ${round.day} · ${round.format} ·
        ${d.partners.length ? `with ${namesLinked(d.partners)}, ` : ""}vs ${namesLinked(d.opponents)}
      </p>
      ${sidesHtml(people(match.sideA || []), people(match.sideB || []), scoreMatch(match).points)}
      ${segmentChipsHtml(d)}
      ${holeGridHtml(match)}
      <div class="player-match-foot">
        <span>Points earned <strong>${formatPoints(d.points)}</strong></span>
        <span>${scoreLine}</span>
      </div>
    </article>
  `;
}

// (Both sides' points in the card come straight from scoreMatch, the
// same function computePlayerStats uses, so they always agree.)

function render() {
  if (!playersLoaded || roundsLoaded.size < ROUNDS.length) {
    app.innerHTML = SKELETON_PAGE;
    return;
  }
  const player = players.find((p) => p.id === playerId);
  if (!player) {
    notFound("There's no player with this link on the roster.");
    return;
  }

  const stats = computePlayerStats(playerId, matchesByRound);
  const { record } = stats;

  const roundsHtml = stats.roundDetails.length
    ? stats.roundDetails.map(roundCardHtml).join("")
    : `<p class="sb-empty">Hasn't played a match yet this year.</p>`;

  app.innerHTML = `
    <header class="page-header">
      <div class="player-hero">
        ${avatarHtml(player.name, null, "lg")}
        <div class="player-hero-text">
          <h1 class="page-title">${player.name}</h1>
          <p class="page-sub">Handicap index ${player.handicapIndex ?? "—"}</p>
        </div>
      </div>
      <div class="player-hero-pill">${teamPillHtml(player.team)}</div>
    </header>

    <section class="stat-tiles" aria-label="${CURRENT_YEAR} stats">
      ${tileHtml("Points", formatPoints(stats.points))}
      ${tileHtml("Record", `${record.wins}-${record.losses}-${record.halves}`, "W-L-H, per nine &amp; overall")}
      ${tileHtml("Avg score", stats.avgScore == null ? "—" : stats.avgScore.toFixed(1))}
      ${tileHtml("Best round", stats.bestRound == null ? "—" : formatToPar(stats.bestRound))}
      ${tileHtml("Birdies", stats.birdies, "or better")}
    </section>

    <h2 class="section-title">${CURRENT_YEAR} matches</h2>
    ${roundsHtml}
  `;
}

if (!playerId) {
  notFound("This page needs a player link (it opens from the roster or stats pages).");
} else {
  render();

  onSnapshot(collection(db, "players"), (snapshot) => {
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
      roundsLoaded.add(round.id);
      render();
    });
  }
}
