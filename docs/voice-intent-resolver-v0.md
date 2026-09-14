# V0 — Voice Intent Resolver for Physical Companion

Base: `main` at the "Physical Companion: identity tracking, K'rrik Phyrexian mana, stale-decision UI"
milestone. Forge remains untouched (`git -C vendor/forge status --short` empty) and remains the only
source of truth for legality. This milestone is purely a new frontend module tree
(`frontend/src/voice/`) plus a small amount of wiring inside `playtest-view.ts` — no backend/Java
changes, no new HTTP route, no new choice-submission path.

## 1. Core idea

> Which of the actions that are LEGAL RIGHT NOW is the user most likely trying to perform?

The resolver never parses a spoken sentence in isolation and then asks whether the result is legal.
It always starts from the current authoritative Forge pending decision
(`WebPendingDecisionDTO`/`DecisionPrompt` — the exact same DTO `playtest-view.ts` already renders as
clickable buttons), collects the choices Forge already considers legal right now, and only ever
ranks/returns one of those. Every `AgentChoice` this module produces is copied verbatim from an
existing `MenuItem.choice` (or, for a `"value"` decision, built with the exact shape
`decision-renderer.ts` already submits) — nothing is ever manufactured.

## 2. Pipeline

```text
raw STT transcript
      │
      ▼
transcript-normalizer.ts   — lowercase, diacritics stripped, elision split ("j'attaque" -> "j"+"attaque"),
      │                       filler/function words flagged (never scored, never "unknown")
      ▼
voice-lexicon.ts           — default + human-approved vocabulary, each entry optionally
      │                       context-restricted to a specific Forge decision `type`
      ▼
voice-card-matching.ts     — exact / conservative-fuzzy matching of a legal item's own card name
      │                       against the transcript's meaningful tokens
      ▼
voice-candidates.ts        — classifies every legal MenuItem into a semantic category purely from
      │                       the decision's `type` + the item's own `control`/label text (never a
      │                       rules re-derivation), then scores each against the transcript
      ▼
voice-resolver.ts          — ranks candidates, decides resolved / plan / confirm / ambiguous /
      │                       unrecognized (voice-scoring.ts's centralized thresholds), builds a
      │                       dictionary-learning proposal when exactly one unknown word remains
      ▼
voice-runner.ts            — orchestrates one session: merges lexicon + approved vocabulary, calls
      │                       the resolver, and — only on an explicit execute() — submits through
      │                       the SAME protected submitChoice() path a click already uses
      ▼
voice-panel.ts / speech-recognizer.ts   — the DOM debug UI + the Web Speech API wrapper
```

Every module above `voice-runner.ts` is pure and has no DOM/browser dependency — this is where all
59 of this milestone's unit tests live (plain `node:test`, no mocked microphone, no jsdom, matching
how the rest of `frontend/src/playtest/*.test.ts` already tests pure logic only).

## 3. Classification, never rules re-derivation

`voice-candidates.ts`'s `classifyMenuItem` buckets a legal item into a `VoiceItemCategory`
(`play_land`/`cast_spell`/`activate_ability`/`target`/`attack_add`/`block_add`/`pass`/`yes`/`no`/…)
using only:

- the decision's own `type` (`priority_action`, `attackers_selection`, `target_selection`, …),
- `item.control` (`"pass"`/`"cancel"`),
- the item's exact label text, which `describeDecision` (backend/src/human/human-decision-render.ts)
  already builds deterministically (always `"Play X"`/`"Cast X"`/`"Activate X"` for
  `priority_action`, `"Add X attacking Y"`/`"Remove X blocking Y"` for combat, `"Target X"` for
  `target_selection`, …).

Nothing here re-derives a Magic rule or guesses at Forge internals — it is a label-pattern read of
data Forge/the backend already computed and already renders as a clickable button.

## 4. Scoring (voice-scoring.ts)

A deterministic, explainable, centralized set of constants — see the file's own doc comments for the
exact numbers and the reasoning behind each one. In summary:

