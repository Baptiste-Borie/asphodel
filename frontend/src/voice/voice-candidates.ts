import type { AgentObservation, DecisionPrompt } from "../playtest/types.js";
import type { LexiconEntry, MenuItem, NormalizedToken, NormalizedTranscript, VoiceCandidate, VoiceIntentWord, VoiceItemCategory, VoicePendingDecision } from "./voice-types.js";
import { lookupTerm, isKnownTerm } from "./voice-lexicon.js";
import { buildCardNameIndex, canon, matchCardName, significantCardWords } from "./voice-card-matching.js";
import { VOICE_SCORE } from "./voice-scoring.js";

/**
 * Classifies one already-legal `MenuItem` into a broad semantic bucket, using ONLY the decision's
 * own `type` plus data Forge/the backend already attached to the item — `item.control`, and the
 * exact label text `describeDecision` (backend/src/human/human-decision-render.ts) deterministically
 * builds (always "Play X"/"Cast X"/"Activate X" for `priority_action`, "Add X attacking Y"/"Remove X
 * blocking Y" for combat, "Target X" for `target_selection`, …). Never re-derives Magic rules, never
 * invents a category outside what that decision type can produce.
 */
export function classifyMenuItem(decisionType: string, item: MenuItem): VoiceItemCategory {
  if (item.control === "pass") return "pass";
  if (item.control === "cancel") return "cancel";
  const label = item.label.trim();
  switch (decisionType) {
    case "priority_action":
      if (/^Play\b/.test(label)) return "play_land";
      if (/^Cast\b/.test(label)) return "cast_spell";
      if (/^Activate\b/.test(label)) return "activate_ability";
      return "other";
    case "target_selection":
      return /^Finish\b/i.test(label) ? "finish" : "target";
    case "attackers_selection":
      if (/^Finish\b/i.test(label)) return "finish";
      if (/^Add\b/.test(label)) return "attack_add";
      if (/^Remove\b/.test(label)) return "attack_remove";
      return "other";
    case "blockers_selection":
      if (/^Finish\b/i.test(label)) return "finish";
      if (/^Add\b/.test(label)) return "block_add";
      if (/^Remove\b/.test(label)) return "block_remove";
      return "other";
    case "combat_order_selection":
      return "object";
    case "mode_selection":
      return /^Finish\b/i.test(label) ? "finish" : "mode";
    case "optional_cost_selection":
      return label === "Decline" ? "no" : "optional_cost";
    case "cost_object_selection":
      return /^Finish$/i.test(label) ? "finish" : "object";
    case "mana_payment":
      return "mana";
    case "yes_no":
      if (/^yes$/i.test(label)) return "yes";
      if (/^no$/i.test(label)) return "no";
      return "other";
    case "object_selection":
    case "ordering_selection":
      return /^finish selection$/i.test(label) ? "finish" : "object";
    default:
      return "other";
  }
}

/** Reverse of the verb groups in voice-lexicon.ts — used only to phrase a dictionary-learning proposal ("lande" -> "play"), never to re-score anything. `null` for a bucket too generic to safely propose a single verb for. */
export function categoryToIntent(category: VoiceItemCategory): VoiceIntentWord | null {
  switch (category) {
    case "pass": return "pass";
    case "cancel": return "cancel";
    case "finish": return "finish";
    case "yes": return "yes";
    case "no": return "no";
    case "play_land": return "play";
    case "cast_spell": return "cast";
    case "activate_ability": return "activate";
    case "target": return "target";
    case "attack_add": return "attack";
    case "block_add": return "block";
    default: return null;
  }
}

function intentMatchesCategory(intent: VoiceIntentWord, category: VoiceItemCategory): boolean {
  return categoryToIntent(category) === intent;
}

const FRENCH_NUMBER_WORDS: Readonly<Record<string, number>> = {
  zero: 0, un: 1, une: 1, deux: 2, trois: 3, quatre: 4, cinq: 5, six: 6, sept: 7, huit: 8, neuf: 9,
  dix: 10, onze: 11, douze: 12, treize: 13, quatorze: 14, quinze: 15, seize: 16,
  "dix-sept": 17, "dix-huit": 18, "dix-neuf": 19, vingt: 20,
};
const ENGLISH_NUMBER_WORDS: Readonly<Record<string, number>> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
};

