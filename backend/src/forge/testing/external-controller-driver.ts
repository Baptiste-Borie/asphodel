import assert from "node:assert/strict";
import type { ForgeExternalMatchClient } from "../forge-external-match-client.js";
import type {
  ForgeExternalMatchSnapshot, ForgePendingExternalDecision,
} from "../forge-protocol.js";

export interface DecisionTraceEntry {
  turn: number;
  phase: string;
  player: string;
  type: ForgePendingExternalDecision["type"];
  decisionId: string;
  source: string | null;
  chosen: string | number;
}

/** Test-only protocol policy. All choices are taken from Forge's supplied options. */
export async function submitBaselineChoice(
  client: ForgeExternalMatchClient, sessionId: string, decision: ForgePendingExternalDecision,
): Promise<DecisionTraceEntry> {
  let chosen: string | number;
  let source: string | null = "source" in decision ? decision.source?.cardRef ?? null : null;
  switch (decision.type) {
    case "priority_action": {
      const option = decision.actions.find((a) => a.type === "play_land")
        ?? decision.actions.find((a) => a.type === "cast_spell" && a.sourceZone === "command")
        ?? decision.actions.find((a) => a.type === "cast_spell")
        ?? decision.actions.find((a) => a.type === "activate_ability")
        ?? decision.actions.find((a) => a.type === "pass");
      assert.ok(option);
      chosen = option.actionId;
      source = option.cardRef;
      await client.submitDecision(sessionId, decision.decisionId, chosen);
      break;
    }
    case "target_selection":
      chosen = decision.targets[0]?.targetId ?? decision.finishTargetId!;
      assert.ok(chosen);
      await client.submitTarget(sessionId, decision.decisionId, chosen);
      break;
    case "mode_selection":
      chosen = decision.modes[0]?.modeId ?? decision.finishModeId!;
      assert.ok(chosen);
      await client.submitMode(sessionId, decision.decisionId, chosen);
      break;
    case "value_selection":
      chosen = decision.minValue;
      await client.submitValue(sessionId, decision.decisionId, chosen);
      break;
    case "optional_cost_selection":
      chosen = decision.declineCostId;
      await client.submitOptionalCost(sessionId, decision.decisionId, chosen);
      break;
    case "cost_object_selection":
      chosen = decision.options[0]?.objectId ?? decision.finishChoiceId!;
      assert.ok(chosen);
      await client.submitCostObject(sessionId, decision.decisionId, chosen);
      break;
    case "mana_payment":
      chosen = decision.options[0]?.manaOptionId!;
      assert.ok(chosen);
      await client.submitManaOption(sessionId, decision.decisionId, chosen);
      break;
    case "attackers_selection":
    case "blockers_selection":
    case "combat_order_selection": {
      // Fixture policy: preserve creatures for subsequent attack turns when no blocks is legal.
      const option = (decision.type === "blockers_selection"
        ? decision.options.find((o) => o.operation === "finish") : undefined)
        ?? decision.options.find((o) => o.operation === "add" || o.operation === "order")
        ?? decision.options.find((o) => o.operation === "finish");
      assert.ok(option, "No constructive edit or legal finish in this fixture");
      chosen = option.objectId;
      source = option.cardRef;
      await client.submitCombatChoice(sessionId, decision.decisionId, chosen);
      break;
    }
    case "yes_no":
    case "object_selection":
    case "ordering_selection":
      chosen = decision.options[0]?.objectId!;
      assert.ok(chosen);
      await client.submitSelection(sessionId, decision.decisionId, chosen);
      break;
    default: {
      const exhaustive: never = decision;
      throw new Error(`Unhandled decision: ${JSON.stringify(exhaustive)}`);
    }
  }
  return {
    turn: decision.context.turn, phase: decision.context.phase, player: decision.playerId,
    type: decision.type, decisionId: decision.decisionId,
    source, chosen,
  };
}

export interface BaselineRun {
  latest: ForgeExternalMatchSnapshot;
  trace: DecisionTraceEntry[];
  observations: { turn: number; life: number[]; battlefield: number; graveyard: number; commanders: string[]; commanderCasts: number; goblinTokens: number }[];
}

export async function driveBaseline(
  client: ForgeExternalMatchClient, sessionId: string,
  limits = { maxDecisions: 5000, maxSteps: 12000, timeoutMs: 90_000 },
): Promise<BaselineRun> {
  const trace: DecisionTraceEntry[] = [];
  const observations: BaselineRun["observations"] = [];
  const seen = new Set<string>();
  const deadline = Date.now() + limits.timeoutMs;
  let latest: ForgeExternalMatchSnapshot | undefined;
  const fail = (reason: string): never => {
    throw new Error(`${reason}: ${JSON.stringify({ latestObservation: latest?.observation,
      latestPendingDecision: latest?.pendingDecision, recentTrace: trace.slice(-20), status: latest?.status })}`);
  };
  for (let step = 0; step < limits.maxSteps; step++) {
    if (Date.now() >= deadline) fail("External controller time watchdog exceeded");
    latest = await client.get(sessionId);
    if (latest.status === "completed") return { latest, trace, observations };
    if (latest.status === "failed" || latest.status === "cancelled") fail("Unexpected terminal state");
    const decision = latest.pendingDecision;
    if (!decision || seen.has(decision.decisionId)) {
      await new Promise((resolve) => setTimeout(resolve, 2));
      continue;
    }
    if (trace.length >= limits.maxDecisions) fail("External controller decision watchdog exceeded");
    assert.ok(latest.observation);
    assert.equal(decision.context.turn, latest.observation.game.turn);
    assert.equal(decision.context.phase, latest.observation.game.phase);
    assert.equal(decision.playerId, latest.observation.selfPlayerId);
    // The actual NDJSON response must preserve every published field.
    assert.deepEqual(JSON.parse(JSON.stringify(decision)), decision);
    observations.push({ turn: decision.context.turn,
      life: latest.observation.players.map((p) => p.life),
      battlefield: latest.observation.players.reduce((sum, p) => sum + p.battlefield.length, 0),
      graveyard: latest.observation.players.reduce((sum, p) => sum + p.graveyard.length, 0),
      commanderCasts: latest.observation.players.reduce((total, p) => total + p.commanders.reduce((sum, c) => sum + c.castsFromCommand, 0), 0),
      goblinTokens: latest.observation.players.filter((p) => p.role === "self").reduce((total, p) => total + p.battlefield.filter((c) => c.name === "Goblin Token").length, 0),
      commanders: latest.observation.players.flatMap((p) => p.commanders.map((c) => c.cardRef)),
    });
    seen.add(decision.decisionId);
    trace.push(await submitBaselineChoice(client, sessionId, decision));
  }
  return fail("External controller step watchdog exceeded");
}
