import type { AgentMatchTransport, AgentTraceEntry } from "../agent/agent-runner.js";
import { AgentRunError, gameMetrics, submitExternalChoice } from "../agent/agent-runner.js";
import { validateChoice, type AgentChoice, type AsphodelAgent } from "../agent/baseline-agent.js";
import type { AgentObservation, ForgeDeckSpec, ForgeExternalMatchSnapshot, ForgePendingExternalDecision } from "../forge/forge-protocol.js";
import { HumanEndMatchError, type HumanDecisionProvider } from "./human-decision-provider.js";

export type DecisionOwner = "human" | "agent";

export interface HumanVsAgentResult {
  sessionId: string;
  snapshot: ForgeExternalMatchSnapshot;
  trace: AgentTraceEntry[];
  metrics: ReturnType<typeof gameMetrics>;
  /** true when the human typed "end"/"quit"; false for a natural Forge terminal result. Never both. */
  endedByHuman: boolean;
}

export interface HumanVsAgentOptions {
  seed?: number;
  timeoutMs?: number;
  maxDecisions?: number;
  maxIdlePolls?: number;
  pollIntervalMs?: number;
  signal?: AbortSignal;
  /** Read-only hook after an accepted submission; never routing/policy input for either side. */
  onDecision?: (owner: DecisionOwner, observation: AgentObservation, decision: ForgePendingExternalDecision, choice: AgentChoice) => void;
}

/**
 * Routes every pending external decision to whichever seat owns it: the human provider for
 * `humanPlayerId`, `agent.choose` for `agentPlayerId`, and a hard failure for anything else. Both
 * seats are started as `external` (see forge-protocol.ts `ForgeMatchSeatController`), so Forge
 * itself supplies a correctly player-scoped `AgentObservation` for whichever side is currently
 * asked — this function never builds or reshapes an observation itself. Submission reuses
 * `submitExternalChoice` (V2b's agent runner) so the selector-family switch is not duplicated.
 */
export async function runHumanVsAgentMatch(
  client: AgentMatchTransport,
  human: HumanDecisionProvider,
  agent: AsphodelAgent,
  decks: [ForgeDeckSpec, ForgeDeckSpec],
  humanPlayerId: string,
  agentPlayerId: string,
  options: HumanVsAgentOptions = {},
): Promise<HumanVsAgentResult> {
  const timeoutMs = options.timeoutMs ?? 3_600_000;
  const maxDecisions = options.maxDecisions ?? 20_000;
  const maxIdlePolls = options.maxIdlePolls ?? 5_000;
  const pollIntervalMs = options.pollIntervalMs ?? 20;
  if (![timeoutMs, maxDecisions, maxIdlePolls].every(n => Number.isSafeInteger(n) && n > 0)
      || !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs < 0) throw new Error("human_vs_agent_invalid_run_limits");
  options.signal?.throwIfAborted();
  const { sessionId } = await client.startSpecs(...decks, { ...(options.seed === undefined ? {} : { seed: options.seed }), seats: ["external", "external"] });
  const started = Date.now();
  const trace: AgentTraceEntry[] = [];
  const seen = new Set<string>();
  let latest: ForgeExternalMatchSnapshot | undefined;
  let idle = 0;
  try {
    while (true) {
      options.signal?.throwIfAborted();
      if (Date.now() - started >= timeoutMs) throw new Error("human_vs_agent_timeout");
      latest = await client.get(sessionId);
      if (latest.sessionId !== sessionId) throw new Error("human_vs_agent_session_mismatch");
      if (latest.status === "completed") {
        if (!latest.result?.gameOver) throw new Error("human_vs_agent_missing_terminal_result");
        return { sessionId, snapshot: latest, trace, metrics: gameMetrics(latest, trace, agentPlayerId), endedByHuman: false };
      }
      if (latest.status === "failed" || latest.status === "cancelled") throw new Error(`human_vs_agent_match_${latest.status}: ${latest.error?.message ?? ""}`);
      const d = latest.pendingDecision, observation = latest.observation;
      if (latest.status === "waiting_for_decision" && (!d || !observation)) throw new Error("human_vs_agent_missing_decision_observation");
      if (d && observation && !seen.has(d.decisionId)) {
        if (trace.length >= maxDecisions) throw new Error("human_vs_agent_decision_limit");
        if (d.playerId !== observation.selfPlayerId || d.context.turn !== observation.game.turn
          || d.context.phase !== observation.game.phase) throw new Error("human_vs_agent_incoherent_observation");
        const owner: DecisionOwner = d.playerId === humanPlayerId ? "human" : d.playerId === agentPlayerId ? "agent" : (() => {
          throw new Error(`human_vs_agent_unknown_decision_owner: ${d.playerId}`);
        })();
        const choice = owner === "human" ? await human.choose(observation, d) : agent.choose(observation, d);
        validateChoice(d, choice);
        options.signal?.throwIfAborted();
        await submitExternalChoice(client, sessionId, d, choice);
        trace.push({ turn: d.context.turn, phase: d.context.phase, type: d.type, choice });
        options.onDecision?.(owner, observation, d, choice);
        seen.add(d.decisionId);
        idle = 0;
      } else if (++idle >= maxIdlePolls) throw new Error("human_vs_agent_idle_limit");
      await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
  } catch (cause) {
    if (cause instanceof HumanEndMatchError && latest) {
      // A deliberate "end"/"quit" is not a failure: cancel Forge cleanly (best-effort — a
      // secondary cancellation problem must not turn an intentional end into an error) and
      // return normally with the last snapshot and every already-recorded decision intact.
      try { await client.cancel(sessionId); } catch { /* best-effort cancel on a deliberate end */ }
      return { sessionId, snapshot: latest, trace, metrics: gameMetrics(latest, trace, agentPlayerId), endedByHuman: true };
    }
    let cancellationError: unknown;
    try { await client.cancel(sessionId); } catch (error) { cancellationError = error; }
    throw new AgentRunError(cause instanceof Error ? cause.message : "human_vs_agent_run_failed", sessionId,
      trace.slice(-20), latest, { cause: cancellationError ? new AggregateError([cause, cancellationError], "run_and_cancel_failed") : cause });
  }
}
