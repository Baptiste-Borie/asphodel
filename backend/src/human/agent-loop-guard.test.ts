import assert from "node:assert/strict";
import { it } from "node:test";
import { AgentCastLoopGuard } from "./agent-loop-guard.js";
import type {
  AgentObservation,
  AgentSelfPlayerObservation,
  ForgeExternalAction,
  ForgePendingDecision,
} from "../forge/forge-protocol.js";

function observation(turn: number, hand: AgentSelfPlayerObservation["hand"]): AgentObservation {
  const context = { turn, phase: "main1", activePlayerId: "agent-1", priorityPlayerId: "agent-1" };
  const self: AgentSelfPlayerObservation = {
    role: "self", playerId: "agent-1", name: "agent-1", life: 40, startingLife: 40,
    handSize: hand.length, librarySize: 50, graveyardSize: 0, exileSize: 0, commandZoneSize: 1,
    battlefieldSize: 0, externalController: true, hand, battlefield: [], graveyard: [], exile: [],
    command: [], commanders: [],
  };
  const { hand: _hand, ...publicSelf } = self;
  return {
    selfPlayerId: "agent-1", gameRef: "game", game: context, stack: [],
    players: [self, { ...publicSelf, role: "opponent", playerId: "human-1", name: "human-1", externalController: false, battlefield: [] }],
  };
}

const passAction: ForgeExternalAction = {
  actionId: "pass", type: "pass", label: "Pass priority", cardRef: null, cardName: null,
  sourceZone: null, abilityText: null, manaCost: null, requiresTargets: false,
};

function castAction(suffix: string, cardRef: "card-x" | "card-y"): ForgeExternalAction {
  return {
    actionId: `cast-${cardRef}-${suffix}`, type: "cast_spell", label: `Cast ${cardRef}`,
    cardRef, cardName: cardRef === "card-x" ? "Spell X" : "Spell Y", sourceZone: "hand",
    abilityText: null, manaCost: "{1}", requiresTargets: false,
  };
}

/** Every offering re-derives fresh actionIds (Forge regenerates them every time) but the same
 * cardRef/sourceZone/manaCost — i.e. Forge still considers the same cast legal again. */
function decision(turn: number, suffix: string, options: { x?: boolean; y?: boolean } = {}): ForgePendingDecision {
  const { x = true, y = true } = options;
  const actions = [passAction, ...(x ? [castAction(suffix, "card-x")] : []), ...(y ? [castAction(suffix, "card-y")] : [])];
  return {
    decisionId: `d-${turn}-${suffix}`, type: "priority_action", playerId: "agent-1",
    context: { turn, phase: "main1", activePlayerId: "agent-1", priorityPlayerId: "agent-1", stackSize: 0 },
    actions,
  };
}

function cardRefsOf(d: ForgePendingDecision): (string | null)[] {
  return d.actions.map((a) => (a.type === "cast_spell" ? a.cardRef : a.type));
}

const handWithBoth = [
  { cardRef: "card-x", name: "Spell X", zone: "hand" as const, ownerId: "agent-1", controllerId: "agent-1", faceDown: false, hidden: false, tapped: false, summoningSick: null, counters: null, power: null, toughness: null, typeLine: "Creature" },
  { cardRef: "card-y", name: "Spell Y", zone: "hand" as const, ownerId: "agent-1", controllerId: "agent-1", faceDown: false, hidden: false, tapped: false, summoningSick: null, counters: null, power: null, toughness: null, typeLine: "Creature" },
];

