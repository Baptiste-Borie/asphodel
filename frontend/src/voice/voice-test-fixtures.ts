/** Shared test-only fixtures for the voice module's tests. Not itself a *.test.ts — imported by the others. */
import type { AgentCardObservation, AgentObservation, AgentSelfPlayerObservation, MenuItem, WebPendingDecisionDTO } from "../playtest/types.js";

export function fakeCard(cardRef: string, name: string, overrides: Partial<AgentCardObservation> = {}): AgentCardObservation {
  return {
    cardRef, name, zone: "battlefield", ownerId: "player-1", controllerId: "player-1", faceDown: false, hidden: false,
    tapped: null, summoningSick: null, counters: null, power: null, toughness: null, typeLine: null,
    ...overrides,
  };
}

export function fakeObservation(opts: {
  selfHand?: AgentCardObservation[];
  selfBattlefield?: AgentCardObservation[];
  opponentBattlefield?: AgentCardObservation[];
  selfName?: string;
  opponentName?: string;
} = {}): AgentObservation {
  const self: AgentSelfPlayerObservation = {
    role: "self", playerId: "player-1", name: opts.selfName ?? "You", life: 40, startingLife: 40,
    handSize: (opts.selfHand ?? []).length, librarySize: 0, graveyardSize: 0, exileSize: 0, commandZoneSize: 0,
    battlefieldSize: (opts.selfBattlefield ?? []).length, externalController: false,
    battlefield: opts.selfBattlefield ?? [], graveyard: [], exile: [], command: [], commanders: [], hand: opts.selfHand ?? [],
  };
  const opponent = {
    role: "opponent" as const, playerId: "player-2", name: opts.opponentName ?? "Asphodel", life: 40, startingLife: 40,
    handSize: 0, librarySize: 0, graveyardSize: 0, exileSize: 0, commandZoneSize: 0,
    battlefieldSize: (opts.opponentBattlefield ?? []).length, externalController: true,
    battlefield: opts.opponentBattlefield ?? [], graveyard: [], exile: [], command: [], commanders: [],
  };
  return {
    gameRef: "g1",
    game: { turn: 1, phase: "main1", activePlayerId: "player-1", priorityPlayerId: "player-1" },
    selfPlayerId: "player-1",
    players: [self, opponent],
    stack: [],
  };
}

export function fakeMenuItem(label: string, choiceId: string, opts: Partial<MenuItem> & { decisionId?: string } = {}): MenuItem {
  const { decisionId = "d-1", ...rest } = opts;
  return { label, choice: { decisionId, kind: "action", choice: choiceId, reason: "human_choice" }, ...rest };
}

export function fakePendingMenu(type: string, items: MenuItem[], title = "Choose", decisionId = "d-1"): WebPendingDecisionDTO {
  return {
    decisionId,
    type,
    context: { turn: 1, phase: "main1", activePlayerId: "player-1", priorityPlayerId: "player-1", stackSize: 0 },
    rendered: { kind: "menu", title, items },
    selectedCardRefs: null,
    combatPairings: null,
  };
}

export function fakePendingValue(min: number, max: number, suggested: number[] = [], decisionId = "d-1"): WebPendingDecisionDTO {
  return {
    decisionId,
    type: "value_selection",
    context: { turn: 1, phase: "main1", activePlayerId: "player-1", priorityPlayerId: "player-1", stackSize: 0 },
    rendered: { kind: "value", title: "Choose a value", decisionId, min, max, suggested },
    selectedCardRefs: null,
    combatPairings: null,
  };
}
