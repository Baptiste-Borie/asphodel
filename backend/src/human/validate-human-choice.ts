import { validateChoice, type AgentChoice } from '../agent/baseline-agent.js';
import type { ForgePendingExternalDecision } from '../forge/forge-protocol.js';

/** Human-only opt-out. The frozen baseline and V2b agent continue selecting mana options. */
export function validateHumanChoice(decision: ForgePendingExternalDecision, choice: AgentChoice): void {
  if (decision.type === 'mana_payment' && decision.cancelChoiceId && choice.kind === 'mana'
    && choice.choice === decision.cancelChoiceId && choice.decisionId === decision.decisionId && choice.reason) return;
  validateChoice(decision, choice);
}
