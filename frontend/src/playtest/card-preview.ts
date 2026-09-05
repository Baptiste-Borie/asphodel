import { cardDisplayName, formatCounters } from "./card-format.js";
import type { AgentCardObservation, CardPresentation } from "./types.js";

export interface CardPreviewPanel {
  element: HTMLElement;
  /** Transient hover preview — ignored while something is pinned, so reading a pinned card is never interrupted. */
  showHover(card: AgentCardObservation, presentation: CardPresentation | null | undefined): void;
  clearHover(): void;
  /** Click/Enter: pins this card, or unpins it if it is already pinned. */
  togglePin(card: AgentCardObservation, presentation: CardPresentation | null | undefined): void;
  closePinned(): void;
}

function textLine(className: string, text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = className;
  p.textContent = text;
  return p;
}

/**
 * The single full-card inspector for the whole game screen (sidebar on wide layouts, overlay on
 * narrow ones — CSS-driven, same DOM). Prefers the real Scryfall image; when unavailable, the
 * name/mana cost/type/oracle text/P-T still make the card understandable — reading a card is never
 * gated on the image alone.
 */
export function createCardPreviewPanel(): CardPreviewPanel {
  const element = document.createElement("div");
  element.className = "card-preview-panel";
  let pinnedRef: string | null = null;

  function renderPlaceholder(): void {
    element.replaceChildren(textLine("card-preview-hint", "Hover or click a card to inspect it."));
  }

  function render(card: AgentCardObservation, presentation: CardPresentation | null | undefined, pinned: boolean): void {
    element.replaceChildren();
    if (pinned) {
      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "card-preview-close";
      closeButton.textContent = "×";
      closeButton.setAttribute("aria-label", "Close preview");
      closeButton.addEventListener("click", closePinned);
      element.append(closeButton);
    }
    const name = cardDisplayName(card);
    if (presentation?.imageUri) {
      const img = document.createElement("img");
      img.className = "card-preview-image";
      img.src = presentation.imageUri;
      img.alt = name;
      element.append(img);
    }
    const heading = document.createElement("h3");
    heading.className = "card-preview-name";
    heading.textContent = presentation?.manaCost ? `${name}   ${presentation.manaCost}` : name;
    element.append(heading);

    const typeLine = presentation?.typeLine ?? card.typeLine;
    if (typeLine) element.append(textLine("card-preview-type", typeLine));
    if (presentation?.oracleText) element.append(textLine("card-preview-text", presentation.oracleText));
    if (card.power !== null && card.toughness !== null) element.append(textLine("card-preview-pt", `${card.power}/${card.toughness}`));
    const counters = formatCounters(card.counters);
    if (counters) element.append(textLine("card-preview-counters", counters));
    if (card.tapped) element.append(textLine("card-preview-tapped", "Tapped"));
  }

  function showHover(card: AgentCardObservation, presentation: CardPresentation | null | undefined): void {
    if (pinnedRef) return;
    render(card, presentation, false);
  }
  function clearHover(): void {
    if (pinnedRef) return;
    renderPlaceholder();
  }
  function togglePin(card: AgentCardObservation, presentation: CardPresentation | null | undefined): void {
    if (pinnedRef === card.cardRef) {
      closePinned();
      return;
    }
    pinnedRef = card.cardRef;
    render(card, presentation, true);
  }
  function closePinned(): void {
    pinnedRef = null;
    renderPlaceholder();
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && pinnedRef) closePinned();
  });

  renderPlaceholder();
  return { element, showHover, clearHover, togglePin, closePinned };
}
