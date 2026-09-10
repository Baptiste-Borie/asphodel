import assert from "node:assert/strict";
import { it } from "node:test";
import { redactPendingPhysicalIdentity } from "./physical-observation-redaction.js";
import type { AgentCardObservation, AgentObservation, AgentSelfPlayerObservation } from "../forge/forge-protocol.js";

function card(overrides: Partial<AgentCardObservation> & { cardRef: string; zone: AgentCardObservation["zone"] }): AgentCardObservation {
  return {
    name: null, ownerId: "player-1", controllerId: "player-1", faceDown: false, hidden: false,
    tapped: null, summoningSick: null, counters: null, power: null, toughness: null, typeLine: null,
    ...overrides,
  };
}

function selfObservation(hand: AgentCardObservation[], overrides: Partial<Omit<AgentSelfPlayerObservation, "hand">> = {}): AgentObservation {
  const self: AgentSelfPlayerObservation = {
    role: "self", playerId: "player-1", name: "player-1", life: 40, startingLife: 40,
    handSize: hand.length, librarySize: 50, graveyardSize: 0, exileSize: 0, commandZoneSize: 0,
    battlefieldSize: 0, externalController: true, battlefield: [], graveyard: [], exile: [],
    command: [], commanders: [], hand, ...overrides,
  };
  return { gameRef: "g", game: { turn: 3, phase: "main1", activePlayerId: "player-1", priorityPlayerId: "player-1" }, selfPlayerId: "player-1", players: [self], stack: [] };
}

function selfHand(observation: AgentObservation): AgentCardObservation[] {
  return (observation.players.find(p => p.role === "self") as AgentSelfPlayerObservation).hand;
}

it("conceals a hand card not present in the last reconciled observation (the reported Whip of Erebos leak)", () => {
  const known = card({ cardRef: "forest-1", zone: "hand", name: "Forest", typeLine: "Basic Land — Forest" });
  const provisional = card({ cardRef: "provisional-1", zone: "hand", name: "Whip of Erebos", typeLine: "Legendary Enchantment" });
  const lastReconciled = selfObservation([known]);
  const pending = selfObservation([known, provisional]);

  const redacted = redactPendingPhysicalIdentity(pending, "draw", lastReconciled);
  const hand = selfHand(redacted);

  assert.equal(hand.length, 2, "zone size must never change — only identity");
  const stillKnown = hand.find(c => c.cardRef === "forest-1")!;
  assert.equal(stillKnown.name, "Forest", "an already-reconciled card must render exactly as before");
  const concealed = hand.find(c => c.cardRef === "provisional-1")!;
  assert.equal(concealed.name, null, "the undeclared provisional card's real name must never reach the DTO");
  assert.equal(concealed.hidden, true);
  assert.equal(concealed.typeLine, null, "no identifying field may survive concealment");
  assert.equal(JSON.stringify(redacted).includes("Whip of Erebos"), false, "the provisional name must not appear anywhere in the serialized observation");
});

it("conceals every card when there is no prior reconciled observation at all (opening hand, turn 1)", () => {
  const openingHand = [1, 2, 3, 4, 5, 6, 7].map(n => card({ cardRef: `card-${n}`, zone: "hand", name: `Real Card ${n}` }));
  const pending = selfObservation(openingHand);

  const redacted = redactPendingPhysicalIdentity(pending, "draw", null);
  const hand = selfHand(redacted);

  assert.equal(hand.length, 7);
  assert.ok(hand.every(c => c.name === null && c.hidden === true), "every undeclared opening-hand card must be concealed, not just the first");
});

it("leaves the observation untouched for an eventKind with no known target zone (never guesses)", () => {
  const pending = selfObservation([card({ cardRef: "c-1", zone: "hand", name: "Known" })]);
  const redacted = redactPendingPhysicalIdentity(pending, "library_event", null);
  assert.deepEqual(redacted, pending);
});

it("never conceals a battlefield/graveyard/etc. card for a 'draw' event — only the zone the event actually targets", () => {
  const battlefieldCard = card({ cardRef: "bf-1", zone: "battlefield", name: "Sol Ring" });
  const provisionalHandCard = card({ cardRef: "provisional-1", zone: "hand", name: "Whip of Erebos" });
  const lastReconciled = selfObservation([], { battlefield: [battlefieldCard] });
  const pending = selfObservation([provisionalHandCard], { battlefield: [battlefieldCard] });

  const redacted = redactPendingPhysicalIdentity(pending, "draw", lastReconciled);
  const self = redacted.players.find(p => p.role === "self") as AgentSelfPlayerObservation;

  assert.equal(self.battlefield[0]!.name, "Sol Ring", "a zone the event does not target must never be touched");
  assert.equal(selfHand(redacted)[0]!.name, null);
});
