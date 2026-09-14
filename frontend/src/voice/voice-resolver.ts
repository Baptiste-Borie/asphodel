import type { AgentObservation, DictionaryProposal, LexiconEntry, VoiceCandidate, VoicePendingDecision, VoiceResolution, VoiceResolutionResult } from "./voice-types.js";
import { normalizeTranscript } from "./transcript-normalizer.js";
import { computeUnknownTerms, generateCandidates, categoryToIntent } from "./voice-candidates.js";
import { VOICE_THRESHOLDS } from "./voice-scoring.js";

/**
 * Turns one attackers_selection/blockers_selection candidate set into an ORDERED compound plan when
 * the transcript named several DIFFERENT cards for the same repeatable "add" action in one sentence
 * ("j'attaque avec K'rrik et Vilis") — the one case where two candidates legitimately both apply,
 * rather than being mutually exclusive. Deliberately narrow (spec: "If compound combat is too large
 * for this first implementation, make the resolver architecture compatible with it" — see
 * voice-runner.ts's `advancePlan` for how each step is re-resolved against fresh Forge state):
 *   - only for `attack_add`/`block_add` (never `target`/`play_land`/… — those pick exactly one),
 *   - only candidates with their OWN exact card match (never a bare verb, never fuzzy — a plan
 *     auto-executes without a per-step confirmation, so it never rests on a guess),
 *   - only distinct cardRefs (never a card counted twice).
 * Returns `null` when there is nothing plan-shaped to find (the normal single-target case).
 */
function detectAttackOrBlockPlan(candidates: readonly VoiceCandidate[], decisionType: string): VoiceCandidate[] | null {
  if (decisionType !== "attackers_selection" && decisionType !== "blockers_selection") return null;
  const planCategory = decisionType === "attackers_selection" ? "attack_add" : "block_add";
  const seen = new Set<string>();
  const steps: VoiceCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.category !== planCategory || !candidate.item?.cardRef) continue;
    if (candidate.score < VOICE_THRESHOLDS.MEDIUM_CONFIDENCE) continue;
    if (!candidate.reasons.some((r) => r.includes("recognized exactly"))) continue;
    if (seen.has(candidate.item.cardRef)) continue;
    seen.add(candidate.item.cardRef);
    steps.push(candidate);
  }
  return steps.length >= 2 ? steps : null;
}

function decideResolution(candidates: readonly VoiceCandidate[], decisionType: string): VoiceResolution {
  if (candidates.length === 0) return { kind: "unrecognized" };

  const plan = detectAttackOrBlockPlan(candidates, decisionType);
  if (plan) return { kind: "plan", steps: plan };

  const top = candidates[0]!;
  const second = candidates[1];
  const tied = second !== undefined && top.score - second.score < VOICE_THRESHOLDS.AMBIGUITY_MARGIN && second.score >= VOICE_THRESHOLDS.MEDIUM_CONFIDENCE;
  if (tied) {
    const margin = VOICE_THRESHOLDS.AMBIGUITY_MARGIN;
    return { kind: "ambiguous", candidates: candidates.filter((c) => top.score - c.score < margin) };
  }
  if (top.score >= VOICE_THRESHOLDS.HIGH_CONFIDENCE) return { kind: "resolved", choice: top.choice, confidence: top.score };
  if (top.score >= VOICE_THRESHOLDS.MEDIUM_CONFIDENCE) return { kind: "confirm", candidate: top, confidence: top.score };
  return { kind: "unrecognized" };
}

/** Only proposed when there is exactly one unknown word left AND a single confident interpretation to attach it to — never for an ambiguous/unrecognized result (there is nothing safe to propose), never for more than one unknown word at once (V0 keeps proposals unambiguous: one word, one suggested meaning). */
function buildDictionaryProposal(resolution: VoiceResolution, topCandidate: VoiceCandidate | undefined, unknownTerms: readonly string[], decisionType: string): DictionaryProposal | null {
  if (resolution.kind !== "resolved" && resolution.kind !== "confirm") return null;
  if (unknownTerms.length !== 1 || !topCandidate?.category) return null;
  const intent = categoryToIntent(topCandidate.category);
  if (!intent) return null;
  return { term: unknownTerms[0]!, intent, context: decisionType };
}

/**
 * The one resolver entry point: raw STT transcript + the current authoritative Forge decision (and
 * observation, for card/player names) in, a full diagnostic result out. Never mutates `lexicon` —
 * see voice-runner.ts for the only place an approved addition is ever written.
 *
 * Confidence is a RELATIVE ranking signal (see voice-scoring.ts), never a calibrated statistical
 * probability — "high confidence" means "clearly and uniquely identified given what's legal right
 * now", not "94% likely" in any rigorous sense.
 */
export function resolveVoiceTranscript(raw: string, pending: VoicePendingDecision, observation: AgentObservation | null, lexicon: readonly LexiconEntry[]): VoiceResolutionResult {
  const transcript = normalizeTranscript(raw);
  const candidates = generateCandidates(pending, observation, transcript, lexicon);
  const unknownTerms = computeUnknownTerms(transcript, lexicon, observation);
  const resolution = decideResolution(candidates, pending.type);
  const dictionaryProposal = buildDictionaryProposal(resolution, candidates[0], unknownTerms, pending.type);
  return {
    transcript: { raw: transcript.raw, normalized: transcript.normalized },
    candidates,
    resolution,
    unknownTerms,
    dictionaryProposal,
  };
}
