import { createTableCard } from "./card-view.js";
import { PreviewSelection } from "./preview-selection.js";
import { KEYWORD_HELP, keywordIconSpecs } from './card-icons.js';
import { statPlaque } from './card-state.js';
import type { AgentCardObservation, AgentObservation, CardPresentation } from "./types.js";

export interface CardPreviewPanel {
  element: HTMLElement;
  isOpen(): boolean;
  isSelected(cardRef: string): boolean;
  /** The cardRef currently pinned, or null — lets a caller look up whether it maps to a CURRENT legal Forge action (V2f.1), without this module needing to know anything about decisions/actions itself. */
  current(): string | null;
  /** Click/Enter on a battlefield card: pins it, or unpins (closes) if it is already the selected one. */
  togglePin(card: AgentCardObservation, presentation: CardPresentation | null | undefined): void;
  close(): void;
  showHover(card: AgentCardObservation, presentation: CardPresentation | null | undefined): void;
  leaveHover(): void;
  refresh(observation: AgentObservation, presentation: (name: string) => CardPresentation | null | undefined): void;
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

/** Physical uses a transient/pinned state rail; Digital retains its printed-card inspector. */
export function createCardPreviewPanel(): CardPreviewPanel {
  const element = document.createElement("div");
  element.className = "table-preview";
  element.hidden = true;
  const selection = new PreviewSelection();
  let actionButton: HTMLButtonElement | null = null;
  type PreviewEntry = { card: AgentCardObservation; presentation: CardPresentation | null | undefined };
  let pinned: PreviewEntry | null = null;
  let hovered: PreviewEntry | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | undefined;
  const isPhysical = () => Boolean(element.closest('.table-root--physical'));
  const syncLayout = () => {
    const root = element.closest('.table-root--physical');
    root?.classList.toggle('physical-inspecting', !element.hidden);
    root?.classList.toggle('physical-inspection-pinned', !element.hidden && Boolean(pinned));
  };
  // The button element is created once and reused across renders (so it never flickers while the
  // same card stays previewed); the trigger it invokes must therefore always be read fresh here —
  // never captured once in the listener's closure — the same staleness guard `card-view.ts` uses
  // for its own reused elements.
  let currentTrigger: ((buttonElement: HTMLElement) => void) | null = null;

  function render(card: AgentCardObservation, presentation: CardPresentation | null | undefined): void {
    actionButton = null; // the card element itself is being replaced; any previous button goes with it.
    element.replaceChildren(createTableCard({ ...card, tapped: false }, presentation, { className: "table-preview-card" }));
    if (isPhysical()) {
      const header = document.createElement('div'); header.className = 'inspection-header';
      const label = document.createElement('span'); label.textContent = hovered ? 'CARD INSPECTION' : 'PINNED CARD';
      const pin = document.createElement('button'); pin.type = 'button'; pin.textContent = hovered ? 'Pin' : 'Close ×';
      pin.onclick = () => { if (hovered) togglePin(hovered.card, hovered.presentation); else close(); };
      header.append(label, pin); element.prepend(header);
      const details = document.createElement('section'); details.className = 'inspection-state';
      const heading = document.createElement('h3'); heading.textContent = 'Current state'; details.append(heading);
      const row = (label: string, description?: string) => {
        const item = document.createElement('div'); item.className = 'inspection-state-row';
        const title = document.createElement('strong'); title.textContent = label; item.append(title);
        if (description) { const text = document.createElement('p'); text.textContent = description; item.append(text); }
        details.append(item);
      };
      if (!card.hidden && !card.faceDown) {
        row(card.name ?? 'Card', `${card.typeLine ?? presentation?.typeLine ?? ''} · ${card.zone}`);
        if (card.power != null && card.toughness != null) {
          details.append(statPlaque(card));
          row(`Base ${card.basePower ?? '—'} / ${card.baseToughness ?? '—'}`, card.basePower == null || card.baseToughness == null ? 'A numeric base is not available for every characteristic.' : undefined);
        }
        if (card.tapped != null) row(card.tapped ? 'Tapped' : 'Untapped');
        if (card.summoningSick) row('◷ Summoning sickness', KEYWORD_HELP.sick);
        for (const spec of keywordIconSpecs(card.combatKeywords)) row(spec.label, KEYWORD_HELP[spec.keyword]);
        for (const [type, count] of Object.entries(card.counters ?? {})) if (count) row(`${type} counter ×${count}`);
        const source = Array.from(element.closest('.table-root')?.querySelectorAll<HTMLElement>('.physical-scene [data-card-ref]') ?? []).find(node => node.dataset.cardRef === card.cardRef);
        const combat = source?.querySelector('.table-card-combat-tag')?.textContent;
        if (combat) row(combat);
        if (!presentation?.imageUri && presentation?.oracleText) row('Card text', presentation.oracleText);
      } else row('Face-down card', 'Identity is not visible.');
      element.append(details);
    }
    element.hidden = false;
    syncLayout();
    element.dispatchEvent(new Event('inspectionchange'));
  }

  function close(): void {
    selection.close();
    clearTimeout(hideTimer);
    hovered = null;
    pinned = null;
    element.hidden = true;
    element.replaceChildren();
    actionButton = null;
    currentTrigger = null;
    syncLayout();
  }

  function togglePin(card: AgentCardObservation, presentation: CardPresentation | null | undefined): void {
    clearTimeout(hideTimer);
    hovered = null;
    if (selection.toggle(card.cardRef) === "closed") {
      close();
      return;
    }
    element.hidden = false;
    pinned = { card, presentation };
    render(card, presentation);
  }

  function setActionable(label: string | null, onTrigger: ((buttonElement: HTMLElement) => void) | null): void {
    if (hovered || !selection.current() || !label || !onTrigger) {
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
    if (event.key === "Escape" && !element.hidden) close();
  });

  function leaveHover(): void {
    if (!isPhysical()) return;
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      hovered = null;
      if (pinned) render(pinned.card, pinned.presentation);
      else { element.hidden = true; element.replaceChildren(); syncLayout(); }
    }, 240);
  }
  element.addEventListener('pointerenter', () => clearTimeout(hideTimer));
  element.addEventListener('pointerleave', leaveHover);
  element.addEventListener('focusin', () => clearTimeout(hideTimer));
  element.addEventListener('focusout', event => { if (!(event.relatedTarget instanceof Node) || !element.contains(event.relatedTarget)) leaveHover(); });

  return {
    element,
    isOpen: () => selection.current() !== null,
    isSelected: (cardRef) => selection.isSelected(cardRef),
    current: () => selection.current(),
    togglePin,
    close,
    setActionable,
    showHover: (card, presentation) => {
      clearTimeout(hideTimer);
      if (selection.current() === card.cardRef) {
        hovered = null;
        if (pinned) render(pinned.card, pinned.presentation);
        return;
      }
      hovered = { card, presentation }; render(card, presentation);
    },
    leaveHover,
    refresh: (observation, getPresentation) => {
      if (element.hidden || !isPhysical()) return;
      const cards = observation.players.flatMap(player => [...player.battlefield, ...player.graveyard, ...player.exile, ...player.command, ...(player.role === 'self' ? player.hand : [])]);
      const update = (entry: PreviewEntry | null): PreviewEntry | null => {
        if (!entry) return null;
        const card = cards.find(card => card.cardRef === entry.card.cardRef);
        return card && !card.hidden && !card.faceDown ? { card, presentation: card.name ? getPresentation(card.name) : null } : null;
      };
      pinned = update(pinned); hovered = update(hovered);
      if (!pinned) selection.close();
      const visible = hovered ?? pinned;
      if (visible) render(visible.card, visible.presentation); else close();
    },
  };
}
