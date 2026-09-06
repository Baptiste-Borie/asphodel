import { computeBattlefieldScale } from "./battlefield-scale.js";
import { groupCards, type CardGroup } from "./card-grouping.js";
import { createTableCard } from "./card-view.js";
import type { AgentCardObservation, AgentObservation, AgentPlayerObservation, CardPresentation } from "./types.js";

export interface BoardCallbacks {
  getPresentation: (name: string) => CardPresentation | null | undefined;
  /** Battlefield/commander cards only — the hand never pins the preview. */
  onCardActivate: (card: AgentCardObservation, element: HTMLElement) => void;
  isSelected: (card: AgentCardObservation) => boolean;
  /** V2e.5: true while this card has a mapped legal action for the CURRENT selection decision (attackers/blockers/targets/cost-object) — gets the same clickable highlight as a playable hand card. Omitted (or always false) outside such a decision. */
  isPlayable?: (card: AgentCardObservation) => boolean;
}

/** Pure. "main1" -> "Main 1", "combat_damage" -> "Combat Damage". */
export function formatPhase(phase: string): string {
  return phase
    .replace(/([a-z])(\d)/i, "$1 $2")
    .split("_")
    .map((word) => word[0]!.toUpperCase() + word.slice(1))
    .join(" ");
}

export function selfPlayer(observation: AgentObservation): AgentPlayerObservation | undefined {
  return observation.players.find((p) => p.playerId === observation.selfPlayerId);
}

export function opponentPlayer(observation: AgentObservation): AgentPlayerObservation | undefined {
  return observation.players.find((p) => p.playerId !== observation.selfPlayerId);
}

/**
 * Forge's own internal command-zone bookkeeping objects (e.g. the per-player commander-tax
 * tracker, literally named "Commander Effect") — never a real, physical card. Kept exactly as
 * Forge reports it in the protocol/engine data; only ever filtered out of the physical tabletop
 * representation itself, never from `AgentObservation`/`player.command` upstream of this module.
 */
const ENGINE_PSEUDO_CARD_NAMES = new Set<string>(["Commander Effect"]);

/** Pure. The command zone's real, renderable cards — see ENGINE_PSEUDO_CARD_NAMES. Uses the actual current zone state Forge reported; never derived/faked from a decklist. */
export function commandZoneCards(player: AgentPlayerObservation): AgentCardObservation[] {
  return player.command.filter((card) => card.name === null || !ENGINE_PSEUDO_CARD_NAMES.has(card.name));
}

/** Pure. Every publicly-named card in the observation (never a hidden/null name) — the exact and only set of names the card-presentation batch endpoint is ever asked about. */
export function collectVisibleCardNames(observation: AgentObservation): string[] {
  const names = new Set<string>();
  for (const player of observation.players) {
    const zones = [player.battlefield, player.graveyard, player.exile, commandZoneCards(player), ...(player.role === "self" ? [player.hand] : [])];
    for (const zone of zones) for (const card of zone) if (card.name) names.add(card.name);
  }
  return [...names];
}

function presentationFor(card: AgentCardObservation, callbacks: BoardCallbacks): CardPresentation | null | undefined {
  return card.name ? callbacks.getPresentation(card.name) : null;
}

/** One "row" of cards to reconcile: a display group in the default (collapsed) case, or a single real card (count 1) while `expand` is active for a selection decision — see `renderCardRow`. */
function rowsFor(cards: readonly AgentCardObservation[], expand: boolean): CardGroup[] {
  if (!expand) return groupCards(cards);
  return cards.map((card) => ({ key: card.cardRef, representative: card, cardRefs: [card.cardRef], count: 1 }));
}

/**
 * Reconciles one zone's cards/groups into `container`'s direct children, keyed by `CardGroup.key`
 * (a display-group signature normally, or a raw cardRef while `expand`ed for a selection decision
 * — see `rowsFor`). Existing DOM nodes are REUSED across renders for an unchanged key (see
 * `createTableCard`'s `existingCardElement` parameter) — this is what lets the tapped-rotation and
 * summoning-sickness CSS transitions actually animate, instead of restarting from nowhere on every
 * poll. A brand-new key gets a short CSS "entering" transition (card placed onto the table); a
 * group whose visible count just changed gets a brief count-emphasis pulse, never a full
 * battlefield re-animation.
 */
