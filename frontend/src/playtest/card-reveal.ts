import { createTableCard } from "./card-view.js";
import type { AgentCardObservation, CardPresentation } from "./types.js";

/**
 * V2h "NEWLY PLAYED CARD REVEAL": a restrained, temporary large presentation for a significant
 * newly-arrived permanent (see reveal-detection.ts) — appears large and centered for a readable
 * beat, then settles away on its own so the human always has time to actually recognize what just
 * entered the battlefield, without changing Player Focus or blocking any decision. Skippable: a
 * click/tap anywhere on it dismisses it immediately. Never fires for every trivial state change —
 * the caller (playtest-view.ts) only ever calls `show` for what `newlyArrivedPermanents` reports.
 */
export interface CardReveal {
  element: HTMLElement;
  show(card: AgentCardObservation, presentation: CardPresentation | null | undefined): void;
  hide(): void;
}

const REVEAL_MS = 1100;
const FADE_MS = 260;

export function createCardReveal(): CardReveal {
  const element = document.createElement("div");
  element.className = "table-card-reveal";
  element.hidden = true;
  element.setAttribute("role", "status");
  element.setAttribute("aria-label", "A new card entered the battlefield");

  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let removeTimer: ReturnType<typeof setTimeout> | null = null;

  function hide(): void {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (removeTimer) clearTimeout(removeTimer);
    element.classList.remove("table-card-reveal--visible");
    removeTimer = setTimeout(() => { element.hidden = true; element.replaceChildren(); }, FADE_MS);
  }

  element.addEventListener("click", hide);

  function show(card: AgentCardObservation, presentation: CardPresentation | null | undefined): void {
    if (hideTimer) clearTimeout(hideTimer);
    if (removeTimer) clearTimeout(removeTimer);
    const cardElement = createTableCard({ ...card, tapped: false }, presentation, { className: "table-card-reveal-card" });
    element.replaceChildren(cardElement);
    element.hidden = false;
    element.classList.remove("table-card-reveal--visible");
    void element.offsetWidth; // force the "before" frame to actually paint before animating in.
    element.classList.add("table-card-reveal--visible");
    hideTimer = setTimeout(hide, REVEAL_MS);
  }

  return { element, show, hide };
}
