// Logic for roster.html: a live (real-time) player list, plus
// admin-only add/remove/edit controls gated by the unlock flow in
// auth.js.

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

const rowsEl = document.getElementById("roster-rows");
const adminColHeader = document.getElementById("roster-admin-col");
const adminControls = document.getElementById("admin-controls");
const unlockContainer = document.getElementById("unlock");

// We keep the latest player list and the current unlock state as
// plain variables, and re-draw the table whenever either changes.
// Firestore's onSnapshot fires every time the data changes (including
// right after our own writes), which is what makes this "live" for
// everyone looking at the page at once, not just the person editing.
let latestPlayers = [];
let isAdminUnlocked = false;

function teamLabel(team) {
  if (team === "A") return "United States";
  if (team === "B") return "Europe";
  return "—";
}

function renderTable() {
  adminColHeader.style.display = isAdminUnlocked ? "" : "none";

  if (latestPlayers.length === 0) {
    rowsEl.innerHTML = `<tr><td colspan="4">No players yet.</td></tr>`;
    return;
  }

  rowsEl.innerHTML = latestPlayers
    .map((p) => {
      const adminCell = isAdminUnlocked
        ? `<td>
             <select data-id="${p.id}" class="team-select">
               <option value="" ${!p.team ? "selected" : ""}>Unassigned</option>
               <option value="A" ${p.team === "A" ? "selected" : ""}>United States</option>
               <option value="B" ${p.team === "B" ? "selected" : ""}>Europe</option>
             </select>
             <button type="button" class="secondary remove-player" data-id="${p.id}">Remove</button>
           </td>`
        : "";

      return `
        <tr>
          <td>${escapeHtml(p.name)}</td>
          <td>${p.handicapIndex ?? "—"}</td>
          <td>${teamLabel(p.team)}</td>
          ${adminCell}
        </tr>
      `;
    })
    .join("");

  if (isAdminUnlocked) {
    rowsEl.querySelectorAll(".team-select").forEach((select) => {
      select.addEventListener("change", async (e) => {
        const playerId = e.target.dataset.id;
        const team = e.target.value || null;
        await updateDoc(doc(db, "players", playerId), { team });
      });
    });

    rowsEl.querySelectorAll(".remove-player").forEach((btn) => {
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
