import { cardDisplayName } from "./card-format.js";
import type { AgentCardObservation, CardPresentation } from "./types.js";

export interface TableCardOptions {
  /** Present only for battlefield cards: click/Enter toggles the large right-side preview. Hand cards omit this — they are read via hover, never pinned. */
  onActivate?: (card: AgentCardObservation) => void;
  /** True when this is the card currently pinned in the preview panel. */
  selected?: boolean;
  className?: string;
}

/**
 * One real Magic card, full image, correct aspect ratio (5:7) — used for both the battlefield and
 * the hand. Tapped cards rotate ~45° (never a "[T]" badge as the primary signal, though the title/
 * aria-label still say "Tapped" for accessibility). When no artwork is available yet (or never
 * resolves), a plain placeholder still shows the visible name — never blank, never a guessed image.
 */
export function createTableCard(
  card: AgentCardObservation,
  presentation: CardPresentation | null | undefined,
  options: TableCardOptions = {},
): HTMLElement {
  const name = cardDisplayName(card);
  const element = document.createElement(options.onActivate ? "button" : "div");
  element.className = ["table-card", card.tapped ? "table-card--tapped" : "", options.selected ? "table-card--selected" : "", options.className ?? ""]
    .filter(Boolean).join(" ");
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

  if (options.onActivate) element.addEventListener("click", () => options.onActivate!(card));
  return element;
}