function renderCardRow(container: HTMLElement, groups: CardGroup[], callbacks: BoardCallbacks, extraClassName = ""): void {
  const existingByKey = new Map<string, HTMLElement>();
  for (const child of Array.from(container.children)) {
    const key = child.getAttribute("data-key");
    if (!key) continue;
    const inner = child.classList.contains("table-card-slot") ? (child.firstElementChild as HTMLElement | null) : (child as HTMLElement);
    if (inner) existingByKey.set(key, inner);
  }

  const nextChildren: HTMLElement[] = [];
  for (const group of groups) {
    const card = group.representative;
    const existingInner = existingByKey.get(group.key);
    const previousCountText = existingInner?.querySelector(".table-card-count")?.textContent ?? null;

    const className = [extraClassName, callbacks.isPlayable?.(card) ? "table-card--playable" : ""].filter(Boolean).join(" ");
    const root = createTableCard(card, presentationFor(card, callbacks), {
      onActivate: callbacks.onCardActivate,
      selected: callbacks.isSelected(card),
      className,
      useSlot: true,
      count: group.count,
    }, existingInner);
    root.setAttribute("data-key", group.key);

    if (!existingInner) {
      root.classList.add("table-card--entering");
      requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("table-card--entering")));
    } else {
      const newCountText = group.count > 1 ? `×${group.count}` : null;
      if (newCountText !== null && newCountText !== previousCountText) {
        const badge = root.querySelector(".table-card-count");
        badge?.classList.add("table-card-count--changed");
        setTimeout(() => badge?.classList.remove("table-card-count--changed"), 320);
      }
    }
    nextChildren.push(root);
  }
  container.replaceChildren(...nextChildren);
}

/**
 * One player's battlefield permanents only — commanders live in `renderCommanderDock` instead,
 * never merged into this row. Identical permanents/tokens sharing the same visible state (name,
 * tapped, summoning sickness, power/toughness, counters, token-status) are shown as one stacked
 * card with a "×N" count (`card-grouping.ts`) — Forge identities are never merged, only the
 * display. Card size/overlap adapt to how many VISUAL groups are on the table
 * (`computeBattlefieldScale`): a handful stay full-size, a crowded board packs tighter before ever
 * shrinking the cards themselves. `expand` (V2e.5): while a decision needs individual objects
 * (attackers/blockers/targets/cost-object selection), every real card is shown ungrouped so it can
 * be clicked as its own exact Forge choice — never "one fake stacked object".
 */
export function renderBattlefieldHalf(container: HTMLElement, player: AgentPlayerObservation, callbacks: BoardCallbacks, expand = false): void {
  const groups = rowsFor(player.battlefield, expand);
  const scale = computeBattlefieldScale(groups.length);
  container.style.setProperty("--bf-card-width", `${scale.cardWidthPx}px`);
  container.style.setProperty("--bf-card-overlap", `${scale.overlapPx}px`);
  renderCardRow(container, groups, callbacks);
}

/**
 * The player's real commander(s) (multiple supported, if Forge ever reports more than one),
 * pinned next to their life total. Reflects Forge's own current `command` zone state exactly — it
 * empties the instant a commander is cast (it then simply appears on the battlefield via the
 * normal observation) and refills the instant Forge returns it to the command zone; nothing here
 * is derived from a decklist. `expand` (V2e.5): see `renderBattlefieldHalf`.
 */
export function renderCommanderDock(container: HTMLElement, player: AgentPlayerObservation, callbacks: BoardCallbacks, expand = false): void {
  const groups = rowsFor(commandZoneCards(player), expand);
  renderCardRow(container, groups, callbacks, "table-card--commander");
}

/** The human's hand as a fanned/overlapping row of real cards — read via hover (CSS-only rise+scale), never pinned to the preview panel. A playable card (see HandActionCallbacks) gets a distinct highlight and becomes clickable; every other card is unaffected. */
export interface HandActionCallbacks {
  isPlayable: (card: AgentCardObservation) => boolean;
  onActivate: (card: AgentCardObservation, element: HTMLElement) => void;
}

export function renderHand(
  container: HTMLElement,
  hand: AgentCardObservation[],
  getPresentation: (name: string) => CardPresentation | null | undefined,
  handActions?: HandActionCallbacks,
): void {
  container.replaceChildren();
  for (const card of hand) {
    const playable = handActions?.isPlayable(card) ?? false;
    container.append(createTableCard(card, card.name ? getPresentation(card.name) : null, {
      className: playable ? "table-card--hand table-card--playable" : "table-card--hand",
      ...(playable && handActions ? { onActivate: handActions.onActivate } : {}),
    }));
  }
}
