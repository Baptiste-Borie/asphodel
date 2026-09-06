import { cardDisplayName } from "./card-format.js";
import type { AgentCardObservation, CardPresentation } from "./types.js";

export interface TableCardOptions {
  /**
   * Present for battlefield cards (click/Enter toggles the large right-side preview) and, since
   * V2e.4, for a playable hand card (click submits its one legal action or opens a contextual
   * menu of its several) — the rendered element is passed too, so a caller can anchor a menu near
   * it. A non-playable hand card omits this entirely — it is read via hover only, never pinned or
   * clickable.
   */
  onActivate?: (card: AgentCardObservation, element: HTMLElement) => void;
  /** True when this is the card currently pinned in the preview panel. */
  selected?: boolean;
  className?: string;
  /**
   * Wraps the card in a fixed-aspect "slot" sized to reserve room for a 90°-rotated (tapped) card
   * without clipping or unpredictably resizing the row — see styles/tabletop.css
   * `.table-card-slot`. Used for battlefield/commander cards; never for the hand, which never taps.
   */
  useSlot?: boolean;
  /**
   * Visual stack count (V2e.5, see card-grouping.ts) — when greater than 1, shows a small "×N"
   * badge. This card still represents exactly one shared display signature; the underlying
   * cardRefs it stands for are never collapsed into a single fake game object anywhere outside
   * this presentation layer.
   */
  count?: number;
}

/** Pure. The className applied to the actual `.table-card` element (never the optional outer slot). Summoning sickness (V2e.5) is a distinct, independent visual signal from tapped/selected — presentation only, Forge remains the sole authority on legality. */
export function tableCardClassName(card: Pick<AgentCardObservation, "tapped" | "summoningSick">, selected: boolean, extraClassName = ""): string {
  return [
    "table-card",
    card.tapped ? "table-card--tapped" : "",
    card.summoningSick ? "table-card--summoning-sick" : "",
    selected ? "table-card--selected" : "",
    extraClassName,
  ].filter(Boolean).join(" ");
}

/** Per-element mutable state for the single, stable click listener attached at creation — so a REUSED element (see `existingCardElement` below) always calls the CURRENT `card`/`onActivate` it was most recently rendered with, never a stale closure from when it was first created. */
const activationState = new WeakMap<HTMLElement, { card: AgentCardObservation; onActivate?: (card: AgentCardObservation, element: HTMLElement) => void }>();
const hasClickListener = new WeakSet<HTMLElement>();

/**
 * One real Magic card, full image, correct aspect ratio (5:7) — used for the battlefield, the
 * commander dock, and the hand. Tapped battlefield/commander cards rotate 90° in place, like a
 * real tapped Magic card (never a "[T]" badge as the primary signal, though the title/aria-label
 * still say "Tapped" for accessibility) — `useSlot` reserves enough room for that rotation so it
 * never clips or collides with neighbors. When no artwork is available yet (or never resolves), a
 * plain placeholder still shows the visible name — never blank, never a guessed image.
 *
 * `existingCardElement` (V2e.5): when supplied and shape-compatible (same button-vs-div tag,
 * already a `.table-card`), the SAME element is updated and returned in place instead of a new one
 * being created — this is what lets the tapped-rotation and summoning-sickness CSS transitions
 * actually animate (a brand-new element has no "before" state to animate from). See
 * `board-renderer.ts`'s reconciled battlefield rendering, which is the only caller that passes it.
 */
export function createTableCard(
  card: AgentCardObservation,
  presentation: CardPresentation | null | undefined,
  options: TableCardOptions = {},
  existingCardElement?: HTMLElement,
): HTMLElement {
  const name = cardDisplayName(card);
  const wantsButton = Boolean(options.onActivate);
  const canReuse = Boolean(
    existingCardElement
      && existingCardElement.classList.contains("table-card")
      && (wantsButton ? existingCardElement instanceof HTMLButtonElement : existingCardElement.tagName === "DIV"),
  );
  const element = canReuse ? existingCardElement! : document.createElement(wantsButton ? "button" : "div");

  element.className = tableCardClassName(card, Boolean(options.selected), options.className ?? "");
  const accessibleName = card.tapped ? `${name} (Tapped)` : name;
  element.title = accessibleName;
  if (element instanceof HTMLButtonElement) {
    element.type = "button";
    element.setAttribute("aria-label", accessibleName);
    element.setAttribute("aria-pressed", String(Boolean(options.selected)));
  }

  const face = document.createElement("div");
  face.className = "table-card-face";
  if (presentation?.imageUri) {
    const img = document.createElement("img");
    img.className = "table-card-image";
    img.src = presentation.imageUri;
    img.alt = name;
    img.loading = "lazy";
    face.append(img);
  } else {
    face.classList.add("table-card-face--placeholder");
    const label = document.createElement("span");
    label.textContent = name;
    face.append(label);
  }
  const children: HTMLElement[] = [face];
  if (options.count && options.count > 1) {
    const badge = document.createElement("span");
    badge.className = "table-card-count";
    badge.textContent = `×${options.count}`;
    children.push(badge);
  }
  element.replaceChildren(...children);

  activationState.set(element, { card, onActivate: options.onActivate });
  if (options.onActivate && !hasClickListener.has(element)) {
    element.addEventListener("click", () => {
      const state = activationState.get(element);
      state?.onActivate?.(state.card, element);
    });
    hasClickListener.add(element);
  }

  if (!options.useSlot) return element;

  const slot = document.createElement("div");
  slot.className = card.tapped ? "table-card-slot table-card-slot--tapped" : "table-card-slot";
  slot.append(element);
  return slot;
}
