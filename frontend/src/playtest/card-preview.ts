import { cardDisplayName, formatCounters } from "./card-format.js";
import type { AgentCardObservation, CardPresentation } from "./types.js";

export interface CardPreviewPanel {
  element: HTMLElement;
  isOpen(): boolean;
  isSelected(cardRef: string): boolean;
  /** Click/Enter on a battlefield card: pins it, or unpins (closes) if it is already the selected one. */
  togglePin(card: AgentCardObservation, presentation: CardPresentation | null | undefined): void;
  close(): void;
}

function textLine(className: string, text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  p.className = className;
  p.textContent = text;
  return p;
}

/**
 * The single large full-card inspector, only for battlefield cards (the hand is read via hover,
 * never pinned). Hidden entirely — no permanent empty panel — until a card is selected. Prefers the
 * real Scryfall image; when unavailable the name/mana cost/type/oracle text/P-T still fully explain
 * the card, so reading one is never gated on the image alone.
 */
export function createCardPreviewPanel(): CardPreviewPanel {
  const element = document.createElement("div");
  element.className = "table-preview";
  element.hidden = true;
  let selectedRef: string | null = null;

  function render(card: AgentCardObservation, presentation: CardPresentation | null | undefined): void {
    element.replaceChildren();
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "table-preview-close";
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", "Close preview");
    closeButton.addEventListener("click", close);
    element.append(closeButton);

    const name = cardDisplayName(card);
    if (presentation?.imageUri) {
      const img = document.createElement("img");
      img.className = "table-preview-image";
      img.src = presentation.imageUri;
      img.alt = name;
      element.append(img);
    }
    const heading = document.createElement("h3");
    heading.className = "table-preview-name";
    heading.textContent = presentation?.manaCost ? `${name}   ${presentation.manaCost}` : name;
    element.append(heading);

    const typeLine = presentation?.typeLine ?? card.typeLine;
    if (typeLine) element.append(textLine("table-preview-type", typeLine));
    if (presentation?.oracleText) element.append(textLine("table-preview-text", presentation.oracleText));
    if (card.power !== null && card.toughness !== null) element.append(textLine("table-preview-pt", `${card.power}/${card.toughness}`));
    const counters = formatCounters(card.counters);
    if (counters) element.append(textLine("table-preview-counters", counters));
    if (card.tapped) element.append(textLine("table-preview-tapped", "Tapped"));
  }

  function close(): void {
    selectedRef = null;
    element.hidden = true;
    element.replaceChildren();
  }

  function togglePin(card: AgentCardObservation, presentation: CardPresentation | null | undefined): void {
    if (selectedRef === card.cardRef) {
      close();
      return;
    }
    selectedRef = card.cardRef;
    element.hidden = false;
    render(card, presentation);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && selectedRef) close();
  });

  return {
    element,
    isOpen: () => selectedRef !== null,
    isSelected: (cardRef) => selectedRef === cardRef,
    togglePin,
    close,
  };
}
