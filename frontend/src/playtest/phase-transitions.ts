/**
 * V2h "MAJOR PHASE / CHAPTER TRANSITIONS": restrained cinematic text for the handful of genuinely
 * major beats a human tracks a game by — never fired for every Magic phase/step (upkeep, draw,
 * every priority window, every combat substep, end step, …), only whose-turn-it-is and the moment
 * combat begins.
 */
export type MajorPhaseTransition = "your_turn" | "opponent_turn" | "combat";

/**
 * Pure. Which major transition (if any) just occurred between two consecutive turn/phase/
 * active-player readings — `null` on the very first reading (nothing to compare against) and for
 * every phase/step that isn't one of the two named beats above. A combat transition fires once,
 * exactly on the step from a non-combat phase into a combat_* phase (never re-fires while combat
 * continues across its own sub-steps).
 */
export function detectMajorPhaseTransition(
  previous: { turn: number; phase: string; activePlayerId: string } | null,
  next: { turn: number; phase: string; activePlayerId: string },
  selfPlayerId: string,
): MajorPhaseTransition | null {
  if (!previous) return null;
  if (previous.turn !== next.turn || previous.activePlayerId !== next.activePlayerId) {
    return next.activePlayerId === selfPlayerId ? "your_turn" : "opponent_turn";
  }
  const wasCombat = previous.phase.startsWith("combat");
  const isCombat = next.phase.startsWith("combat");
  if (!wasCombat && isCombat) return "combat";
  return null;
}

/** Pure. The exact banner text for one transition — `opponentLabel` is the already-resolved seat name (see player-seat.ts's `seatName`), never re-derived here. */
export function phaseTransitionLabel(transition: MajorPhaseTransition, opponentLabel: string): string {
  switch (transition) {
    case "your_turn": return "YOUR TURN";
    case "opponent_turn": return `${opponentLabel.toUpperCase()}'S TURN`;
    case "combat": return "COMBAT";
  }
}

export interface PhaseBanner {
  element: HTMLElement;
  show(transition: MajorPhaseTransition, label: string): void;
  reset(): void;
}

const VISIBLE_MS = 900;
const FADE_MS = 320;

/**
 * A short, elegant, non-blocking text banner — fades/moves in, holds, fades out. Gameplay never
 * waits for it (nothing here is awaited by any decision/render path); it is purely decorative on
 * top of whatever already painted.
 */
export function createPhaseBanner(): PhaseBanner {
  const element = document.createElement("div");
  element.className = "table-phase-banner";
  element.setAttribute("aria-live", "polite");
  element.hidden = true;

  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let removeTimer: ReturnType<typeof setTimeout> | null = null;

  function show(transition: MajorPhaseTransition, label: string): void {
    if (hideTimer) clearTimeout(hideTimer);
    if (removeTimer) clearTimeout(removeTimer);
    element.dataset.transition = transition;
    element.textContent = label;
    element.hidden = false;
    element.classList.remove("table-phase-banner--visible");
    void element.offsetWidth; // restart the enter transition even if one was already mid-flight.
    element.classList.add("table-phase-banner--visible");
    hideTimer = setTimeout(() => {
      element.classList.remove("table-phase-banner--visible");
      removeTimer = setTimeout(() => { element.hidden = true; }, FADE_MS);
    }, VISIBLE_MS);
  }

  function reset(): void {
    if (hideTimer) clearTimeout(hideTimer);
    if (removeTimer) clearTimeout(removeTimer);
    element.hidden = true;
    element.classList.remove("table-phase-banner--visible");
  }

  return { element, show, reset };
}
