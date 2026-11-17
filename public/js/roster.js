// Logic for roster.html: a live (real-time) player list grouped by
// this year's team, plus admin-only add/remove/reassign controls gated
// by the unlock flow in auth.js.
//
// Teams are redrawn every year, so the groups are labeled with the
// year ("2027 · Team USA"); players.team in Firestore only ever means
// the current year's team.

import { db } from "./firebase-init.js";
import { renderUnlockBar } from "./auth.js";
import {
  collection,
  onSnapshot,
  addDoc,
  deleteDoc,
  doc,
  updateDoc,
  orderBy,
  query,
} from "https://www.gstatic.com/firebasejs/11.3.1/firebase-firestore.js";
import { playerLink } from "./player-stats.js";
// Shared look: initials circles, team pills, the year constant.
import { avatarHtml, teamPillHtml, CURRENT_YEAR } from "./match-ui.js";

const groupsEl = document.getElementById("roster-groups");
const adminControls = document.getElementById("admin-controls");
const unlockContainer = document.getElementById("unlock");

// We keep the latest player list and the current unlock state as
// plain variables, and re-draw the table whenever either changes.
// Firestore's onSnapshot fires every time the data changes (including
// right after our own writes), which is what makes this "live" for
// everyone looking at the page at once, not just the person editing.
let latestPlayers = [];
let isAdminUnlocked = false;

document.getElementById("roster-eyebrow").textContent = `${CURRENT_YEAR} field`;

// One player row: initials circle, linked name, handicap on the right.
// Admins also get this year's team dropdown and a Remove button, which
// wrap onto their own line on a narrow phone.
function playerRowHtml(p) {
  const name = escapeHtml(p.name);
  const adminControls = isAdminUnlocked
    ? `<div class="roster-row-admin">
         <select data-id="${p.id}" class="team-select" aria-label="${CURRENT_YEAR} team for ${name}">
           <option value="" ${!p.team ? "selected" : ""}>Unassigned</option>
           <option value="A" ${p.team === "A" ? "selected" : ""}>Team USA</option>
           <option value="B" ${p.team === "B" ? "selected" : ""}>Team EU</option>
         </select>
         <button type="button" class="secondary remove-player" data-id="${p.id}">Remove</button>
       </div>`
    : "";
  return `
    <li class="roster-row">
      ${avatarHtml(p.name, p.team)}
      <span class="roster-name">${playerLink(p.id, name)}</span>
      <span class="roster-hcp"><span class="roster-hcp-label">HCP</span> ${p.handicapIndex ?? "—"}</span>
      ${adminControls}
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

  if (isAdminUnlocked) {
    groupsEl.querySelectorAll(".team-select").forEach((select) => {
      select.addEventListener("change", async (e) => {
        const playerId = e.target.dataset.id;
        const team = e.target.value || null;
        await updateDoc(doc(db, "players", playerId), { team });
      });
    });

    groupsEl.querySelectorAll(".remove-player").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        const playerId = e.target.dataset.id;
        const player = latestPlayers.find((p) => p.id === playerId);
        if (confirm(`Remove ${player?.name ?? "this player"}?`)) {
          await deleteDoc(doc(db, "players", playerId));
        }
      });
    });
  }
}

// Basic escaping so a player name can never inject HTML into the page
// — not a realistic attack from your own trip's roster, but cheap
// insurance since we're building this HTML with string concatenation
// above rather than using the DOM API for each cell.
function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// Live subscription — this callback fires immediately with the
// current data, then again every time anything in the collection
// changes (from this browser or anyone else's).
onSnapshot(query(collection(db, "players"), orderBy("name")), (snapshot) => {
  latestPlayers = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
  renderTable();
});

renderUnlockBar(unlockContainer, "admin", () => {
  isAdminUnlocked = true;
  adminControls.classList.remove("locked");
  renderTable();
});

document
  .getElementById("add-player-form")
  .addEventListener("submit", async (e) => {
    e.preventDefault();
    const nameInput = document.getElementById("new-player-name");
    const handicapInput = document.getElementById("new-player-handicap");
    const teamInput = document.getElementById("new-player-team");
    const status = document.getElementById("add-player-status");

    const name = nameInput.value.trim();
    if (!name) return;

    status.textContent = "Adding…";
    status.className = "status-msg";

    try {
      await addDoc(collection(db, "players"), {
        name,
        handicapIndex: handicapInput.value
          ? parseFloat(handicapInput.value)
          : null,
        team: teamInput.value || null,
      });
      nameInput.value = "";
      handicapInput.value = "";
      teamInput.value = "";
      status.textContent = "Added.";
      status.className = "status-msg ok";
    } catch (err) {
      status.textContent = "Failed — are you unlocked with the admin code?";
      status.className = "status-msg error";
    }
  });
