/**
 * Voice Intent Resolver (V0) — shared types.
 *
 * Core principle (see docs/voice-intent-resolver-v0.md): the resolver NEVER parses a spoken
 * sentence in isolation and then asks whether the result is legal. It always starts from the
 * current authoritative Forge pending decision (`WebPendingDecisionDTO` — see ../playtest/types.ts),
 * collects the choices Forge already considers legal RIGHT NOW, and only ever ranks/returns one of
 * those. Every `AgentChoice` this module ever produces is copied verbatim from an existing
 * `MenuItem.choice` (or, for a `"value"` decision, built with the exact shape
 * `decision-renderer.ts` already uses) — nothing is ever manufactured.
 */
import type { AgentChoice, AgentObservation, MenuItem, WebPendingDecisionDTO } from "../playtest/types.js";

export type { AgentChoice, AgentObservation, MenuItem };

/** The current authoritative Forge pending decision — the ONLY source of legal choices. */
export type VoicePendingDecision = WebPendingDecisionDTO;

/**
 * Broad semantic bucket a legal `MenuItem` is classified into, derived ONLY from data Forge/the
 * backend already provided (the decision's `type`, an item's `control`, and the exact label text
 * `describeDecision` — backend/src/human/human-decision-render.ts — deterministically builds, e.g.
 * always "Play X"/"Cast X"/"Activate X" for `priority_action`). Never a guess about Magic rules.
 */
export type VoiceItemCategory =
  | "pass" | "cancel" | "finish" | "yes" | "no"
  | "play_land" | "cast_spell" | "activate_ability"
  | "target" | "attack_add" | "attack_remove" | "block_add" | "block_remove"
  | "object" | "mana" | "mode" | "optional_cost" | "other";

/**
 * A closed vocabulary of intents V0 understands. Deliberately NOT one-to-one with
 * `VoiceItemCategory` — "play"/"cast"/"activate" are the three verb GROUPS the spec calls out as
 * genuinely distinct (a spoken "joue" is ambiguous between `play_land`/`cast_spell` until the
 * referenced card disambiguates it; see `categoryToIntent`/`intentMatchesCategory` in
 * voice-candidates.ts), and "attack"/"block" only ever match the "add" side (V0 never voices
 * removing an already-declared attacker/blocker — see docs).
 */
export type VoiceIntentWord =
  | "play" | "cast" | "activate" | "attack" | "block" | "target"
  | "pass" | "yes" | "no" | "finish" | "cancel";

/**
 * One vocabulary entry: a single normalized token mapped to one intent, optionally restricted to
 * specific Forge decision types (`WebPendingDecisionDTO.type`, e.g. "attackers_selection").
 * `contexts: null` means "global synonym" — valid in every decision family. A context-restricted
 * entry always outranks a global one for the same term (voice-scoring.ts) — this is what lets the
 * SAME word mean different things (or nothing) in different decisions without a flat
 * `Record<string, Intent>` losing that distinction. `origin` distinguishes the shipped default
 * vocabulary from a human-approved addition (voice-vocabulary-store.ts) purely for inspection/UI —
 * both are merged and scored identically once merged (`mergeLexicon`).
 */
export interface LexiconEntry {
  term: string;
  intent: VoiceIntentWord;
  contexts: string[] | null;
  origin: "default" | "approved";
}

export interface NormalizedToken {
  /** Exactly as spoken/transcribed (for STT-vs-parser debugging — see docs). */
  raw: string;
  /** Lowercased, diacritics stripped, elision-split, punctuation-stripped (transcript-normalizer.ts). */
  normalized: string;
  /** A known filler/function word (je, un, avec, the, a, …) — never scored, never "unknown". */
  ignored: boolean;
}

export interface NormalizedTranscript {
  raw: string;
  normalized: string;
  tokens: NormalizedToken[];
}

/** One legal choice, scored against the current transcript, with an explainable trail. */
export interface VoiceCandidate {
  choice: AgentChoice;
  /** The exact source `MenuItem`; `null` only for a synthesized `"value"` decision candidate. */
  item: MenuItem | null;
  category: VoiceItemCategory | null;
  label: string;
  score: number;
  /** Human-readable, in scoring order — "why this candidate scored what it scored". */
  reasons: string[];
}

/** A meaningful, genuinely unknown word paired with the intent/context it would need approval for. */
export interface DictionaryProposal {
  term: string;
  intent: VoiceIntentWord;
  /** The exact decision `type` this proposal was observed in — an approval defaults to this same
   * context only (see docs "Contextual learning"), never silently global. */
  context: string;
}

export type VoiceResolution =
  /** A unique legal choice was clearly identified — safe to submit directly. */
  | { kind: "resolved"; choice: AgentChoice; confidence: number }
  /**
   * A compound instruction ("j'attaque avec K'rrik et Vilis") resolved to an ORDERED sequence of
   * individually-confident steps within one attackers_selection/blockers_selection decision — see
   * voice-runner.ts's `advancePlan`. Each step is still re-resolved against the NEW decision before
   * it is submitted; nothing here is pre-submitted.
   */
  | { kind: "plan"; steps: VoiceCandidate[] }
  /** A likely interpretation exists but isn't confident enough to auto-execute — ask the human. */
  | { kind: "confirm"; candidate: VoiceCandidate; confidence: number }
  /** Several legal candidates remain plausible and too close to call. */
  | { kind: "ambiguous"; candidates: VoiceCandidate[] }
  /** No reasonable legal choice matches — do nothing. */
  | { kind: "unrecognized" };

export interface VoiceResolutionResult {
  transcript: { raw: string; normalized: string };
  candidates: VoiceCandidate[];
  resolution: VoiceResolution;
  /** Meaningful (non-filler) words that matched no vocabulary, no visible card, and no player name. */
  unknownTerms: string[];
  /** Present only when exactly one unknown term remains and a resolved/confirm candidate exists to attach it to. Never applied automatically — see voice-runner.ts's `approveDictionaryEntry`. */
  dictionaryProposal: DictionaryProposal | null;
}
