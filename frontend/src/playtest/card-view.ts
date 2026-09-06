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
}

/** Pure. The className applied to the actual `.table-card` element (never the optional outer slot). */
export function tableCardClassName(card: Pick<AgentCardObservation, "tapped">, selected: boolean, extraClassName = ""): string {
  return ["table-card", card.tapped ? "table-card--tapped" : "", selected ? "table-card--selected" : "", extraClassName]
    .filter(Boolean).join(" ");
}

/**
 * One real Magic card, full image, correct aspect ratio (5:7) — used for the battlefield, the
 * commander dock, and the hand. Tapped battlefield/commander cards rotate 90° in place, like a
 * real tapped Magic card (never a "[T]" badge as the primary signal, though the title/aria-label
 * still say "Tapped" for accessibility) — `useSlot` reserves enough room for that rotation so it
 * never clips or collides with neighbors. When no artwork is available yet (or never resolves), a
 * plain placeholder still shows the visible name — never blank, never a guessed image.
 */
export function createTableCard(
  card: AgentCardObservation,
  presentation: CardPresentation | null | undefined,
  options: TableCardOptions = {},
): HTMLElement {
  const name = cardDisplayName(card);
  const element = document.createElement(options.onActivate ? "button" : "div");
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
  element.append(face);

  if (options.onActivate) element.addEventListener("click", () => options.onActivate!(card, element));
  if (!options.useSlot) return element;

  const slot = document.createElement("div");
  slot.className = card.tapped ? "table-card-slot table-card-slot--tapped" : "table-card-slot";
  slot.append(element);
  return slot;
}
