import type { AgentChoice } from "../agent/baseline-agent.js";
import type {
  AgentObservation,
  ForgeExternalAction,
  ForgePendingDecision,
  ForgePendingExternalDecision as Decision,
} from "../forge/forge-protocol.js";

/**
 * V2e.6.1 §§8-13: infrastructure guard against a failed-cast no-progress loop — NOT a policy
 * change. A real playtest reproduced >4,000 identical Asphodel decisions because Command Tower's
 * combo mana was externally unsupported: Asphodel repeatedly chose the same "Cast Lifecreed Duo"
 * action from the same priority state, the mana payment always failed, Forge rolled the cast back,
 * and priority returned to the exact same state, forever. Fixing Command Tower (see
 * `ForgeManaPaymentChoiceEnumerator`) removes THIS root cause, but the general system-level
 * hazard — one unsupported rules/adapter interaction turning into an unbounded identical-decision
 * loop — is a separate, permanent concern this guard protects against for `cast_spell` actions.
 *
 * Scoped to `priority_action` decisions for the AGENT seat only (never the human — see
 * `runHumanVsAgentMatch`, which only ever wraps `agent.choose`). `BaselineAsphodelAgentV2b` (or any
 * other policy) is never modified or aware of this: it is simply handed a decision whose already-
 * failed cast actions for the CURRENT exact semantic state have been removed, and its returned
 * choice is validated/submitted against the ORIGINAL, unfiltered Forge decision.
 */
export class AgentCastLoopGuard {
  private currentSignature: string | null = null;
  private failedCastKeys = new Set<string>();
  private pending: { signature: string; key: string } | null = null;

  /**
   * Wraps one agent `priority_action` decision: filters out any `cast_spell` action already known
   * to fail from this exact semantic state (§10), hands the filtered decision to `choose`, then
   * records whether the returned choice needs to be watched for a rollback next time this exact
   * state recurs (§11). `decision` here is Forge's ORIGINAL decision — `choose` may receive a
   * narrower view, but the returned choice is always one Forge itself already considers legal, so
   * it validates and submits unchanged against `decision`.
   */
  wrapPriorityDecision(
    observation: AgentObservation,
    decision: ForgePendingDecision,
    choose: (decision: ForgePendingDecision) => AgentChoice,
  ): AgentChoice {
    const filtered = this.beforeChoose(observation, decision);
    const choice = choose(filtered);
    this.afterChoose(decision, choice);
    return choice;
  }

  private beforeChoose(observation: AgentObservation, decision: ForgePendingDecision): ForgePendingDecision {
    const signature = computeStateSignature(observation);
    if (signature !== this.currentSignature) {
      // Relevant game state changed (hand, battlefield, tapped state, counters, stack, life,
      // phase, turn, command zone, …) — the failure memory from any prior state is no longer
      // meaningful and must never suppress a legitimate future cast (§11).
      this.currentSignature = signature;
      this.failedCastKeys = new Set();
      this.pending = null;
    } else if (this.pending) {
      const previousStillOffered = decision.actions.some(
        (action) => action.type === "cast_spell" && castActionKey(action) === this.pending!.key,
      );
      if (previousStillOffered) {
        if (this.failedCastKeys.has(this.pending.key)) {
          // §13 hard safety fuse: this exact semantic cast, from this exact semantic state, was
          // already excluded — it must never reach here a second time. Filtering below is the
          // real defense; this is a defensive invariant assertion, not the primary mechanism.
          throw new Error("human_vs_agent_semantic_cast_loop_detected");
        }
        this.failedCastKeys.add(this.pending.key);
      }
      this.pending = null;
    }
    if (this.failedCastKeys.size === 0) return decision;
    const filteredActions = decision.actions.filter(
      (action) => action.type !== "cast_spell" || !this.failedCastKeys.has(castActionKey(action)),
    );
    return filteredActions.length === decision.actions.length ? decision : { ...decision, actions: filteredActions };
  }

  private afterChoose(decision: ForgePendingDecision, choice: AgentChoice): void {
    const action = choice.kind === "action" ? decision.actions.find((a) => a.actionId === choice.choice) : undefined;
    // Only a cast_spell attempt is ever watched for rollback (§10 scope). Pass and every other
    // action type — including a legitimate successful play_land/activate_ability — are never
    // remembered as failed (§11).
    this.pending = action && action.type === "cast_spell" && this.currentSignature !== null
      ? { signature: this.currentSignature, key: castActionKey(action) }
      : null;
  }
}

/** Every real (non-"pass") `ForgeExternalAction` shape — the only shape `cast_spell` can appear in. */
type CastableAction = Exclude<ForgeExternalAction, { type: "pass" }>;

function castActionKey(action: CastableAction): string {
  // Never actionId/decisionId — Forge regenerates those every time the same decision recurs.
  // cardRef, not name, so two physically distinct cards sharing a name are never conflated.
  return JSON.stringify([
    action.type,
    action.cardRef,
    action.sourceZone,
    action.manaCost,
    action.abilityText ?? action.label,
  ]);
}

/**
 * A stable semantic signature for the agent's own priority state (§9). The whole `AgentObservation`
 * is stable enough on its own — it already excludes every transient decisionId/actionId, since
 * those live only on the decision, not the observation — so this only needs to canonicalize object
 * key order (never array order: zone contents are meaningfully ordered by Forge itself, and Forge
 * only re-emits a genuinely-identical array when nothing actually changed).
 */
function computeStateSignature(observation: AgentObservation): string {
  return JSON.stringify(observation, (_key, value) => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return value;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) sorted[key] = (value as Record<string, unknown>)[key];
    return sorted;
  });
}
