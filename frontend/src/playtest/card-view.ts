import { cardDisplayName, counterBadges } from "./card-format.js";
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
   * badge AND a subtle offset-frame "depth" decoration (V2e.6, purely visual — see
   * `.table-card--stacked` in tabletop.css). This card still represents exactly one shared display
   * signature; the underlying cardRefs it stands for are never collapsed into a single fake game
   * object anywhere outside this presentation layer.
   */
  count?: number;
  /**
   * V2e.6: true while Forge currently reports this card as a declared attacker/blocker
   * (`combat-selection.ts`) — a visual state entirely independent of `tapped`. Never set from any
   * local guess; only ever derived from Forge's own `selected` list.
   */
  combatSelected?: boolean;
}

/** Pure. The className applied to the actual `.table-card` element (never the optional outer slot). Summoning sickness (V2e.5) and combat-selection (V2e.6) are distinct, independent visual signals from tapped/selected — presentation only, Forge remains the sole authority on legality. */
export function tableCardClassName(
  card: Pick<AgentCardObservation, "tapped" | "summoningSick">,
  selected: boolean,
  extraClassName = "",
  modifiers: { combatSelected?: boolean; stacked?: boolean } = {},
): string {
  return [
    "table-card",
    card.tapped ? "table-card--tapped" : "",
    card.summoningSick ? "table-card--summoning-sick" : "",
    selected ? "table-card--selected" : "",
    modifiers.combatSelected ? "table-card--combat-selected" : "",
    modifiers.stacked ? "table-card--stacked" : "",
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
 * never clips or collides with neighbors. When no artwork is available, a plain placeholder shows
 * the visible name — or, for a Forge-reported token (`card.token`), a deliberate token-styled
 * fallback (name/type/P-T) instead of the generic grey placeholder (V2e.6) — never a broken-image
 * icon either way.
 *
 * `existingCardElement` (V2e.5): when supplied and shape-compatible (same button-vs-div tag,
 * already a `.table-card`), the SAME element is updated and returned in place instead of a new one
 * being created — this is what lets the tapped-rotation, summoning-sickness, and (V2e.6)
 * combat-selection CSS transitions actually animate (a brand-new element has no "before" state to
 * animate from). See `board-renderer.ts`'s reconciled battlefield rendering, which is the only
 * caller that passes it.
 */
export function createTableCard(
  card: AgentCardObservation,
  presentation: CardPresentation | null | undefined,
  options: TableCardOptions = {},
  existingCardElement?: HTMLElement,
): HTMLElement {
  const concealed = card.hidden || card.faceDown;
  const name = concealed ? "Face-down card" : cardDisplayName(card);
  if (concealed) presentation = null;
  const wantsButton = Boolean(options.onActivate);
  const canReuse = Boolean(
    existingCardElement
      && existingCardElement.classList.contains("table-card")
      && (wantsButton ? existingCardElement instanceof HTMLButtonElement : existingCardElement.tagName === "DIV"),
  );
  const element = canReuse ? existingCardElement! : document.createElement(wantsButton ? "button" : "div");
  const stacked = Boolean(options.count && options.count > 1);

  // Read the PREVIOUS render's counter badge text (if any) before we replace the element's
  // children below, so a genuinely changed value gets a brief emphasis pulse instead of a silent
  // update — never a full-card reanimation.
  const previousCounterTexts = canReuse
    ? Array.from(existingCardElement!.querySelectorAll(".table-card-counter")).map((el) => el.textContent)
    : [];

  element.dataset.cardRef = card.cardRef;
  element.className = tableCardClassName(card, Boolean(options.selected), options.className ?? "", { combatSelected: options.combatSelected, stacked });
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
  } else if (concealed) {
    face.classList.add("table-card-back");
    face.textContent = "◇";
  } else if (card.token) {
    // A Forge-reported token with no resolved art yet (V2e.6): a deliberate token-styled
    // treatment, never the generic grey placeholder or a broken-image icon. A later milestone may
    // resolve exact Scryfall token art; this is presentation-only either way.
    face.classList.add("table-card-face--token");
    const nameEl = document.createElement("span");
    nameEl.className = "table-card-token-name";
    nameEl.textContent = name;
    face.append(nameEl);
    if (card.typeLine) {
      const typeEl = document.createElement("span");
      typeEl.className = "table-card-token-type";
      typeEl.textContent = card.typeLine;
      face.append(typeEl);
    }
    if (card.power !== null && card.toughness !== null) {
      const ptEl = document.createElement("span");
      ptEl.className = "table-card-token-pt";
      ptEl.textContent = `${card.power}/${card.toughness}`;
      face.append(ptEl);
    }
  } else {
    face.classList.add("table-card-face--placeholder");
    const label = document.createElement("span");
    label.textContent = name;
    face.append(label);
  }

  const children: HTMLElement[] = [face];

  const badges = counterBadges(card.counters);
  if (badges.length > 0) {
    const counterStack = document.createElement("div");
    counterStack.className = "table-card-counters";
    badges.forEach((badge, index) => {
      const pill = document.createElement("span");
      pill.className = "table-card-counter";
      const text = badge.count > 1 ? `${badge.type} ×${badge.count}` : badge.type;
      pill.textContent = text;
      if (previousCounterTexts[index] !== undefined && previousCounterTexts[index] !== text) {
        pill.classList.add("table-card-counter--changed");
        setTimeout(() => pill.classList.remove("table-card-counter--changed"), 320);
      }
      counterStack.append(pill);
    });
    children.push(counterStack);
  }

  if (options.count && options.count > 1) {
    const badge = document.createElement("span");
    badge.className = "table-card-count";
    badge.textContent = `×${options.count}`;
    children.push(badge);
  }
  element.replaceChildren(...children);

  activationState.set(element, { card, onActivate: options.onActivate });
  if (options.onActivate && !hasClickListener.has(element)) {
    element.addEventListener("click", (event) => {
      event.stopPropagation();
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