/** Pure. A literal digit string, or a French/English number word — `null` for anything else. Never guesses a number out of an unrelated word. */
export function parseSpokenNumber(token: string): number | null {
  if (/^\d+$/.test(token)) return Number(token);
  return FRENCH_NUMBER_WORDS[token] ?? ENGLISH_NUMBER_WORDS[token] ?? null;
}

interface ScoreResult {
  score: number;
  reasons: string[];
  /** Token index the card match came from, if any — used only to order a compound attack/block plan by spoken order (see voice-resolver.ts). */
  cardMatchTokenIndex: number | null;
}

function scoreMenuItem(params: {
  item: MenuItem;
  category: VoiceItemCategory;
  decisionType: string;
  tokens: readonly NormalizedToken[];
  transcriptNormalized: string;
  lexicon: readonly LexiconEntry[];
  cardName: string | null;
  uniqueCardReference: boolean;
  observation: AgentObservation | null;
}): ScoreResult {
  const { item, category, decisionType, tokens, transcriptNormalized, lexicon, cardName, uniqueCardReference, observation } = params;
  const reasons: string[] = [];
  let score = 0;
  const meaningfulTokens = tokens.filter((t) => !t.ignored);
  const consumed = new Set<number>();
  const controlCategories: ReadonlySet<VoiceItemCategory> = new Set(["pass", "cancel", "finish", "yes", "no"]);

  meaningfulTokens.forEach((token, index) => {
    const matches = lookupTerm(lexicon, token.normalized, decisionType);
    const relevant = matches.find((m) => intentMatchesCategory(m.entry.intent, category));
    if (!relevant) return;
    consumed.add(index);
    const isControl = controlCategories.has(category);
    if (relevant.contextual) {
      score += isControl ? VOICE_SCORE.CONTROL_WORD_CONTEXTUAL : VOICE_SCORE.ACTION_WORD_CONTEXTUAL;
      reasons.push(`"${token.raw}" is an approved word for "${category}" in ${decisionType}`);
    } else {
      score += isControl ? VOICE_SCORE.CONTROL_WORD_GLOBAL : VOICE_SCORE.ACTION_WORD_GLOBAL;
      reasons.push(`"${token.raw}" is a known word for "${category}"`);
    }
  });

  let cardMatchTokenIndex: number | null = null;
  if (item.cardRef && cardName) {
    const match = matchCardName(cardName, meaningfulTokens.map((t) => t.normalized), transcriptNormalized);
    if (match.level === "exact" || match.level === "fuzzy") {
      score += match.level === "exact" ? VOICE_SCORE.CARD_EXACT_MATCH : VOICE_SCORE.CARD_FUZZY_MATCH;
      reasons.push(`card "${cardName}" recognized ${match.level === "exact" ? "exactly" : `approximately (near "${match.matchedWord}")`}`);
      cardMatchTokenIndex = match.matchedTokenIndex;
      if (match.matchedTokenIndex !== null) consumed.add(match.matchedTokenIndex);
      else {
        // A whole-name match spanning several tokens (e.g. "sol ring" as two words) — credit every
        // meaningful token that is one of the card's own words so none is later penalized as unknown.
        const cardWords = new Set(significantCardWords(cardName).map(canon));
        meaningfulTokens.forEach((t, i) => { if (cardWords.has(canon(t.normalized))) consumed.add(i); });
      }
      if (uniqueCardReference) {
        score += VOICE_SCORE.CARD_UNIQUE_REFERENCE_BONUS;
        reasons.push("only one legal choice currently references this card");
      }
    }
  }

  if (item.playerId && observation) {
    const isSelf = item.playerId === observation.selfPlayerId;
    const selfWords = new Set(["moi", "me", "myself"]);
    const selfIndex = meaningfulTokens.findIndex((t) => selfWords.has(t.normalized));
    if (isSelf && selfIndex !== -1) {
      score += VOICE_SCORE.SELF_REFERENCE_MATCH;
      reasons.push('self-reference word matched ("moi"/"me")');
      consumed.add(selfIndex);
    } else {
      const player = observation.players.find((p) => p.playerId === item.playerId);
      if (player) {
        const nameWords = new Set(significantCardWords(player.name).map(canon));
        meaningfulTokens.forEach((t, i) => {
          if (nameWords.has(canon(t.normalized))) {
            score += VOICE_SCORE.PLAYER_NAME_MATCH;
            reasons.push(`player name "${player.name}" recognized`);
            consumed.add(i);
          }
        });
      }
    }
  }

  const unknownForThisItem = meaningfulTokens.length - consumed.size;
  if (unknownForThisItem > 0) {
    score -= unknownForThisItem * VOICE_SCORE.UNKNOWN_TOKEN_PENALTY;
    reasons.push(`${unknownForThisItem} meaningful word(s) this candidate does not account for`);
  }

  return { score, reasons, cardMatchTokenIndex };
}

