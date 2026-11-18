// Logic for roster.html: a live (real-time), read-only player list
// grouped by this year's team. Adding, removing and reassigning
// players happens on the Admin page (admin.js).
//
// Teams are redrawn every year, so the groups are labeled with the
// year ("2027 · Team USA"); players.team in Firestore only ever means
// the current year's team.

import { db } from "./firebase-init.js";
import {
  collection,
  onSnapshot,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { playerLink } from "./player-stats.js";
// Shared look: initials circles, team pills, the year constant.
import { avatarHtml, teamPillHtml, CURRENT_YEAR } from "./match-ui.js";

const groupsEl = document.getElementById("roster-groups");

// The latest player list. Firestore's onSnapshot fires every time the
// data changes (from any phone), and the list is redrawn each time,
// which is what makes this page "live".
let latestPlayers = [];

document.getElementById("roster-eyebrow").textContent = `${CURRENT_YEAR} field`;

// Basic escaping so a player name can never inject HTML into the page
// -- not a realistic attack from your own trip's roster, but cheap
// insurance since the HTML is built with template strings.
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// One player row: initials circle, linked name, handicap on the right.
function playerRowHtml(p) {
  const name = escapeHtml(p.name);
  return `
    <li class="roster-row">
      ${avatarHtml(p.name, p.team)}
      <span class="roster-name">${playerLink(p.id, name)}</span>
      <span class="roster-hcp"><span class="roster-hcp-label">HCP</span> ${p.handicapIndex ?? "—"}</span>
    </li>
  `;
}

// Groups in display order. Unassigned only appears if anyone is.
const GROUPS = [
  { team: "A", match: (p) => p.team === "A" },
  { team: "B", match: (p) => p.team === "B" },
  { team: null, match: (p) => p.team !== "A" && p.team !== "B" },
];

function renderTable() {
  groupsEl.removeAttribute("aria-busy");

  if (latestPlayers.length === 0) {
    groupsEl.innerHTML = `<p class="sb-empty">No players yet.</p>`;
    return;
  }

  groupsEl.innerHTML = GROUPS.map(({ team, match }) => {
    // latestPlayers is already sorted by name (see the query below).
    const members = latestPlayers.filter(match);
    if (members.length === 0 && team === null) return "";
    return `
      <section class="roster-group">
        <h2 class="roster-group-title">
          ${teamPillHtml(team)}
          <span class="roster-count">${members.length} player${members.length === 1 ? "" : "s"}</span>
        </h2>
        <ul class="roster-list">
          ${members.map(playerRowHtml).join("") || `<li class="roster-row roster-row-empty">No one yet.</li>`}
        </ul>
      </section>
    `;
  }).join("");
}

// Live subscription: fires immediately with the current data, then
// again every time anything in the collection changes.
onSnapshot(query(collection(db, "players"), orderBy("name")), (snapshot) => {
  latestPlayers = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTable();
});
