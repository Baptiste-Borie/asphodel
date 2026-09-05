import type { ForgeExternalMatchClient } from "../forge/forge-external-match-client.js";
import type { AgentObservation, ForgeDeckSpec, ForgeExternalMatchSnapshot, ForgePendingExternalDecision } from "../forge/forge-protocol.js";
import { validateChoice, type AgentChoice, type AsphodelAgent } from "./baseline-agent.js";

export type AgentMatchTransport = Pick<ForgeExternalMatchClient, "startSpecs" | "get" | "cancel" | "submitDecision" | "submitTarget" | "submitMode" | "submitValue" | "submitOptionalCost" | "submitCostObject" | "submitManaOption" | "submitSelection">;
export interface AgentTraceEntry {
  turn: number;
  phase: string;
  type: ForgePendingExternalDecision["type"];
  choice: AgentChoice;
}
export interface AgentRunOptions {
  seed?: number;
  timeoutMs?: number;
  maxDecisions?: number;
  maxIdlePolls?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  /** Read-only diagnostic hook after an accepted submission; never policy input. */
  onDecision?: (observation: AgentObservation, decision: ForgePendingExternalDecision, choice: AgentChoice) => void;
}

export function gameMetrics(snapshot: ForgeExternalMatchSnapshot, trace: AgentTraceEntry[], selfPlayerId: string) {
  const counts: Record<string, number> = {};
  for (const entry of trace) counts[entry.type] = (counts[entry.type] ?? 0) + 1;
  const fallbackCounts: Record<string, number> = {};
  for (const fallback of snapshot.forgeAiStrategicFallbacks) {
    const key = `${fallback.family}:${fallback.method}`;
    fallbackCounts[key] = (fallbackCounts[key] ?? 0) + 1;
  }
  const telemetry = snapshot.publicTelemetry?.[selfPlayerId];
  return {
    selfPlayerId, turns: snapshot.result?.turns ?? snapshot.observation?.game.turn ?? trace.at(-1)?.turn ?? 0,
    externalDecisions: trace.length, decisionTypeCounts: counts,
    spellsCast: snapshot.progress.spellsCast, landsPlayed: snapshot.progress.landsPlayed,
    attacks: telemetry ? telemetry.attacks ?? 0 : null, blocks: telemetry ? telemetry.blocks ?? 0 : null,
    damageToPlayers: telemetry ? telemetry.damageToPlayers ?? 0 : null,
    damageToCards: telemetry ? telemetry.damageToCards ?? 0 : null,
    damageDealt: telemetry ? (telemetry.damageToPlayers ?? 0) + (telemetry.damageToCards ?? 0) : null,
    commanderCasts: telemetry ? telemetry.commanderCasts ?? 0 : null,
    result: snapshot.result ?? null, fallbackCounts,
    manaFallbacks: snapshot.progress.manaPaymentsFallbackToAi,
  };
}

export class AgentRunError extends Error {
  constructor(message: string, readonly sessionId: string, readonly recentTrace: AgentTraceEntry[], readonly snapshot: ForgeExternalMatchSnapshot | undefined, options?: ErrorOptions) {
    super(message, options);
  }
}

/** Owns one external match. Errors/abort/watchdogs cancel it; bridge process lifecycle belongs to caller. */
export async function runAgentMatch(client: AgentMatchTransport, agent: AsphodelAgent,
  decks: [ForgeDeckSpec, ForgeDeckSpec], options: AgentRunOptions = {}) {
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxDecisions = options.maxDecisions ?? 5000;
  const maxIdlePolls = options.maxIdlePolls ?? 5000;
  const pollIntervalMs = options.pollIntervalMs ?? 2;
  if (![timeoutMs, maxDecisions, maxIdlePolls].every(n => Number.isSafeInteger(n) && n > 0)
      || !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0) throw new Error("agent_invalid_run_limits");
  options.signal?.throwIfAborted();
  const { sessionId } = await client.startSpecs(...decks, options.seed === undefined ? {} : { seed: options.seed });
  const started = Date.now();
  const trace: AgentTraceEntry[] = [];
  const seen = new Set<string>();
  let latest: ForgeExternalMatchSnapshot | undefined;
  let selfPlayerId = "";
  let idle = 0;
  try {
    while (true) {
      options.signal?.throwIfAborted();
      if (Date.now() - started >= timeoutMs) throw new Error("agent_timeout");
      latest = await client.get(sessionId);
      if (latest.sessionId !== sessionId) throw new Error("agent_session_mismatch");
      if (latest.status === "completed") {
        if (!latest.result?.gameOver) throw new Error("agent_missing_terminal_result");
        return { sessionId, snapshot: latest, trace, metrics: gameMetrics(latest, trace, selfPlayerId) };
      }
      if (latest.status === "failed" || latest.status === "cancelled") throw new Error(`agent_match_${latest.status}: ${latest.error?.message ?? ""}`);
      const d = latest.pendingDecision, observation = latest.observation;
      if (latest.status === "waiting_for_decision" && (!d || !observation)) throw new Error("agent_missing_decision_observation");
      if (d && observation && !seen.has(d.decisionId)) {
        if (trace.length >= maxDecisions) throw new Error("agent_decision_limit");
        if (d.playerId !== observation.selfPlayerId || d.context.turn !== observation.game.turn
          || d.context.phase !== observation.game.phase) throw new Error("agent_incoherent_observation");
        selfPlayerId = observation.selfPlayerId;
        const choice = agent.choose(observation, d);
        validateChoice(d, choice);
        options.signal?.throwIfAborted();
        switch (choice.kind) {
          case "action": await client.submitDecision(sessionId, d.decisionId, choice.choice); break;
          case "target": await client.submitTarget(sessionId, d.decisionId, choice.choice); break;
          case "mode": await client.submitMode(sessionId, d.decisionId, choice.choice); break;
          case "value": await client.submitValue(sessionId, d.decisionId, choice.choice); break;
          case "optional_cost": await client.submitOptionalCost(sessionId, d.decisionId, choice.choice); break;
          case "mana": await client.submitManaOption(sessionId, d.decisionId, choice.choice); break;
          case "object":
            if (d.type === "cost_object_selection") await client.submitCostObject(sessionId, d.decisionId, choice.choice);
            else await client.submitSelection(sessionId, d.decisionId, choice.choice);
        }
        trace.push({ turn: d.context.turn, phase: d.context.phase, type: d.type, choice });
        options.onDecision?.(observation, d, choice);
        seen.add(d.decisionId);
        idle = 0;
      } else if (++idle >= maxIdlePolls) throw new Error("agent_idle_limit");
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  } catch (cause) {
    let cancellationError: unknown;
    try { await client.cancel(sessionId); } catch (error) { cancellationError = error; }
    throw new AgentRunError(cause instanceof Error ? cause.message : "agent_run_failed", sessionId,
      trace.slice(-20), latest, { cause: cancellationError ? new AggregateError([cause, cancellationError], "run_and_cancel_failed") : cause });
  }
}