/** Pure. Only ever synthesizes a candidate whose value already sits inside the decision's own legal `[min,max]` — never a manufactured out-of-range value. Uses the exact `AgentChoice` shape `decision-renderer.ts` already submits for a `"value"` decision. */
function generateValueCandidates(prompt: Extract<DecisionPrompt, { kind: "value" }>, tokens: readonly NormalizedToken[]): VoiceCandidate[] {
  for (const token of tokens) {
    if (token.ignored) continue;
    const n = parseSpokenNumber(token.normalized);
    if (n !== null && n >= prompt.min && n <= prompt.max) {
      return [{
        choice: { decisionId: prompt.decisionId, kind: "value", choice: n, reason: "voice_intent" },
        item: null,
        category: null,
        label: `Choose ${n}`,
        score: VOICE_SCORE.NUMERIC_MATCH,
        reasons: [`recognized number "${token.raw}" within the legal range [${prompt.min}, ${prompt.max}]`],
      }];
    }
  }
  return [];
}

/**
 * The one entry point that turns a normalized transcript into ranked, already-legal candidates.
 * Only `"menu"` and `"value"` decision prompts are supported in V0 (see docs "Scope of this pass"
 * for `card_picker`/`opening_hand`/`physical_declare` — out of scope, not silently mishandled:
 * this simply returns no candidates for them, which resolves to "unrecognized").
 */
export function generateCandidates(pending: VoicePendingDecision, observation: AgentObservation | null, transcript: NormalizedTranscript, lexicon: readonly LexiconEntry[]): VoiceCandidate[] {
  const prompt = pending.rendered;
  if (prompt.kind === "value") return generateValueCandidates(prompt, transcript.tokens);
  if (prompt.kind !== "menu") return [];

  const cardIndex = observation ? buildCardNameIndex(observation) : new Map<string, string>();
  const refCounts = new Map<string, number>();
  for (const item of prompt.items) if (item.cardRef) refCounts.set(item.cardRef, (refCounts.get(item.cardRef) ?? 0) + 1);

  const candidates: VoiceCandidate[] = [];
  for (const item of prompt.items) {
    const category = classifyMenuItem(pending.type, item);
    const cardName = item.cardRef ? item.presentationName ?? cardIndex.get(item.cardRef) ?? null : null;
    const unique = item.cardRef ? (refCounts.get(item.cardRef) ?? 0) === 1 : false;
    const { score, reasons } = scoreMenuItem({
      item, category, decisionType: pending.type, tokens: transcript.tokens, transcriptNormalized: transcript.normalized,
      lexicon, cardName, uniqueCardReference: unique, observation,
    });
    if (score > 0) candidates.push({ choice: item.choice, item, category, label: item.label, score, reasons });
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

/** Pure. Every visible card/player name's own words, canonicalized, purely to tell "recognized entity" apart from "genuinely unknown word" (see `computeUnknownTerms`) — independent of whether that card is even a legal choice right now. */
function knownEntityWords(observation: AgentObservation | null): Set<string> {
  const words = new Set<string>();
  if (!observation) return words;
  for (const name of buildCardNameIndex(observation).values()) for (const w of significantCardWords(name)) words.add(canon(w));
  for (const player of observation.players) for (const w of significantCardWords(player.name)) words.add(canon(w));
  return words;
}

/**
 * Pure. Meaningful (non-filler) words that are neither known vocabulary (any context — a word
 * valid only in a DIFFERENT decision is still "recognized", just not applicable now), a recognized
 * card/player name, nor a parseable number. These are the only words ever eligible for a dictionary
 * proposal (voice-resolver.ts) — never an ordinary French connective, never a name Forge already
 * shows on the board.
 */
export function computeUnknownTerms(transcript: NormalizedTranscript, lexicon: readonly LexiconEntry[], observation: AgentObservation | null): string[] {
  const entities = knownEntityWords(observation);
  const unknown: string[] = [];
  for (const token of transcript.tokens) {
    if (token.ignored) continue;
    if (isKnownTerm(lexicon, token.normalized)) continue;
    if (entities.has(canon(token.normalized))) continue;
    if (parseSpokenNumber(token.normalized) !== null) continue;
    unknown.push(token.raw);
  }
  return unknown;
}
