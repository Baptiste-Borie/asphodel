import { createTableCard } from "./card-view.js";
import { PreviewSelection } from "./preview-selection.js";
import type { AgentCardObservation, CardPresentation } from "./types.js";

export interface CardPreviewPanel {
  element: HTMLElement;
  isOpen(): boolean;
  isSelected(cardRef: string): boolean;
  /** The cardRef currently pinned, or null — lets a caller look up whether it maps to a CURRENT legal Forge action (V2f.1), without this module needing to know anything about decisions/actions itself. */
  current(): string | null;
  /** Click/Enter on a battlefield card: pins it, or unpins (closes) if it is already the selected one. */
  togglePin(card: AgentCardObservation, presentation: CardPresentation | null | undefined): void;
  close(): void;
  /**
   * Shows (or updates, or removes when either argument is `null`) a small, explicit control for the
   * CURRENTLY previewed card's legal Forge action(s) (V2f.1 §§1-2). Inspecting a card and a legal
   * action existing for that same card are independent states: `togglePin` ALWAYS just opens,
   * closes, or switches the preview — it never submits anything — so a card having a legal action
   * never makes it impossible to simply read it first. This control is the one deliberate, separate
   * step that actually triggers the action; a single legal action never auto-submits merely from
   * the click that opened the preview. Safe to call on every render — a stale mapping from a
   * since-changed decision, or nothing currently previewed at all, just removes the control.
   */
  setActionable(label: string | null, onTrigger: ((buttonElement: HTMLElement) => void) | null): void;
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
  let actionButton: HTMLButtonElement | null = null;
  // The button element is created once and reused across renders (so it never flickers while the
  // same card stays previewed); the trigger it invokes must therefore always be read fresh here —
  // never captured once in the listener's closure — the same staleness guard `card-view.ts` uses
  // for its own reused elements.
  let currentTrigger: ((buttonElement: HTMLElement) => void) | null = null;

  function render(card: AgentCardObservation, presentation: CardPresentation | null | undefined): void {
    actionButton = null; // the card element itself is being replaced; any previous button goes with it.
    element.replaceChildren(createTableCard({ ...card, tapped: false }, presentation, { className: "table-preview-card" }));
  }

  function close(): void {
    selection.close();
    element.hidden = true;
    element.replaceChildren();
    actionButton = null;
    currentTrigger = null;
  }

  function togglePin(card: AgentCardObservation, presentation: CardPresentation | null | undefined): void {
    if (selection.toggle(card.cardRef) === "closed") {
      close();
      return;
    }
    element.hidden = false;
    render(card, presentation);
  }

  function setActionable(label: string | null, onTrigger: ((buttonElement: HTMLElement) => void) | null): void {
    if (!selection.current() || !label || !onTrigger) {
      actionButton?.remove();
      actionButton = null;
      currentTrigger = null;
      return;
    }
    currentTrigger = onTrigger;
    if (!actionButton) {
      actionButton = document.createElement("button");
      actionButton.type = "button";
      actionButton.className = "table-preview-action";
      actionButton.addEventListener("click", (event) => {
        event.stopPropagation();
        currentTrigger?.(actionButton!);
      });
      element.append(actionButton);
    }
    actionButton.textContent = label;
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && selection.current()) close();
  });

  return {
    element,
    isOpen: () => selection.current() !== null,
    isSelected: (cardRef) => selection.isSelected(cardRef),
    current: () => selection.current(),
    togglePin,
    close,
    setActionable,
  };
}
