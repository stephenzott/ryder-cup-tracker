// DEMO ONLY. Stands in for /js/auth.js on the demo page. Instead of
// the "Who are you?" picker, the demo is always "unlocked" as the
// player chosen in the demo bar: score level in the "play" scenario,
// admin (and still that player) in the "setup" scenario.
import { ready, getState, currentScenario } from "./state.js";

export function getUnlockLevel() {
  return currentScenario() === "setup" ? "admin" : "score";
}

export function getUnlockPlayerId() {
  return getState()?.you ?? null;
}

// Same signature as the real one: draw something in `container`, then
// call `onUnlocked` once access is granted.
export function renderUnlockBar(container, requiredLevel, onUnlocked) {
  ready.then((state) => {
    const me = state.players.find((p) => p.id === state.you);
    container.innerHTML = `
      <div class="unlock-bar">
        <span class="status-msg ok">Demo: you're signed in as <strong>${me ? me.name : "?"}</strong>${getUnlockLevel() === "admin" ? " <strong>with admin access</strong>" : ""} (change it in the demo bar).</span>
      </div>
    `;
    onUnlocked();
  });
}
