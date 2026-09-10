import { createTableCard, renderedCardState } from "./card-view.js";

/**
 * V2h "GLOBAL HOVER CARD CLIPPING BUG": a single, global overlay appended directly to
 * `document.body` — outside `.table-root`, `.physical-scene`, every board/hand/zone container —
 * that shows an enlarged, upright, full ("printed") rendering of whichever `.table-card` element is
 * currently hovered/focused, positioned from that element's own `getBoundingClientRect()` and
 * clamped to stay fully inside the viewport.
 *
 * Root cause of the bug this replaces: the previous hover-magnify was a per-container CSS
 * `transform: scale()` on the card ITSELF (`.table-card--hand:hover`, `.physical-hand
 * .table-card--hand:hover`, …). Growing an element in place is clipped by any ancestor with a
 * non-visible `overflow` — and several genuinely need one for unrelated reasons (`.table-root`
 * itself is `overflow: hidden`; `.physical-scene` is `overflow: auto` so several player boards can
 * scroll). No number of targeted `overflow: visible` exceptions fixes this in general, because the
 * clip can happen at ANY ancestor depth depending on which board is hovered (the main board, a
 * compact/self board, a small "preview"-density board when 3-4 players are seated) — hence a global
 * portal instead: it has no ancestor from the board hierarchy at all, so there is nothing left to
 * clip it except the browser viewport itself, exactly as the spec requires.
 *
 * Deliberately renders a FRESH, full "printed"-variant card (via `card-view.ts`'s
 * `renderedCardState` registry) rather than cloning the hovered element's own condensed on-table
 * DOM: a condensed battlefield/land card's styling is scoped under ancestor selectors
 * (`.physical-board [data-card-variant=battlefield] …`) that a portal outside that ancestor chain
 * would no longer match, and a real full card face is more useful for inspection anyway. The
 * existing click-to-pin inspector (`card-preview.ts`) and right-click full inspection are
 * completely unaffected — this is a transient, hover-only companion to those, never a replacement.
 */
export interface HoverPreview {
  element: HTMLElement;
  /** Wires delegated pointer/focus listeners on `root` — call once; safe to call only once per root. */
  attach(root: EventTarget): void;
  hide(): void;
}

/** Matches every on-table card variant that is currently readable via hover magnify — hand cards (main and physical) plus condensed battlefield/land cards (Physical mode). Deliberately excludes anything already inside the portal itself or the pinned inspector, and mana-payment/picker surfaces, which have their own dedicated large presentation. */
const HOVER_SELECTOR = ".table-card--hand, [data-card-variant='battlefield'], [data-card-variant='land']";
const EXCLUDED_ANCESTOR_SELECTOR = ".table-hover-preview, .table-preview, .table-mana-overlay, dialog";
const EDGE_MARGIN = 14;
const GAP = 18;

function matchCard(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  const card = target.closest<HTMLElement>(HOVER_SELECTOR);
  if (!card || card.closest(EXCLUDED_ANCESTOR_SELECTOR)) return null;
  return card;
}

export function createHoverPreview(): HoverPreview {
  const element = document.createElement("div");
  element.className = "table-hover-preview table-hover-preview--hidden";
  element.hidden = true;
  element.setAttribute("aria-hidden", "true"); // a decorative duplicate; the real card already carries the accessible name.
  document.body.append(element);

  let current: HTMLElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  function place(source: HTMLElement): void {
    const rect = source.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const previewRect = element.getBoundingClientRect();
    const width = previewRect.width || element.offsetWidth;
    const height = previewRect.height || element.offsetHeight;

    let left = rect.left + rect.width / 2 - width / 2;
    let top = rect.top - height - GAP;
    if (top < EDGE_MARGIN) top = rect.bottom + GAP; // not enough room above -> show below instead.

    left = Math.min(Math.max(left, EDGE_MARGIN), Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN));
    top = Math.min(Math.max(top, EDGE_MARGIN), Math.max(EDGE_MARGIN, window.innerHeight - height - EDGE_MARGIN));
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
  }

  function show(source: HTMLElement): void {
    const state = renderedCardState(source);
    if (!state) return;
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    current = source;
    // Upright regardless of the source's own tapped state — reading a card is not re-representing
    // board state the source card already shows (same choice `card-preview.ts` makes).
    const cardElement = createTableCard({ ...state.card, tapped: false }, state.presentation, { className: "table-hover-preview-card" });
    element.replaceChildren(cardElement);
    element.hidden = false;
    element.classList.remove("table-hover-preview--hidden");
    place(source);
  }

  function hide(): void {
    current = null;
    element.classList.add("table-hover-preview--hidden");
    hideTimer = setTimeout(() => {
      if (!current) { element.hidden = true; element.replaceChildren(); }
    }, 140);
  }

  function attach(root: EventTarget): void {
    root.addEventListener("pointerover", (event) => {
      const card = matchCard(event.target);
      if (card && card !== current) show(card);
    });
    root.addEventListener("pointerout", (event) => {
      const mouseEvent = event as PointerEvent;
      const card = matchCard(mouseEvent.target);
      if (!card || card !== current) return;
      const related = mouseEvent.relatedTarget;
      if (related instanceof Node && card.contains(related)) return;
      hide();
    });
    root.addEventListener("focusin", (event) => {
      const card = matchCard(event.target);
      if (card) show(card);
    });
    root.addEventListener("focusout", (event) => {
      const card = matchCard(event.target);
      if (card && card === current) hide();
    });
    // A reused card element (V2e.5 reconciliation) keeps its identity across a re-render, but its
    // on-screen position can still move (battlefield reflow, scroll) — keep the floating preview
    // glued to its actual current spot rather than a stale one.
    window.addEventListener("scroll", () => { if (current) place(current); }, true);
    window.addEventListener("resize", () => { if (current) place(current); });
  }

  return { element, attach, hide };
}
