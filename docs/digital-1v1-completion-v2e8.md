# V2e.8 — Complete the Digital 1v1 Play Loop

Base: V2e.7.1 `90b0eb4`. Forge remains exactly `6356c1ad565029c82513c96e42ad5492c1b09c4e`
(`git -C vendor/forge status --short` empty). This closes the last major functional/product
frictions found during real human playtests, before development moves on to V2f (Physical
Companion) and A2 (multiplayer). No visual redesign, no AI policy change — V2e.7's Obsidian Table
is unchanged.

## 1. Archidekt URL → Deck Library

`ArchidektDeckSource`/`parseArchidektDeck`/`extractArchidektDeckId` remain the sole Archidekt
boundary (host validation, private-deck rejection, size/commander-count validation) — nothing here
duplicates that parser. `DeckService.createDeck` was split into a thin decklist-text parse step
plus a shared `createDeckFromEntries` (card resolution, cache, DB transaction) that a new
`importArchidektDeck(url)` now converges on too, so a URL import and a pasted decklist persist
through exactly the same code path. A failed import (bad host, private deck, wrong size/commander
count, unresolvable card) throws before any DB write — nothing partial is ever persisted. New route:
`POST /decks/import/archidekt`. The Deck Library modal gained an "Importer depuis" mode toggle
(decklist text / Archidekt URL); a successful import refreshes the library and opens the new deck
immediately. Printing preservation was intentionally left out per spec: names resolve exactly like
the existing direct-Archidekt-URL match-start path already does (same `ArchidektDeckSource`), so
behavior is consistent rather than silently better for one path and not the other.

## 2. Mulligan ownership

Forge remains the sole authority on Commander mulligan rules (free count, London-mulligan bottom
count) — nothing here reimplements that math. `PlayerControllerAsphodel.mulliganKeepHand` now
checks a new `AsphodelDecisionBroker.mulliganPlayerId` (threaded from `start_external_match`'s new
`mulliganPlayerId` field, itself set by `runHumanVsAgentMatch` to the human's player id): the human
seat gets a real `yes_no`/`mulligan_keep` decision; any other seat (Asphodel) keeps its existing
auto-Keep baseline (`return true`) with `BaselineAsphodelAgentV2b` completely untouched.
`tuckCardsViaMulligan` reuses the existing generic `object_selection`/`mulligan_bottom` machinery —
Forge's own `minSelections == maxSelections == cardsToReturn` drives exactly how many real cards
must be clicked, one at a time, never a typed number. `human-decision-render.ts` renders
`mulligan_keep` as a dedicated `opening_hand` prompt (Keep/Mulligan, real hand art) and any
card-oriented `object_selection` (zone_change, mulligan_bottom, cleanup_discard, scry/surveil, …) as
a `card_picker` prompt with Forge's own `selected`/`min`/`maxSelections` progress — both new,
additive `DecisionPrompt` kinds; `renderDecisionCards` (frontend, new `decision-cards.ts`) draws
them as Obsidian-Table-styled card surfaces instead of the generic menu.

## 3. Hidden-zone privacy boundary

The bug: a library-search option whose `cardRef` isn't in `AgentObservation` (correctly, since the
library is hidden) fell back to printing the bare `cardRef` ("card-48") instead of Forge's own
legal-option label ("Forest"). Fixed globally in `describeDecision`'s `object_selection`/`yes_no`/
`ordering_selection` branch: card known in the observation → rich `describeCard`; else Forge's own
`option.label` → bare `cardRef` only as a last-resort diagnostic. The candidate list is always
*exactly* the current decision's `options` — nothing new is added to `AgentObservation`, no library
contents are fetched, no hidden identity is resolved through any other lookup. A `presentationName`
is attached only for the CURRENT decision's explicit candidates (e.g. "Forest") so the frontend can
request ordinary `CardPresentation` art for it — presentation-only, thrown away the moment the
decision resolves; never written back into the observation or persisted as a "known library map".

## 4. Safe finite-choice mana (generalizing V2e.6.1, not hardcoding a card)

