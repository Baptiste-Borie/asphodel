import { createTableCard } from "./card-view.js";
import type { ManaPaymentGroups, ManaSourceGroup } from "./mana-payment-mapping.js";
import type { AgentChoice, CardPresentation, MenuItem } from "./types.js";

export interface ManaPaymentOverlay {
  element: HTMLElement;
  isOpen(): boolean;
  /**
   * Renders (or updates, if already open) the overlay for the CURRENT `mana_payment` decision.
   * `costText` is shown large and centered (e.g. "{2}{R}{R}"). `onSourceActivate` is called with a
   * source's exact cardRef, its full option list (verbatim from Forge), and the clicked card
   * element (for anchoring a follow-up color selector when there is more than one option) — the
   * caller (not this module) decides submit-directly-vs-open-a-selector, via the SAME
   * `decideCardAction` already used for every other card-driven decision. `onFloatingActivate` is
   * called with a floating-mana item's own already-complete choice.
   */
  render(
    costText: string,
    groups: ManaPaymentGroups,
    getPresentation: (name: string) => CardPresentation | null | undefined,
    onSourceActivate: (cardRef: string, options: MenuItem[], anchor: HTMLElement) => void,
    onFloatingActivate: (choice: AgentChoice) => void,
  ): void;
  close(): void;
}

function buildSection(heading: string): { section: HTMLElement; row: HTMLElement } {
  const section = document.createElement("section");
  section.className = "table-mana-overlay-section";
  section.hidden = true;
  const h = document.createElement("h3");
  h.textContent = heading;
  const row = document.createElement("div");
  row.className = "table-mana-overlay-cards";
  section.append(h, row);
  return { section, row };
}

/**
 * The dedicated visual mana-payment surface (V2e.5.1) — replaces the generic decision-dock button
 * list entirely for `mana_payment`. The tabletop stays visible behind a darkened/blurred backdrop;
 * every currently-legal mana source is a large real card (or, for floating mana, a simple chip —
 * there is no physical card to show). The card IS the control: clicking one submits Forge's own
 * mana option directly (a single-option source) or opens a small color selector for the exact
 * options Forge listed (a multi-color source) — this module never decides which, it only reports
 * the click upward. Nothing here invents a choice; every button/card maps to one of `groups`'
 * already-legal `MenuItem`s, copied verbatim.
 */
export function createManaPaymentOverlay(): ManaPaymentOverlay {
  const element = document.createElement("div");
  element.className = "table-mana-overlay";
  element.hidden = true;

  const backdrop = document.createElement("div");
  backdrop.className = "table-mana-overlay-backdrop";

  const surface = document.createElement("div");
  surface.className = "table-mana-overlay-surface";

  const title = document.createElement("h2");
  title.className = "table-mana-overlay-title";
  title.textContent = "Pay Mana";

  const cost = document.createElement("p");
  cost.className = "table-mana-overlay-cost";

  const landsSection = buildSection("Lands");
  const otherSection = buildSection("Other sources");
  const floatingSection = buildSection("Floating mana");

  const controls = document.createElement("div");
  controls.className = "table-mana-controls";
  surface.append(title, cost, landsSection.section, otherSection.section, floatingSection.section, controls);
  element.append(backdrop, surface);

  let open = false;
  let hasRenderedSinceOpen = false;

  function renderSourceRow(
    row: HTMLElement,
    groups: readonly ManaSourceGroup[],
    getPresentation: (name: string) => CardPresentation | null | undefined,
    onSourceActivate: (cardRef: string, options: MenuItem[], anchor: HTMLElement) => void,
    animateEntrance: boolean,
  ): void {
    row.replaceChildren();
    for (const group of groups) {
      const presentation = group.card.name ? getPresentation(group.card.name) : null;
      const cardElement = createTableCard(group.card, presentation, {
        className: "table-mana-source-card",
        onActivate: (_card, anchor) => onSourceActivate(group.cardRef, group.options, anchor),
      });
      if (animateEntrance) {
        cardElement.classList.add("table-mana-source-card--entering");
        requestAnimationFrame(() => requestAnimationFrame(() => cardElement.classList.remove("table-mana-source-card--entering")));
      }
      row.append(cardElement);
    }
  }

  function render(
    costText: string,
    groups: ManaPaymentGroups,
    getPresentation: (name: string) => CardPresentation | null | undefined,
    onSourceActivate: (cardRef: string, options: MenuItem[], anchor: HTMLElement) => void,
    onFloatingActivate: (choice: AgentChoice) => void,
  ): void {
    cost.textContent = costText;

    const animateEntrance = !hasRenderedSinceOpen;
    renderSourceRow(landsSection.row, groups.lands, getPresentation, onSourceActivate, animateEntrance);
    landsSection.section.hidden = groups.lands.length === 0;
    renderSourceRow(otherSection.row, groups.other, getPresentation, onSourceActivate, animateEntrance);
    otherSection.section.hidden = groups.other.length === 0;

    floatingSection.row.replaceChildren();
    controls.replaceChildren();
    for (const item of groups.floating) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "table-mana-floating-chip";
      chip.textContent = item.label;
      if (animateEntrance) {
        chip.classList.add("table-mana-source-card--entering");
        requestAnimationFrame(() => requestAnimationFrame(() => chip.classList.remove("table-mana-source-card--entering")));
      }
      chip.addEventListener("click", () => onFloatingActivate(item.choice));
      (item.control === "cancel" ? controls : floatingSection.row).append(chip);
    }
    floatingSection.section.hidden = !groups.floating.some(item => item.control !== "cancel");
    hasRenderedSinceOpen = true;

    element.hidden = false;
    if (!open) {
      element.classList.add("table-mana-overlay--hidden-visual");
      requestAnimationFrame(() => requestAnimationFrame(() => element.classList.remove("table-mana-overlay--hidden-visual")));
    }
    open = true;
  }

  function close(): void {
    if (!open) return;
    open = false;
    hasRenderedSinceOpen = false;
    element.classList.add("table-mana-overlay--hidden-visual");
    setTimeout(() => {
      if (!open) element.hidden = true;
    }, 220);
  }

  return { element, isOpen: () => open, render, close };
}
