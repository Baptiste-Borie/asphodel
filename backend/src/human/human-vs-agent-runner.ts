import { validateHumanChoice } from "./validate-human-choice.js";
import type { AgentMatchTransport, AgentTraceEntry } from "../agent/agent-runner.js";
import { AgentRunError, gameMetrics, submitExternalChoice } from "../agent/agent-runner.js";
import { validateChoice, type AgentChoice, type AsphodelAgent } from "../agent/baseline-agent.js";
import type { AgentObservation, ForgeDeckSpec, ForgeExternalMatchSnapshot, ForgePendingExternalDecision, ForgePendingPhysicalIdentityDecision } from "../forge/forge-protocol.js";
import { AgentCastLoopGuard } from "./agent-loop-guard.js";
import { HumanEndMatchError, type HumanDecisionProvider } from "./human-decision-provider.js";
import { autoPassChoice } from "./priority-auto-pass.js";
import { isPhysicalEndMatchError, type PhysicalCardProvider } from "../physical/physical-card-provider.js";

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
  /**
   * Polled once per loop iteration (in addition to `signal`) so a deliberate end can be honored
   * even while it is Asphodel's turn — not only while a human decision is actively pending. A
   * `HumanDecisionProvider` (e.g. `WebHumanDecisionProvider`) can still reject its own in-flight
   * `choose()` with `HumanEndMatchError` directly for an immediate end while it IS the human's turn;
   * this predicate is what catches an end requested at any other moment.
   */
  endRequested?: () => boolean;
  /** Read-only hook after an accepted submission; never routing/policy input for either side. */
  onDecision?: (owner: DecisionOwner, observation: AgentObservation, decision: ForgePendingExternalDecision, choice: AgentChoice) => void;
  /**
   * V2g Physical Companion. When set, `humanPlayerId`'s hidden-zone events are externalized as
   * `physical_identity_declare` decisions (see forge-protocol.ts) and answered through this
   * narrow, transport-agnostic seam instead of `human`'s ordinary `choose()` — see
   * `physicalCardProvider` dispatch below. Undefined keeps digital mode exactly as before.
   */
  physicalCardProvider?: PhysicalCardProvider;
  /** Read-only diagnostic hook: every physical declaration actually submitted, in order. */
  onPhysicalDeclaration?: (decision: ForgePendingPhysicalIdentityDecision, declaredNames: string[]) => void;
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
  const { sessionId } = await client.startSpecs(...decks, {
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    seats: ["external", "external"],
    mulliganPlayerId: humanPlayerId,
    ...(options.physicalCardProvider ? { physicalPlayerId: humanPlayerId } : {}),
  });
  const started = Date.now();
  const trace: AgentTraceEntry[] = [];
  const seen = new Set<string>();
  // V2e.6.1 §§8-13: infrastructure guard, scoped to this one match, protecting only Asphodel's own
  // priority_action decisions against a failed-cast no-progress loop. Never applied to the human.
  const agentCastLoopGuard = new AgentCastLoopGuard();
  let latest: ForgeExternalMatchSnapshot | undefined;
  let idle = 0;
  try {
    while (true) {
      options.signal?.throwIfAborted();
      if (options.endRequested?.()) throw new HumanEndMatchError();
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
        // A sole forced pass (no other legal priority action) never reaches the human at all —
        // Forge's own rendered options decide this, never a guess about strategic usefulness.
        const forcedPass = owner === "human" ? autoPassChoice(d) : null;
        // V2g: a physical_identity_declare always belongs to humanPlayerId (only the physical seat
        // ever produces one), and is answered through the narrow PhysicalCardProvider seam instead
        // of the human's ordinary decision channel — never both, never a guess about which applies.
        const choice = forcedPass ?? (
          owner === "human" && d.type === "physical_identity_declare" && options.physicalCardProvider
            ? await answerPhysicalDeclaration(options.physicalCardProvider, d, observation, options.onPhysicalDeclaration)
            : owner === "human" ? await human.choose(observation, d)
            : d.type === "priority_action"
              ? agentCastLoopGuard.wrapPriorityDecision(observation, d, (filtered) => agent.choose(observation, filtered))
              : agent.choose(observation, d));
        if (owner === "human") validateHumanChoice(d, choice);
        else validateChoice(d, choice);
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
    if ((cause instanceof HumanEndMatchError || isPhysicalEndMatchError(cause)) && latest) {
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

/**
 * V2g: converts one `physical_identity_declare` decision into the narrow `PhysicalCardRequest`,
 * awaits a `PhysicalCardSelection` through the transport-agnostic `PhysicalCardProvider` seam, and
 * wraps the result back into an ordinary `AgentChoice` so the rest of the loop (validation,
 * submission, tracing) never needs to know this decision was answered differently.
 */
async function answerPhysicalDeclaration(
  provider: PhysicalCardProvider,
  decision: ForgePendingPhysicalIdentityDecision,
  observation: AgentObservation,
  onPhysicalDeclaration: HumanVsAgentOptions["onPhysicalDeclaration"],
): Promise<AgentChoice> {
  const selection = await provider.chooseCard({
    decisionId: decision.decisionId,
    playerId: decision.playerId,
    context: decision.context,
    eventKind: decision.eventKind,
    count: decision.count,
    candidates: decision.candidates,
  }, observation);
  onPhysicalDeclaration?.(decision, selection.declaredNames);
  return { decisionId: decision.decisionId, kind: "physical_identity", declaredNames: selection.declaredNames, reason: "physical_declaration" };
}
