// DEMO ONLY. Loads one of the real pages (Home, Scoreboard or a Round
// page) inside demo.html, running that page's real script, and adds
// the yellow demo bar.
//
// Which page: demo.html?page=index | scoreboard | admin | round1 ... round4.
// Which scenario: demo.html?scenario=play | setup (see state.js).
// With no ?page=, the play scenario opens the round that's "in
// progress" (the "standing on the tee" view), and the setup scenario
// opens the Admin page on Round 4.
//
// How it shows a real page without copying it: fetch that page's HTML
// file, move its body content into this page, then load its script.
// Because demo.html has an import map (see its <head>), that script's
// Firebase imports come from /demo/ fakes, so it reads the made-up
// data instead of the live database.

import { ROUNDS } from "/js/rounds-config.js";
import {
  ready,
  getState,
  restartWithLiveRound,
  restartWithScenario,
  currentScenario,
  SCENARIOS,
  setYou,
  resetAll,
  isLivePaused,
  setLivePaused,
} from "./state.js";
import { startLiveSimulation } from "./fake-firestore.js";

// How often another group finishes a hole in the "live" demo.
const LIVE_SECONDS = 20;

const DEMO_PAGES = ["index", "scoreboard", "admin", ...ROUNDS.map((r) => r.id)];

// Links to these real pages are kept inside the demo (rewritten to
// demo.html?page=...). Anything else (Roster, Stats, a player card,
// Schedule) opens the real page, which shows real data.
function demoLinkFor(href) {
  const match = /^(?:\/)?(index|scoreboard|admin|round[1-4])\.html(#.*)?$/.exec(href || "");
  return match ? `demo.html?page=${match[1]}${match[2] || ""}` : null;
}

// One click listener for the whole page catches taps on links,
// including the tab bar's, before the browser follows them.
document.addEventListener(
  "click",
  (event) => {
    const link = event.target.closest("a[href]");
    if (!link) return;
    const demoHref = demoLinkFor(link.getAttribute("href"));
    if (demoHref) {
      event.preventDefault();
      location.href = demoHref;
    }
  },
  true   // "capture": run before the page's own click handlers
);

// The yellow bar: what's going on, plus pickers for which round is in
// progress and which player "you" are.
function demoBarHtml(state) {
  const scenario = currentScenario();
  const scenarioOptions = Object.entries(SCENARIOS)
    .map(([id, s]) => `<option value="${id}" ${id === scenario ? "selected" : ""}>${s.label}</option>`)
    .join("");
  const roundOptions = ROUNDS.map(
    (r) => `<option value="${r.id}" ${r.id === state.liveRoundId ? "selected" : ""}>${r.label} (${r.day})</option>`
  ).join("");
  const byTeam = (team, label) =>
    `<optgroup label="${label}">${state.players
      .filter((p) => p.team === team)
      .map((p) => `<option value="${p.id}" ${p.id === state.you ? "selected" : ""}>${p.name}</option>`)
      .join("")}</optgroup>`;
  return `
    <details class="demo-bar">
      <summary><span class="demo-tag">DEMO</span> Made-up data · not saved</summary>
      <div class="demo-controls">
        <label>Scenario
          <select id="demo-scenario">${scenarioOptions}</select>
        </label>
        <!-- The setup scenario is always Round 4 (singles), so the round
             picker only shows in the "play" scenario. -->
        <label${scenario === "setup" ? " hidden" : ""}>Round in progress
          <select id="demo-live">${roundOptions}</select>
        </label>
        <label>You are (demo teams)
          <select id="demo-you">${byTeam("A", "Team USA")}${byTeam("B", "Team EU")}</select>
        </label>
        <!-- Live updates: only in the "play" scenario. -->
        <div class="demo-live-row"${scenario === "play" ? "" : " hidden"}>
          <span id="demo-live-status">${isLivePaused() ? "Live updates paused" : `Live: another group finishes a hole every ${LIVE_SECONDS} s`}</span>
          <button type="button" class="secondary" id="demo-live-toggle">${isLivePaused() ? "Resume" : "Pause"}</button>
        </div>
        <button type="button" class="secondary" id="demo-reset">Reset demo</button>
      </div>
    </details>
  `;
}

async function start() {
  let state = await ready;
  const params = new URLSearchParams(location.search);

  // A scenario named in the address (e.g. ?scenario=setup) that isn't
  // the current one: rebuild the made-up data for it first.
  const wanted = params.get("scenario");
  if (SCENARIOS[wanted] && wanted !== currentScenario()) {
    restartWithScenario(wanted);
    state = getState();   // the freshly rebuilt data
  }
  const defaultPage = currentScenario() === "setup" ? "admin" : state.liveRoundId;
  const page = DEMO_PAGES.includes(params.get("page")) ? params.get("page") : defaultPage;
  // The setup scenario's Admin page should open on Round 4's tab.
  if (page === "admin" && !location.hash && currentScenario() === "setup") {
    history.replaceState(null, "", `${location.search || "?page=admin"}#${state.liveRoundId}`);
  }

  // Fetch the real page and copy its content (minus its scripts) in.
  const html = await (await fetch(`/${page}.html`)).text();
  const real = new DOMParser().parseFromString(html, "text/html");
  const pageScript = [...real.querySelectorAll('script[type="module"]')]
    .map((s) => s.getAttribute("src"))
    .find((src) => src && !src.includes("nav.js"));
  real.querySelectorAll("script").forEach((s) => s.remove());
  document.title = `DEMO — ${real.title}`;
  document.body.prepend(...[...real.body.childNodes]);

  document.body.insertAdjacentHTML("beforeend", demoBarHtml(state));
  document.getElementById("demo-scenario").addEventListener("change", (e) => {
    restartWithScenario(e.target.value);
    location.href = "demo.html";   // opens the scenario's round
  });
  document.getElementById("demo-live").addEventListener("change", (e) => {
    restartWithLiveRound(e.target.value);
    location.href = `demo.html?page=${e.target.value}`;
  });
  document.getElementById("demo-you").addEventListener("change", (e) => {
    setYou(e.target.value);
    location.reload();
  });
  document.getElementById("demo-reset").addEventListener("click", () => {
    resetAll();
    location.href = "demo.html";
  });

  // Live updates (play scenario): run the timer unless paused. The
  // status line shows the latest update, e.g. "Match 3 finished hole 9".
  let stopLive = null;
  const statusEl = document.getElementById("demo-live-status");
  const toggleEl = document.getElementById("demo-live-toggle");
  const startLive = () => {
    stopLive = startLiveSimulation(LIVE_SECONDS, (what) => {
      statusEl.textContent = what ? `Live: ${what}` : "Live: every other match has finished";
    });
  };
  if (currentScenario() === "play" && !isLivePaused()) startLive();
  toggleEl.addEventListener("click", () => {
    const pausing = !isLivePaused();
    setLivePaused(pausing);
    if (pausing) {
      stopLive?.();
      statusEl.textContent = "Live updates paused";
    } else {
      startLive();
      statusEl.textContent = `Live: another group finishes a hole every ${LIVE_SECONDS} s`;
    }
    toggleEl.textContent = pausing ? "Resume" : "Pause";
  });

  // Now run the tab bar and the page's own script, exactly as the real
  // page would.
  await import("/js/nav.js");
  if (pageScript) await import(`/${pageScript.split("?")[0]}`);
}

start();
