import assert from "node:assert/strict";
import { it } from "node:test";
import { sanitizeAgentObservation } from "./public-game-frame.js";
import type { AgentCardObservation, AgentObservation, AgentSelfPlayerObservation } from "../forge/forge-protocol.js";

const AGENT_SECRET_CARD = "Asphodel's Actual Secret Hand Card";
const HUMAN_HAND_CARD = "The Human's Own Hand Card";

function agentHandCard(): AgentCardObservation {
  return { cardRef: "agent-hand-1", name: AGENT_SECRET_CARD, zone: "hand", ownerId: "player-2", controllerId: "player-2", faceDown: false, hidden: false, tapped: null, summoningSick: null, counters: null, power: null, toughness: null, typeLine: "Creature" };
}
function humanHandCard(): AgentCardObservation {
  return { cardRef: "human-hand-1", name: HUMAN_HAND_CARD, zone: "hand", ownerId: "player-1", controllerId: "player-1", faceDown: false, hidden: false, tapped: null, summoningSick: null, counters: null, power: null, toughness: null, typeLine: "Instant" };
}
function battlefieldPermanent(ref: string, name: string, ownerId: string): AgentCardObservation {
  return { cardRef: ref, name, zone: "battlefield", ownerId, controllerId: ownerId, faceDown: false, hidden: false, tapped: false, summoningSick: false, counters: null, power: 2, toughness: 2, typeLine: "Creature" };
}

/** An Asphodel-self AgentObservation, exactly as Forge hands it to the agent seat: self=Asphodel (hand fully visible to itself), opponent=human (structurally no hand field at all). */
function agentSelfObservation(): AgentObservation {
  const agentSelf: AgentSelfPlayerObservation = {
    role: "self", playerId: "player-2", name: "player-2", life: 38, startingLife: 40,
    handSize: 1, librarySize: 60, graveyardSize: 0, exileSize: 0, commandZoneSize: 0, battlefieldSize: 1,
    externalController: true, hand: [agentHandCard()],
    battlefield: [battlefieldPermanent("agent-bf-1", "Forest", "player-2")],
    graveyard: [], exile: [], command: [], commanders: [],
  };
  return {
    gameRef: "g", game: { turn: 3, phase: "main1", activePlayerId: "player-2", priorityPlayerId: "player-2" },
    selfPlayerId: "player-2",
    players: [
      agentSelf,
      {
        role: "opponent", playerId: "player-1", name: "player-1", life: 40, startingLife: 40,
        handSize: 1, librarySize: 61, graveyardSize: 0, exileSize: 0, commandZoneSize: 0, battlefieldSize: 1,
        externalController: true, battlefield: [battlefieldPermanent("human-bf-1", "Plains", "player-1")],
        graveyard: [], exile: [], command: [], commanders: [],
      },
    ],
    stack: [],
  };
}

it("relabels selfPlayerId to the human and keeps both players' public zones", () => {
  const sanitized = sanitizeAgentObservation(agentSelfObservation(), "player-1", [humanHandCard()]);
  assert.equal(sanitized.selfPlayerId, "player-1");
  const human = sanitized.players.find(p => p.playerId === "player-1")!;
  const agent = sanitized.players.find(p => p.playerId === "player-2")!;
  assert.equal(human.role, "self");
  assert.equal(agent.role, "opponent");
  assert.equal(human.battlefield[0]?.name, "Plains");
  assert.equal(agent.battlefield[0]?.name, "Forest");
});

it("restores the human's own hand from the supplied last-known copy", () => {
  const sanitized = sanitizeAgentObservation(agentSelfObservation(), "player-1", [humanHandCard()]);
  const human = sanitized.players.find(p => p.playerId === "player-1")! as AgentSelfPlayerObservation;
  assert.equal(human.hand.length, 1);
  assert.equal(human.hand[0]?.name, HUMAN_HAND_CARD);
});

it("never carries Asphodel's own hand field on the sanitized opponent entry", () => {
  const sanitized = sanitizeAgentObservation(agentSelfObservation(), "player-1", []);
  const agent = sanitized.players.find(p => p.playerId === "player-2")!;
  assert.equal((agent as unknown as { hand?: unknown }).hand, undefined);
});

it("security: JSON.stringify of the sanitized frame never contains Asphodel's real hand card name", () => {
  const sanitized = sanitizeAgentObservation(agentSelfObservation(), "player-1", [humanHandCard()]);
  const serialized = JSON.stringify(sanitized);
  assert.ok(!serialized.includes(AGENT_SECRET_CARD), "Asphodel's secret hand card must never appear in a sanitized frame");
  assert.ok(serialized.includes(HUMAN_HAND_CARD), "the human's own hand should still be present");
});

it("throws rather than silently producing an incomplete frame if either player is missing", () => {
  const broken: AgentObservation = { ...agentSelfObservation(), players: [agentSelfObservation().players[0]!] };
  assert.throws(() => sanitizeAgentObservation(broken, "player-1", []));
});
