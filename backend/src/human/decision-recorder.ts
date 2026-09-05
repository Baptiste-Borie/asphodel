import type { AgentObservation, ForgePendingExternalDecision } from "../forge/forge-protocol.js";
import type { AgentChoice } from "../agent/baseline-agent.js";

export interface RecordedDecision {
  /** Human-referenceable id ("A0001", "A0002", ...) — what Baptiste quotes back to analyze a decision. */
  reportId: string;
  timestamp: string;
  observation: AgentObservation;
  decision: ForgePendingExternalDecision;
  choice: AgentChoice;
}

/**
 * Records every decision Asphodel actually made, driven from `runHumanVsAgentMatch`'s existing
 * `onDecision` hook — no second game state, no re-derivation. Only ever call `record` for
 * `owner === "agent"`. Each observation is exactly the one Forge already scoped to Asphodel (see
 * V2c's observation-isolation guarantee); this class never merges in anything from the human
 * seat, so the recorded JSON carries no human hand identity, same as V2c's live observations.
 */
export class DecisionRecorder {
  private readonly decisions: RecordedDecision[] = [];

  record(observation: AgentObservation, decision: ForgePendingExternalDecision, choice: AgentChoice): void {
    const reportId = `A${String(this.decisions.length + 1).padStart(4, "0")}`;
    // structuredClone isolates the stored copy from any later mutation of the live objects.
    this.decisions.push({ reportId, timestamp: new Date().toISOString(), ...structuredClone({ observation, decision, choice }) });
  }

  all(): readonly RecordedDecision[] {
    return this.decisions;
  }
}
