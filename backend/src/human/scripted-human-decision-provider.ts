import type { AgentObservation, ForgePendingExternalDecision as Decision } from "../forge/forge-protocol.js";
import type { AgentChoice } from "../agent/baseline-agent.js";
import type { HumanDecisionProvider } from "./human-decision-provider.js";

/**
 * A deterministic, always-legal stand-in for a human — for tests and CI, where no real stdin
 * exists. It is deliberately NOT the Asphodel policy: no scoring, no target/mana/combat
 * heuristics, just "take the first offered forward-progress option, otherwise finish." This is
 * enough to reliably develop a board, cast spells and enter combat in a real Forge game without
 * duplicating V2b's agent logic. Every choice is built strictly from options the decision itself
 * supplies; an optional `override` lets a specific test steer one decision type deterministically
 * while everything else still comes from this default script.
 */
export class ScriptedHumanDecisionProvider implements HumanDecisionProvider {
  constructor(
    private readonly override?: (observation: AgentObservation, decision: Decision) => AgentChoice | null,
  ) {}

  async choose(observation: AgentObservation, d: Decision): Promise<AgentChoice> {
    const overridden = this.override?.(observation, d);
    if (overridden) return overridden;
    const reason = "scripted_human_choice";
    switch (d.type) {
      case "priority_action": {
        const action = d.actions.find(a => a.type !== "pass") ?? d.actions[0]!;
        return { decisionId: d.decisionId, kind: "action", choice: action.actionId, reason };
      }
      case "target_selection":
        return d.targets.length
          ? { decisionId: d.decisionId, kind: "target", choice: d.targets[0]!.targetId, reason }
          : { decisionId: d.decisionId, kind: "target", choice: d.finishTargetId!, reason };
      case "mode_selection":
        return d.modes.length
          ? { decisionId: d.decisionId, kind: "mode", choice: d.modes[0]!.modeId, reason }
          : { decisionId: d.decisionId, kind: "mode", choice: d.finishModeId!, reason };
      case "value_selection":
        return { decisionId: d.decisionId, kind: "value", choice: d.minValue, reason };
      case "optional_cost_selection":
        return { decisionId: d.decisionId, kind: "optional_cost", choice: d.declineCostId, reason };
      case "cost_object_selection": {
        if (d.canFinish && d.finishChoiceId) return { decisionId: d.decisionId, kind: "object", choice: d.finishChoiceId, reason };
        return { decisionId: d.decisionId, kind: "object", choice: d.options[0]!.objectId, reason };
      }
      case "mana_payment":
        return { decisionId: d.decisionId, kind: "mana", choice: d.options[0]!.manaOptionId, reason };
      case "attackers_selection":
      case "blockers_selection":
      case "combat_order_selection": {
        const add = d.options.find(o => o.operation === "add" || o.operation === "order");
        const finish = d.options.find(o => o.operation === "finish");
        const chosen = add ?? finish ?? d.options[0]!;
        return { decisionId: d.decisionId, kind: "object", choice: chosen.objectId, reason };
      }
      case "yes_no":
      case "object_selection":
      case "ordering_selection": {
        const first = d.options.find(o => !o.finish) ?? d.options.find(o => o.finish) ?? d.options[0]!;
        return { decisionId: d.decisionId, kind: "object", choice: first.objectId, reason };
      }
    }
  }
}
