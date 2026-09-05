import type { AgentChoice } from "../agent/baseline-agent.js";
import type { ForgePendingExternalDecision as Decision } from "../forge/forge-protocol.js";

/**
 * Pure, backend-side safety check: a human `priority_action` decision is auto-passable only when
 * Forge's own rendered legal options contain nothing but the pass action itself — never a guess
 * about whether some other available action is worth taking. Any other decision family, or any
 * priority decision that also offers a real action, always stops for the human unchanged.
 *
 * Returns the exact Forge-supplied pass choice to submit, or null when the human must decide.
 */
export function autoPassChoice(decision: Decision): AgentChoice | null {
  if (decision.type !== "priority_action") return null;
  if (decision.actions.length !== 1) return null;
  const [only] = decision.actions;
  if (only!.type !== "pass") return null;
  return { decisionId: decision.decisionId, kind: "action", choice: only!.actionId, reason: "auto_pass_no_other_legal_action" };
}
