import { computeBattlefieldScale } from "./battlefield-scale.js";
import { createTableCard } from "./card-view.js";
import type { AgentCardObservation, AgentObservation, AgentPlayerObservation, CardPresentation } from "./types.js";

export interface BoardCallbacks {
  getPresentation: (name: string) => CardPresentation | null | undefined;
  /** Battlefield/commander cards only — the hand never pins the preview. */
  onCardActivate: (card: AgentCardObservation) => void;
  isSelected: (card: AgentCardObservation) => boolean;
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

/**
 * One player's battlefield permanents only — commanders live in `renderCommanderDock` instead,
 * never merged into this row. Card size/overlap adapt to how many permanents are actually on the
 * table (`computeBattlefieldScale`): a handful stay full-size, a crowded board packs tighter
 * before ever shrinking the cards themselves.
 */
export function renderBattlefieldHalf(container: HTMLElement, player: AgentPlayerObservation, callbacks: BoardCallbacks): void {
  container.replaceChildren();
  const cards = player.battlefield;
  const scale = computeBattlefieldScale(cards.length);
  container.style.setProperty("--bf-card-width", `${scale.cardWidthPx}px`);
  container.style.setProperty("--bf-card-overlap", `${scale.overlapPx}px`);
  for (const card of cards) {
    container.append(createTableCard(card, presentationFor(card, callbacks), {
      onActivate: callbacks.onCardActivate,
      selected: callbacks.isSelected(card),
      useSlot: true,
    }));
  }
}

/**
 * The player's real commander(s) (multiple supported, if Forge ever reports more than one),
 * pinned next to their life total. Reflects Forge's own current `command` zone state exactly — it
 * empties the instant a commander is cast (it then simply appears on the battlefield via the
 * normal observation) and refills the instant Forge returns it to the command zone; nothing here
 * is derived from a decklist.
 */
export function renderCommanderDock(container: HTMLElement, player: AgentPlayerObservation, callbacks: BoardCallbacks): void {
  container.replaceChildren();
  for (const card of commandZoneCards(player)) {
    container.append(createTableCard(card, presentationFor(card, callbacks), {
      onActivate: callbacks.onCardActivate,
      selected: callbacks.isSelected(card),
      useSlot: true,
      className: "table-card--commander",
    }));
  }
}

/**
 * A playable hand card, and what clicking it does — supplied only while a `priority_action`
 * decision is genuinely showing (see `hand-action-mapping.ts` and `playtest-view.ts`); `undefined`
 * at every other time (mid-frame-playback, a non-priority decision, no decision at all), in which
 * case every hand card renders exactly as before: hover-only, never clickable.
 */
export interface HandActionCallbacks {
  isPlayable: (card: AgentCardObservation) => boolean;
  onActivate: (card: AgentCardObservation, element: HTMLElement) => void;
}

/** The human's hand as a fanned/overlapping row of real cards — read via hover (CSS-only rise+scale), never pinned to the preview panel. A playable card (see HandActionCallbacks) gets a distinct highlight and becomes clickable; every other card is unaffected. */
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
