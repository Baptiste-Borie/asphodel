import type { AgentObservation, ForgePendingExternalDecision } from "../forge/forge-protocol.js";
import type { AgentChoice } from "../agent/baseline-agent.js";

/**
 * A human-choice abstraction, deliberately separate from any rendering technology. The
 * orchestrator (`human-vs-agent-runner.ts`) calls `choose` with exactly the two DTOs Forge
 * externalizes for the decision owner and submits the returned choice through the same
 * validated path as the agent. Implementations must select only from options the decision
 * itself supplies — never invent a target, card, mana option or attacker.
 *
 * `TerminalHumanDecisionProvider` is today's only interactive implementation. A future
 * frontend implementation would satisfy this same interface without touching the
 * orchestrator, the bridge, or the Forge session classes.
 */
export interface HumanDecisionProvider {
  choose(observation: AgentObservation, decision: ForgePendingExternalDecision): Promise<AgentChoice>;
}
