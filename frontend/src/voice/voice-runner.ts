import type { AgentChoice, AgentObservation, DictionaryProposal, LexiconEntry, VoiceCandidate, VoicePendingDecision, VoiceResolution, VoiceResolutionResult } from "./voice-types.js";
import { DEFAULT_LEXICON, mergeLexicon } from "./voice-lexicon.js";
import { classifyMenuItem } from "./voice-candidates.js";
import { resolveVoiceTranscript } from "./voice-resolver.js";
import { loadApprovedVocabulary, saveApprovedVocabulary, type VoiceVocabularyStorage } from "./voice-vocabulary-store.js";

interface PlanStep {
  cardRef: string;
  category: "attack_add" | "block_add";
  label: string;
}

export interface VoiceRunnerDeps {
  getPendingDecision: () => VoicePendingDecision | null;
  getObservation: () => AgentObservation | null;
  /**
   * A UX-only pre-check (avoid attempting a submit that would silently no-op, and give the debug
   * panel an honest "not safe to act right now" signal). The REAL enforcement never lives here —
   * `submit` below must always be the host's existing protected `submitChoice()`, which already
   * owns the DecisionGate/frame-playback/`submitting` guards (see playtest-view.ts). This runner
   * never re-implements or bypasses any of that; it only ever calls the exact same function a click
   * would call.
   */
  canAct: () => boolean;
  submit: (choice: AgentChoice) => void;
  storage: VoiceVocabularyStorage;
}

/**
 * Orchestrates one physical-mode voice session: merges the default + human-approved lexicon,
 * resolves a raw transcript against whatever is CURRENTLY the authoritative pending decision, and —
 * only on an explicit `execute()` call, never automatically from `interpret()` — submits through
 * the host's own protected choice path. Also owns the one compound-plan case V0 supports (see
 * voice-resolver.ts's `detectAttackOrBlockPlan`): a multi-step attack/block declaration is walked
 * one Forge decision at a time, always re-resolved against the fresh state (`advancePlan`), never
 * replaying a stale choice.
 */
export class VoiceRunner {
  private readonly deps: VoiceRunnerDeps;
  private approvedVocabulary: LexiconEntry[];
  private plan: PlanStep[] = [];
  private planDecisionType: string | null = null;
  private planAbortReason: string | null = null;

  constructor(deps: VoiceRunnerDeps) {
    this.deps = deps;
    this.approvedVocabulary = loadApprovedVocabulary(deps.storage);
  }

  get lexicon(): LexiconEntry[] {
    return mergeLexicon(DEFAULT_LEXICON, this.approvedVocabulary);
  }

  get approved(): readonly LexiconEntry[] {
    return this.approvedVocabulary;
  }

  /** Diagnostics only — what a still-running compound plan is waiting on, and why it stopped if it did. */
  get planStatus(): { remaining: string[]; abortReason: string | null } {
    return { remaining: this.plan.map((s) => s.label), abortReason: this.planAbortReason };
  }

  /**
   * Interprets one final STT transcript against whatever decision is pending right now. Purely
   * diagnostic — NEVER submits anything by itself, and never touches the lexicon. Returns `null`
   * only when there is no pending decision at all to interpret against (nothing legal exists yet).
   */
  interpret(rawTranscript: string): VoiceResolutionResult | null {
    const pending = this.deps.getPendingDecision();
    if (!pending) return null;
    return resolveVoiceTranscript(rawTranscript, pending, this.deps.getObservation(), this.lexicon);
  }

  /** The one place anything is ever submitted from voice. Always goes through `deps.submit` — the host's own `submitChoice()` — never a second path. A no-op while `canAct()` is false. */
  execute(resolution: VoiceResolution): void {
    if (!this.deps.canAct()) return;
    if (resolution.kind === "resolved") { this.deps.submit(resolution.choice); return; }
    if (resolution.kind === "confirm") { this.deps.submit(resolution.candidate.choice); return; }
    if (resolution.kind === "plan") this.startPlan(resolution.steps);
  }

  private startPlan(steps: readonly VoiceCandidate[]): void {
    const pending = this.deps.getPendingDecision();
    if (!pending) return;
    this.planAbortReason = null;
    this.planDecisionType = pending.type;
    this.plan = steps.map((s) => ({ cardRef: s.item!.cardRef!, category: s.category as "attack_add" | "block_add", label: s.label }));
    this.advancePlan();
  }

  /**
   * Advances a running compound plan by exactly one step, against whatever decision is pending
   * RIGHT NOW — never the decision that was pending when the plan was built. Call this once per
   * freshly-revealed authoritative decision (i.e. from the same place a poll reveals a new live
   * decision to the human — see playtest-view.ts's `revealLiveState`), so every step genuinely
   * "waits for the new authoritative state" per spec. A no-op when no plan is running. Aborts
   * (clears the remaining plan, records why) the moment the new decision no longer matches what was
   * planned — a different decision entirely, or the next planned card no longer legal (already
   * added, removed, or the decision resolved) — rather than ever resubmitting stale data.
   */
  advancePlan(): void {
    if (this.plan.length === 0) return;
    if (!this.deps.canAct()) return;
    const pending = this.deps.getPendingDecision();
    if (!pending || pending.type !== this.planDecisionType || pending.rendered.kind !== "menu") {
      this.abortPlan("the pending decision changed before the plan finished");
      return;
    }
    const next = this.plan[0]!;
    const item = pending.rendered.items.find((i) => i.cardRef === next.cardRef && classifyMenuItem(pending.type, i) === next.category);
    if (!item) {
      this.abortPlan(`"${next.label}" is no longer a legal choice`);
      return;
    }
    this.plan = this.plan.slice(1);
    this.deps.submit(item.choice);
  }

  private abortPlan(reason: string): void {
    this.plan = [];
    this.planDecisionType = null;
    this.planAbortReason = reason;
  }

  /**
   * The ONLY way the lexicon ever changes — always an explicit call from the UI's own approval
   * button (never triggered by `interpret`/`execute`, no matter how confident or how many times the
   * same unknown word has been heard). Defaults to context-scoped (spec "Contextual learning": the
   * same word approved during one decision type must not silently apply everywhere) — pass
   * `scope: "global"` only for an explicit "apply everywhere" UI action.
   */
  approveDictionaryEntry(proposal: DictionaryProposal, scope: "context" | "global" = "context"): void {
    const entry: LexiconEntry = { term: proposal.term, intent: proposal.intent, contexts: scope === "context" ? [proposal.context] : null, origin: "approved" };
    this.approvedVocabulary = [...this.approvedVocabulary, entry];
    saveApprovedVocabulary(this.deps.storage, this.approvedVocabulary);
  }
}
