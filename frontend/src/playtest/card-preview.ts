import { createTableCard } from "./card-view.js";
import { PreviewSelection } from "./preview-selection.js";
import type { AgentCardObservation, CardPresentation } from "./types.js";

export interface CardPreviewPanel {
  element: HTMLElement;
  isOpen(): boolean;
  isSelected(cardRef: string): boolean;
  /** Click/Enter on a battlefield card: pins it, or unpins (closes) if it is already the selected one. */
  togglePin(card: AgentCardObservation, presentation: CardPresentation | null | undefined): void;
  close(): void;
}

/**
 * The battlefield card inspector (V2e.3): no panel, no sidebar band, no border, no text block —
 * just the selected card itself, large, floating on the right, as if it were simply brought closer
 * to the player for a clear look. Rendered upright regardless of its real tapped state (inspecting
 * a card is about reading it, not re-representing board state the battlefield card already shows).
 * Hidden entirely — no permanent empty panel — until a card is selected. The hand is never reachable
 * here (see board-renderer.ts's renderHand, which never wires an onActivate for hand cards).
 */
export function createCardPreviewPanel(): CardPreviewPanel {
  const element = document.createElement("div");
  element.className = "table-preview";
  element.hidden = true;
  const selection = new PreviewSelection();

  function render(card: AgentCardObservation, presentation: CardPresentation | null | undefined): void {
    element.replaceChildren(createTableCard({ ...card, tapped: false }, presentation, { className: "table-preview-card" }));
  }

  function close(): void {
    selection.close();
    element.hidden = true;
    element.replaceChildren();
  }

  function togglePin(card: AgentCardObservation, presentation: CardPresentation | null | undefined): void {
    if (selection.toggle(card.cardRef) === "closed") {
      close();
      return;
    }
    element.hidden = false;
    render(card, presentation);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && selection.current()) close();
  });

  return {
    element,
    isOpen: () => selection.current() !== null,
    isSelected: (cardRef) => selection.isSelected(cardRef),
    togglePin,
    close,
  };
}