it("V2e.6.1 §§9-11: a repeated failed cast is excluded from the next same-state offering, the next candidate then also gets a chance, and everything resets once the state actually changes", () => {
  const guard = new AgentCastLoopGuard();
  const obsS1 = observation(5, handWithBoth);
  const seenActions: (string | null)[][] = [];
  const pick = (d: ForgePendingDecision) => {
    seenActions.push(cardRefsOf(d));
    const nonPass = d.actions.find((a) => a.type !== "pass");
    const chosen = nonPass ?? d.actions.find((a) => a.type === "pass")!;
    return { decisionId: d.decisionId, kind: "action" as const, choice: chosen.actionId, reason: "greedy" };
  };

  const d1 = decision(5, "1");
  const c1 = guard.wrapPriorityDecision(obsS1, d1, pick);
  assert.equal(c1.choice, "cast-card-x-1", "nothing failed yet: X is offered and chosen first");

  // Forge regenerates ids for the SAME priority state — X is still uncast (the mana payment
  // rolled the cast back), so it is offered again; the guard must exclude it this time.
  const d2 = decision(5, "2");
  const c2 = guard.wrapPriorityDecision(obsS1, d2, pick);
  assert.deepEqual(seenActions[1], ["pass", "card-y"], "X must be filtered out of the view handed to the policy");
  assert.equal(c2.choice, "cast-card-y-2", "the policy naturally falls through to Y");

  // Y also fails to complete from the exact same state.
  const d3 = decision(5, "3");
  const c3 = guard.wrapPriorityDecision(obsS1, d3, pick);
  assert.deepEqual(seenActions[2], ["pass"], "both X and Y are now excluded — only Pass remains");
  assert.equal(c3.choice, "pass");

  // A genuinely new state (turn advanced): the failure memory must not leak forward, so X is a
  // real option again if Forge legally offers it.
  const obsS2 = observation(6, handWithBoth);
  const d4 = decision(6, "4");
  const c4 = guard.wrapPriorityDecision(obsS2, d4, pick);
  assert.deepEqual(seenActions[3], ["pass", "card-x", "card-y"], "a new state clears the guard's memory");
  assert.equal(c4.choice, "cast-card-x-4");
});

it("V2e.6.1 §11: Pass is never remembered as a failed cast", () => {
  const guard = new AgentCastLoopGuard();
  const obs = observation(5, handWithBoth);
  const pickPass = (d: ForgePendingDecision) => ({ decisionId: d.decisionId, kind: "action" as const, choice: d.actions.find((a) => a.type === "pass")!.actionId, reason: "r" });
  guard.wrapPriorityDecision(obs, decision(5, "1"), pickPass);
  // Same state recurs (e.g. the opponent acted and priority simply returned) with X still legal —
  // since the PREVIOUS choice was Pass (not a cast), X must not have been marked as failed.
  const d2 = decision(5, "2");
  const seen: (string | null)[] = [];
  guard.wrapPriorityDecision(obs, d2, (d) => {
    seen.push(...cardRefsOf(d));
    return { decisionId: d.decisionId, kind: "action", choice: d.actions.find((a) => a.type === "pass")!.actionId, reason: "r" };
  });
  assert.deepEqual(seen, ["pass", "card-x", "card-y"]);
});

it("V2e.6.1 §13: the hard safety fuse throws if a policy ignores the filtered view and resubmits an already-excluded semantic cast a second time from the same state", () => {
  const guard = new AgentCastLoopGuard();
  const obs = observation(5, handWithBoth);
  const alwaysCastX = (d: ForgePendingDecision) => {
    // Deliberately broken: ignores whatever it was actually offered and always tries to reach for
    // "the X action for this exact decision" (still resolvable off the ORIGINAL/unfiltered decision
    // passed to wrapPriorityDecision, exactly as a real bug bypassing the filtered view might).
    return { decisionId: d.decisionId, kind: "action" as const, choice: `cast-card-x-${d.decisionId.split("-").pop()}`, reason: "broken" };
  };
  guard.wrapPriorityDecision(obs, decision(5, "1"), alwaysCastX); // X chosen, nothing failed yet
  guard.wrapPriorityDecision(obs, decision(5, "2"), alwaysCastX); // X marked failed, but re-submitted anyway
  assert.throws(
    () => guard.wrapPriorityDecision(obs, decision(5, "3"), alwaysCastX),
    /human_vs_agent_semantic_cast_loop_detected/,
  );
});
