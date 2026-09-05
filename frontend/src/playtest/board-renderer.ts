import { createTableCard } from "./card-view.js";
import type { AgentCardObservation, AgentObservation, AgentPlayerObservation, CardPresentation } from "./types.js";

export interface BoardCallbacks {
  getPresentation: (name: string) => CardPresentation | null | undefined;
  /** Battlefield cards only — the hand never pins the preview. */
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

/** Pure. Every publicly-named card in the observation (never a hidden/null name) — the exact and only set of names the card-presentation batch endpoint is ever asked about. */
export function collectVisibleCardNames(observation: AgentObservation): string[] {
  const names = new Set<string>();
  for (const player of observation.players) {
    const zones = [player.battlefield, player.graveyard, player.exile, player.command, ...(player.role === "self" ? [player.hand] : [])];
    for (const zone of zones) for (const card of zone) if (card.name) names.add(card.name);
  }
  return [...names];
}

function presentationFor(card: AgentCardObservation, callbacks: BoardCallbacks): CardPresentation | null | undefined {
  return card.name ? callbacks.getPresentation(card.name) : null;
}

/** One player's half of the table: command zone (if any) plus battlefield, as real card images. Only the battlefield/command — hand, graveyard etc. are rendered elsewhere (rail/hand strip). */
export function renderBattlefieldHalf(container: HTMLElement, player: AgentPlayerObservation, callbacks: BoardCallbacks): void {
  container.replaceChildren();
  const cards = [...player.command, ...player.battlefield];
  for (const card of cards) {
    container.append(createTableCard(card, presentationFor(card, callbacks), {
      onActivate: callbacks.onCardActivate,
      selected: callbacks.isSelected(card),
    }));
  }
}

/** The human's hand as a fanned/overlapping row of real cards — read via hover (CSS-only rise+scale), never pinned to the preview panel. */
export function renderHand(container: HTMLElement, hand: AgentCardObservation[], getPresentation: (name: string) => CardPresentation | null | undefined): void {
  container.replaceChildren();
  for (const card of hand) {
    container.append(createTableCard(card, card.name ? getPresentation(card.name) : null, { className: "table-card--hand" }));
  }
}
