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
  present(card: AgentCardObservation, presentation: CardPresentation | null | undefined, caption: string): Promise<void>;
  settle(card: AgentCardObservation, presentation: CardPresentation | null | undefined, root: HTMLElement): Promise<void>;
}

// V2h.2 "PACING": bumped alongside frame-playback.ts's own retuning — a newly-arrived permanent is
// part of the same "spell cast" comprehension window (~3-4s total, see OPPONENT_ACTION_DELAY_MS),
// so its own big reveal now holds noticeably longer before settling into the condensed board.
const REVEAL_MS = 1400;
const FADE_MS = 300;

export function createCardReveal(): CardReveal {
  const element = document.createElement("div");
  element.className = "table-card-reveal";
  element.hidden = true;
  element.setAttribute("role", "status");
  element.setAttribute("aria-label", "A new card entered the battlefield");

  let hideTimer: ReturnType<typeof setTimeout> | null = null;
  let removeTimer: ReturnType<typeof setTimeout> | null = null;
  let complete: (() => void) | null = null;

  function hide(): void {
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    if (removeTimer) clearTimeout(removeTimer);
    complete?.(); complete = null;
    element.classList.remove("table-card-reveal--visible");
    removeTimer = setTimeout(() => { element.hidden = true; element.replaceChildren(); }, FADE_MS);
  }

  element.addEventListener("click", hide);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !element.hidden) { event.preventDefault(); hide(); }
  });

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

  return { element, show, hide,
    present(card, presentation, caption) {
      hide();
      show(card, presentation);
      if (hideTimer) clearTimeout(hideTimer);
      const content = document.createElement('div'); content.className = 'table-reveal-content';
      content.append(...Array.from(element.childNodes));
      const label = document.createElement('p'); label.className = 'table-reveal-caption'; label.textContent = caption;
      const skip = document.createElement('button'); skip.type = 'button'; skip.className = 'table-reveal-skip'; skip.textContent = 'Continue · Esc';
      content.append(label, skip); element.append(content);
      return new Promise<void>(resolve => { complete = resolve; hideTimer = setTimeout(hide, 3500); });
    },
    async settle(card, presentation, root) {
      const target = Array.from(root.querySelectorAll<HTMLElement>('.physical-scene [data-card-ref]')).find(node => node.dataset.cardRef === card.cardRef);
      if (!target || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const rect = target.getBoundingClientRect();
      if (!rect.width || rect.right < 0 || rect.left > innerWidth) return;
      const ghost = createTableCard({ ...card, tapped: false }, presentation);
      ghost.removeAttribute('data-card-ref'); ghost.setAttribute('aria-hidden','true');
      const width = Math.min(280, innerWidth * .2);
      Object.assign(ghost.style, { position: 'fixed', zIndex: '22', pointerEvents: 'none', left: `${innerWidth / 2 - width / 2}px`, top: `${innerHeight / 2 - width * .7}px`, width: `${width}px`, margin: '0' });
      document.body.append(ghost);
      const from = ghost.getBoundingClientRect();
      const animation = ghost.animate([
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${rect.left - from.left}px,${rect.top - from.top}px) scale(${rect.width / width})`, opacity: 0 },
      ], { duration: 650, easing: 'cubic-bezier(.25,.7,.25,1)' });
      await animation.finished.catch(() => {}); ghost.remove();
    },
  };
}