Root cause of the real Strangled Cemetery bug: V2e.6.1's mana-payment enumerator only recognized
the pinned Forge string `"Combo ColorIdentity"` (Command Tower). Real "or" duals
(`Produced$ Combo B G`, e.g. Strangled Cemetery, Woodland Cemetery, and the whole check-land/slow-
land family) are combo mana too, but with a literal fixed color list instead of the commander's
identity — `AbilityManaPart.getComboColors` already resolves *both* shapes correctly. So
`isSupportedFiniteChoicePart` (renamed from the narrower `isSupportedComboColorIdentityPart`) now
accepts either `"Combo ColorIdentity"` or the regex `Combo [WUBRGC]( [WUBRGC])*` — the literal
"list of plain color codes" shape — plus two additional conservative gates: the ability must
produce exactly one mana total, and no permanent on the battlefield may carry a mana-production
replacement effect. No card name, Oracle text parsing, or Scryfall lookup is involved anywhere.
Each legal color still externalizes as its own exact candidate (`sourceCardRef` shared, `color`/
`forcedColor` distinct, `produces: ["B"]`/`["G"]`, never a combined/vague shape), and selecting one
still goes through the existing `AbilityManaPart.setExpressChoice`/`clearExpressChoice` scoped
activation from V2e.6.1 — Forge still taps, produces, and pays. `hasManaReplacement` is
deliberately coarse (checks the whole battlefield, not just the source): if it can't be proven safe,
the ability is simply not externalized this turn, exactly like any other unsupported case.

## 5. Refresh/resume lifecycle

`initPlaytestView` calls `resumeActivePlaytestIfAny()` on boot: `GET /playtests/active` resumes the
exact in-memory session (frames marked already-seen via `FramePlaybackQueue.acknowledge` so nothing
re-animates, current observation/pending decision restored, polling resumed) whenever one exists and
isn't already terminal. A `PLAYTEST_ALREADY_RUNNING` (409) from a fresh "start" attempt now
auto-triggers the same resume instead of dead-ending in an error message; a failed resume (network
blip, stale/terminal session) falls back to setup with a manual "Resume active game" retry button —
never a state requiring `npm run dev` to be restarted. A 404 on an in-flight poll (session gone)
returns cleanly to setup. Poll reentrancy is guarded (a slow request can no longer race a
newly-started session). Backend-process restart is explicitly out of scope, as before: an in-memory
Forge match does not survive that, and the app returns to a normal lobby.

## 6. Intentionally unsupported / out of scope

Arbitrary combo mana beyond the finite-list/ColorIdentity shapes (e.g. "Any color", conditional or
variable production, non-tap costs) remains unsupported and falls back to Forge's native AI payment,
same as before. Archidekt printing preservation, Moxfield/other providers, mulligan strategy for
Asphodel, and any AI policy change are all out of scope for this milestone, per spec.

## 7. Tests

- **Backend unit**: Archidekt URL import success + every failure path (host/private/size/commander/
  resolution) never persists a partial deck (`deck-service.test.ts`); the `card-48` → label fallback
  and the new `card_picker` presentation shape (`human-decision-render.test.ts`).
- **Real Forge integration** (`forge-bridge.integration.test.ts`): a real human mulligan sequence —
  two real mulligans, real Forge-computed bottom counts (1 then 2), exact real cardRefs leaving hand
  only once the full batch commits, opponent hand never observable; a real Uurg/Strangled Cemetery
  game — both colors externalize and actually tap/pay through Forge, and a real Cultivate search
  exposes only Forest/Swamp labels for cards absent from hand/battlefield (proving the privacy
  boundary against genuine hidden Forge data, not a mock). Full suite: 59/59 (was 56 at V2e.6.1),
  including a rerun of the V2e.7.1 Complicate-cycling native-cancellation regression, unchanged.
- **Frontend unit**: 113/113, including the new `decision-cards.test.ts` (pure presentation-name
  extraction).

## 8. Manual / real-server verification (honestly reported)

No browser-automation tool is connected this session (offered and declined). What was verified for
real: `./scripts/dev.sh` was started for real, and the full resume lifecycle was driven with `curl`
against the live backend + a live Forge session — mid-`priority_action`, mid-`mulligan_keep`, and
mid-`mana_payment`, in each case confirming `GET /playtests/active` returns the exact same session
and that the exact resumed decision is genuinely still submittable (not stale); `PLAYTEST_ALREADY_
RUNNING` (409) and post-end `{active:false}` → immediate new game (no restart needed) were both
confirmed live. A real public Archidekt deck (`archidekt.com/decks/9238430`, 100 real cards) was
imported through the live `/decks/import/archidekt` endpoint with real Scryfall resolution, listed
in the Deck Library, and started as a real match reaching its opening-hand decision — then deleted
again to leave the developer's own Deck Library untouched. This is real backend + real Forge
verification, not a literal clicked-through browser F5; no display/browser tool was available to
go further this session.