- A closed-class **control word** ("passe", "oui", "non", "fini") scores high enough to resolve
  alone — there is normally exactly one legal item of that kind.
- A bare **action verb** ("joue", "cast", "attaque") scores deliberately lower alone — it never
  identifies WHICH card, so it can never auto-execute without further corroboration.
- An **exact card-name match** is a strong signal by itself; a **conservative fuzzy match** (never on
  words under 4 letters, never on a huge edit distance) is weaker.
- A card referenced by **only one** currently-legal item gets a uniqueness bonus — this is what lets
  `"je lande un swamp"` resolve `Play Swamp` with high confidence even though `"lande"` is completely
  unknown vocabulary (see `voice-resolver.test.ts`).
- Each meaningful word a given candidate's own signals never accounted for costs a small penalty —
  enough to sink a genuinely irrelevant sentence to zero real candidates, small enough that one
  incidental unknown word never alone tanks an otherwise strong match.

Scores are a **relative ranking/confidence signal**, never a calibrated statistical probability.

## 5. Execution thresholds

Four resolver states (`voice-resolver.ts`'s `decideResolution`, thresholds in `voice-scoring.ts`):

- **resolved** — top score ≥ `HIGH_CONFIDENCE`: a unique legal choice, safe to submit directly.
- **confirm** — top score ≥ `MEDIUM_CONFIDENCE` but below `HIGH_CONFIDENCE`: plausible, ask first.
- **ambiguous** — two-or-more candidates within `AMBIGUITY_MARGIN` of each other, both at least
  medium confidence: present the ranked candidates, require an explicit pick.
- **unrecognized** — nothing scored positively at all: do nothing.

`voice-panel.ts` auto-executes `resolved` (and `plan`, §7) immediately, shows a Confirm/Cancel pair
for `confirm`, a clickable ranked list for `ambiguous`, and just a status line for `unrecognized`.

## 6. Dictionary / vocabulary

- `voice-lexicon.ts`'s `DEFAULT_LEXICON` is the shipped vocabulary — French first, common English
  Magic terms alongside it — and is never written to.
- `voice-vocabulary-store.ts` persists ONLY human-approved additions, as a small versioned
  (`version: 1`) JSON blob behind an injectable `VoiceVocabularyStorage` interface (real
  `localStorage` in the browser, an in-memory `Map` as the safe fallback/test backend — there is no
  backend endpoint for this in V0, matching the repo's existing "duplicate the shape, don't share a
  server" pattern between `frontend/src/playtest/types.ts` and the backend DTOs).
- `voice-runner.ts`'s `approveDictionaryEntry` is the **only** place the lexicon ever changes — never
  from `interpret()`, never from repeated exposure to the same unknown word, no matter the
  confidence. `resolveVoiceTranscript` never mutates anything.
- An approval defaults to **context-scoped** (`contexts: [decisionType]`) — the exact decision `type`
  the proposal was observed in — never silently global, per spec "Contextual learning": the same
  word approved while declaring attackers must not silently mean the same thing during priority.
  `voice-panel.ts` exposes exactly the spec's four actions for a proposal: execute without learning,
  execute + remember (this situation), correct (edit the always-visible transcript field and
  re-interpret), cancel.

## 7. Multi-step / compound decisions

Fully supported for **one specific, common shape**: a compound attack or block declaration naming
several different creatures in one sentence ("j'attaque avec K'rrik et Vilis"), when each name has
its OWN exact card match (never a bare verb, never a fuzzy match — a plan auto-executes without a
per-step confirmation, so every step must already be solid on its own).
`voice-resolver.ts`'s `detectAttackOrBlockPlan` recognizes this shape and returns an ordered
`{ kind: "plan", steps }` resolution instead of a false "ambiguous" (two legitimately-simultaneous
adds would otherwise look like a tie). `voice-runner.ts`'s `advancePlan` then walks it one Forge
decision at a time:

1. wait for the next authoritative decision (`playtest-view.ts`'s `revealLiveState` — the same place
   a live decision becomes visible to a human — calls `voicePanel.refresh()`, which calls
   `advancePlan()`),
2. re-resolve the next planned card against the NEW decision's own legal items (never the ones the
   plan was built from),
3. submit the NEW `AgentChoice` this produces (never replay the old one with a new decision ID),
4. abort the remaining plan (recorded, surfaced in the panel) the moment the new decision doesn't
   match — wrong decision type entirely, or the next planned card no longer legal.

**Deliberately out of scope for V0** (see `detectAttackOrBlockPlan`'s doc comment):

- a plan never auto-submits the trailing "Finish declaring attackers/blockers" — the human still
  says/clicks that explicitly, so a mis-detected plan can never lock in more than intended;
- only `attackers_selection`/`blockers_selection` "add" actions are covered; a compound instruction
  spanning other decision families (e.g. naming several targets in one `target_selection`, which
  normally requires exactly one, or a `mode_selection`/`cost_object_selection` multi-pick) is not
  attempted and stays a normal single-target resolution.

## 8. Explicitly out of scope for this pass

- `card_picker` / `opening_hand` / `physical_declare` decision prompts: `generateCandidates` returns
  no candidates for these `DecisionPrompt` kinds (resolves as `unrecognized`, never mis-handled).
  `physical_declare` in particular is already a card-name search (`physical-declare.ts`) and would be
  a natural, low-risk voice target for a follow-up pass, reusing `voice-card-matching.ts` directly.
- Any LLM, unrestricted free-text understanding, camera-based recognition, or automatic/implicit
  vocabulary learning of any kind.

## 9. Frontend integration

- `playtest-view.ts` creates a `VoiceRunner` (once, lazily, reused across games in the tab — its
  approved vocabulary is what needs to persist) and a `VoicePanelHandle` (rebuilt per game, like
  every other game-screen element), **only** when `currentPlayMode === "physical"` — Digital mode
  never imports/mounts anything from `voice/`.
- The runner's `submit` dependency is `submitChoice` itself — the exact function a card click already
  calls. Voice never creates a second choice-submission path and never re-implements
  `DecisionGate`/frame-playback/`submitting` guards; its own `canAct()` is a UX-only pre-check for
  honest panel feedback, not the real enforcement.
- `voicePanel.refresh()` (which calls `advancePlan()`) is called from exactly one place:
  `revealLiveState`, the same function that reveals a freshly-polled live decision to the human once
  frame playback is idle — never from a raw poll tick, never mid-playback.

## 10. Tests

`frontend/src/voice/*.test.ts`, 59 tests, plain `node:test` (no DOM, no mocked microphone):
`transcript-normalizer`, `voice-lexicon`, `voice-card-matching`, `voice-candidates`,
`voice-resolver`, `voice-runner`, `voice-vocabulary-store`. Covers (non-exhaustive): the three swamp
phrasings, the same verb resolving differently by referenced card, exact/fuzzy/no card matching, an
irrelevant sentence, pass/yes/no/target/numeric resolution, context changing candidate ranking,
"unknown vocabulary never mutates the dictionary", "approved dictionary addition persists",
"contextual association affects only its context", stale-decision/no-plan-advance-during-playback
protection (via the injected `canAct`), and the compound attack plan (advance/abort/never-resubmit).

All pre-existing frontend tests (189) and Digital behavior are unmodified.

## 11. Remaining work for the next voice iteration

- Wire `physical_declare` through the same resolver/lexicon (a natural next target — see §8).
- A UI toggle for a "global" (not just context-scoped) dictionary approval — the lexicon/store shape
  already supports `contexts: null`; only `voice-panel.ts` needs the extra button.
- Extend the compound-plan detector beyond attackers/blockers "add" (e.g. a multi-select
  `cost_object_selection`/`ordering_selection`) if real playtests show it's needed.
- Tune `voice-scoring.ts`'s thresholds against real speech-to-text output — V0's numbers are
  reasoned-through defaults, not yet calibrated against a real microphone/browser STT session.
- Consider interim (non-final) STT results for lower perceived latency once the above is stable.

## 12. Validation

```sh
cd frontend && npm run build && npm test
```
