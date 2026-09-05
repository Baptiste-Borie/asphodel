import { validateChoice, type AgentChoice } from "../agent/baseline-agent.js";
import type { AgentObservation, ForgePendingExternalDecision } from "../forge/forge-protocol.js";
import { HumanEndMatchError, type HumanDecisionProvider } from "./human-decision-provider.js";

export type WebHumanDecisionErrorCode = "NO_PENDING_DECISION" | "STALE_DECISION";

export class WebHumanDecisionError extends Error {
  constructor(
    public readonly code: WebHumanDecisionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WebHumanDecisionError";
  }
}

/**
 * The browser's `HumanDecisionProvider`. `choose()` stores the current observation/decision and
 * returns a Promise that stays pending — exactly one at a time, since `runHumanVsAgentMatch` never
 * calls a provider's `choose()` again before the previous call resolves — until `submit()` is
 * called with a matching, `validateChoice`-legal `AgentChoice`, or `requestEnd()` interrupts it.
 * The browser can never invent a choice: `submit()` always re-validates against the exact pending
 * decision before anything reaches Forge, and a wrong/stale `decisionId` is rejected explicitly
 * with nothing submitted.
 */
export class WebHumanDecisionProvider implements HumanDecisionProvider {
  private pending:
    | {
        observation: AgentObservation;
        decision: ForgePendingExternalDecision;
        resolve: (choice: AgentChoice) => void;
        reject: (error: unknown) => void;
      }
    | undefined;
  private ended = false;

  async choose(observation: AgentObservation, decision: ForgePendingExternalDecision): Promise<AgentChoice> {
    if (this.ended) throw new HumanEndMatchError();
    return new Promise<AgentChoice>((resolve, reject) => {
      this.pending = { observation, decision, resolve, reject };
    });
  }

  /** The decision currently awaiting a browser answer, or null when it is not the human's turn. */
  current(): { observation: AgentObservation; decision: ForgePendingExternalDecision } | null {
    return this.pending ? { observation: this.pending.observation, decision: this.pending.decision } : null;
  }

  /** Answers the pending decision. Throws (submits nothing) on a stale id or an illegal choice. */
  submit(choice: AgentChoice): void {
    const pending = this.pending;
    if (!pending) throw new WebHumanDecisionError("NO_PENDING_DECISION", "There is no pending human decision to answer right now.");
    if (choice.decisionId !== pending.decision.decisionId) {
      throw new WebHumanDecisionError("STALE_DECISION", "This decision has already been answered or is no longer the current one.");
    }
    validateChoice(pending.decision, choice);
    this.pending = undefined;
    pending.resolve(choice);
  }

  /**
   * Requests a clean, non-error end of the match. If a decision is pending right now, its
   * `choose()` call is rejected immediately with `HumanEndMatchError`. Otherwise (Asphodel is
   * mid-turn) `endRequested()` below reports it on `runHumanVsAgentMatch`'s next loop check.
   */
  requestEnd(): void {
    this.ended = true;
    const pending = this.pending;
    if (pending) {
      this.pending = undefined;
      pending.reject(new HumanEndMatchError());
    }
  }

  /** Pass as `HumanVsAgentOptions.endRequested` so an end mid-Asphodel-turn is still honored. */
  readonly endRequested = (): boolean => this.ended;
}
