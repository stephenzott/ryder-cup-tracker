// DEMO ONLY. Loads one of the real pages (Home, Scoreboard or a Round
// page) inside demo.html, running that page's real script, and adds
// the yellow demo bar.
//
// Which page: demo.html?page=index | scoreboard | round1 ... round4.
// With no ?page=, it opens the round that's "in progress", which is
// the "standing on the tee mid-round" view.
//
// How it shows a real page without copying it: fetch that page's HTML
// file, move its body content into this page, then load its script.
// Because demo.html has an import map (see its <head>), that script's
// Firebase imports come from /demo/ fakes, so it reads the made-up
// data instead of the live database.

import { ROUNDS } from "/js/rounds-config.js";
import { ready, getState, restartWithLiveRound, setYou, resetAll } from "./state.js";

const DEMO_PAGES = ["index", "scoreboard", ...ROUNDS.map((r) => r.id)];

// Links to these real pages are kept inside the demo (rewritten to
// demo.html?page=...). Anything else (Roster, Stats, a player card,
// Schedule) opens the real page, which shows real data.
function demoLinkFor(href) {
  const match = /^(?:\/)?(index|scoreboard|round[1-4])\.html(#.*)?$/.exec(href || "");
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
      <summary><span class="demo-tag">DEMO</span> Made-up data · nothing is saved</summary>
      <div class="demo-controls">
        <label>Round in progress
          <select id="demo-live">${roundOptions}</select>
        </label>
        <label>You are (demo teams)
          <select id="demo-you">${byTeam("A", "Team USA")}${byTeam("B", "Team EU")}</select>
        </label>
        <button type="button" class="secondary" id="demo-reset">Reset demo</button>
      </div>
    </details>
  `;
}

async function start() {
  const state = await ready;
  const params = new URLSearchParams(location.search);
  const page = DEMO_PAGES.includes(params.get("page")) ? params.get("page") : state.liveRoundId;

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

  // Now run the tab bar and the page's own script, exactly as the real
  // page would.
  await import("/js/nav.js");
  if (pageScript) await import(`/${pageScript.split("?")[0]}`);
}

start();
