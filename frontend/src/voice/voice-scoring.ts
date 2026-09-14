/**
 * Every scoring/threshold constant used by voice-candidates.ts/voice-resolver.ts lives here —
 * nothing is scattered inline (spec: "Keep scoring constants centralized and testable"). Scores are
 * a RELATIVE ranking/confidence signal, deliberately not a calibrated statistical probability — see
 * voice-resolver.ts's doc comment.
 */
export const VOICE_SCORE = {
  /**
   * "passe" / "oui" / "non" / "fini" / "annule": a single closed-class control word IS the whole
   * decision — under any given decision there is normally exactly one legal item of this category,
   * so this signal alone can reach HIGH_CONFIDENCE with no card corroboration at all.
   */
  CONTROL_WORD_GLOBAL: 6,
  /** A control word the human specifically approved for this exact decision context. */
  CONTROL_WORD_CONTEXTUAL: 7,
  /**
   * "joue" / "cast" / "attaque" / "cible": a bare verb never identifies WHICH card — deliberately
   * kept below HIGH_CONFIDENCE on its own so a lone verb with no matching card can never
   * auto-execute (see "je joue" with no recognizable card -> should stay unrecognized/confirm, not
   * silently pick an arbitrary legal action).
   */
  ACTION_WORD_GLOBAL: 3,
  ACTION_WORD_CONTEXTUAL: 4,
  /** The card Forge's own item text/cardRef refers to was recognized verbatim in the transcript. */
  CARD_EXACT_MATCH: 6,
  /** A conservative fuzzy match only (see voice-card-matching.ts) — worth less than an exact hit. */
  CARD_FUZZY_MATCH: 3,
  /** Only one currently-legal item references this exact card — the card match alone disambiguates the action, even with no verb recognized at all (see docs "Card matching"). */
  CARD_UNIQUE_REFERENCE_BONUS: 2,
  /** A specific player's name (or a self-reference word) was recognized for a player-target item. */
  PLAYER_NAME_MATCH: 5,
  SELF_REFERENCE_MATCH: 4,
  /** A spoken/digit number fell within the decision's own legal [min,max] range. */
  NUMERIC_MATCH: 8,
  /** Subtracted once per meaningful (non-filler) token this specific candidate's own signals never accounted for — keeps a stray unrelated word from silently inflating every candidate equally, while a single incidental unknown word never alone sinks an otherwise strong match. */
  UNKNOWN_TOKEN_PENALTY: 0.75,
} as const;

export const VOICE_THRESHOLDS = {
  /** At or above this score: a unique legal choice is clear enough to submit directly. */
  HIGH_CONFIDENCE: 6,
  /** At or above this score (but below HIGH_CONFIDENCE): plausible, but ask for confirmation first. */
  MEDIUM_CONFIDENCE: 3,
  /** Two candidates within this many points of each other are "too close to call" -> ambiguous. */
  AMBIGUITY_MARGIN: 1.5,
} as const;
