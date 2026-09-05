# V1k controller audit and remaining limitations

Pinned Forge: `6356c1ad565029c82513c96e42ad5492c1b09c4e`.
A = externally handled within documented limits; B = deterministic/rules or
informational; C = common strategic gap still to close; D = explicit unsupported
AI fallback; E = outside current Commander scope. Rows grouped by method name
include overloads. Runtime delegates are implemented in `AuditedPlayerControllerAi`.
This generated inventory is a coverage checklist, not an assertion that all
families have E2E PASS status. Implementation bodies and downstream callers
must be considered before promoting any row to supported status.

| Controller method | Class | Coverage |
| --- | --- | --- |
| `getAbilityToPlay` | A / D | External candidate selection; unsupported branches remain recorded |
| `divideShield` | D | Inherited strategic AI path, recorded on invocation |
| `specifyManaCombo` | D | Inherited strategic AI path, recorded on invocation |
| `announceRequirements` | A / D | External override; this delegate records unsupported branches |
| `choosePermanentsToSacrifice` | A / D | External override; this delegate records unsupported branches |
| `choosePermanentsToDestroy` | A / D | External override; this delegate records unsupported branches |
| `chooseCardsForEffect` | A / D | External override; this delegate records unsupported branches |
| `chooseContraptionsToCrank` | D | Inherited strategic AI path, recorded on invocation |
| `helpPayForAssistSpell` | D | Inherited strategic AI path, recorded on invocation |
| `choosePlayerToAssistPayment` | D | Inherited strategic AI path, recorded on invocation |
| `chooseSingleEntityForEffect` | A / D | External override; this delegate records unsupported branches |
| `chooseEntitiesForEffect` | A / D | External override; this delegate records unsupported branches |
| `chooseSpellAbilitiesForEffect` | A / D | External candidate selection; unsupported branches remain recorded |
| `chooseSingleSpellForEffect` | A / D | External candidate selection; unsupported branches remain recorded |
| `confirmAction` | A / D | External override; this delegate records unsupported branches |
| `confirmBidAction` | D | Inherited strategic AI path, recorded on invocation |
| `confirmStaticApplication` | A / D | External override; this delegate records unsupported branches |
| `confirmTrigger` | A / D | External override; this delegate records unsupported branches |
| `confirmPayment` | D | Inherited strategic AI path, recorded on invocation |
| `confirmReplacementEffect` | A / D | External override; this delegate records unsupported branches |
| `exertAttackers` | D | Inherited strategic AI path, recorded on invocation |
| `enlistAttackers` | D | Inherited strategic AI path, recorded on invocation |
| `orderBlocker` | D | Inherited strategic AI path, recorded on invocation |
| `arrangeForScry` | A / D | External candidate selection; unsupported branches remain recorded |
| `arrangeForSurveil` | A / D | External candidate selection; unsupported branches remain recorded |
| `willPutCardOnTop` | D | Inherited strategic AI path, recorded on invocation |
| `orderMoveToZoneList` | A / D | External override; this delegate records unsupported branches |
| `chooseCardsToDiscardFrom` | A / D | External override; this delegate records unsupported branches |
| `playSpellAbilityNoStack` | A / D | External override; this delegate records unsupported branches |
| `chooseCardsToDelve` | D | Inherited strategic AI path, recorded on invocation |
| `chooseCardsToDiscardUnlessType` | D | Inherited strategic AI path, recorded on invocation |
| `chooseSomeType` | D | Inherited strategic AI path, recorded on invocation |
| `vote` | D | Inherited strategic AI path, recorded on invocation |
| `chooseSector` | D | Inherited strategic AI path, recorded on invocation |
| `chooseSprocket` | D | Inherited strategic AI path, recorded on invocation |
| `choosePDRollToIgnore` | D | Inherited strategic AI path, recorded on invocation |
| `chooseRollToIgnore` | D | Inherited strategic AI path, recorded on invocation |
| `chooseDiceToReroll` | D | Inherited strategic AI path, recorded on invocation |
| `chooseRollToModify` | D | Inherited strategic AI path, recorded on invocation |
| `chooseRollToSwap` | D | Inherited strategic AI path, recorded on invocation |
| `chooseRollSwapValue` | D | Inherited strategic AI path, recorded on invocation |
| `mulliganKeepHand` | A / D | External override; this delegate records unsupported branches |
| `tuckCardsViaMulligan` | A / D | External override; this delegate records unsupported branches |
| `chooseSpellAbilityToPlay` | A / D | External override; this delegate records unsupported branches |
| `playChosenSpellAbility` | A / D | External override; this delegate records unsupported branches |
| `chooseCardsToDiscardToMaximumHandSize` | A / D | External override; this delegate records unsupported branches |
| `chooseCardsToRevealFromHand` | D | Inherited strategic AI path, recorded on invocation |
| `chooseStartingPlayer` | A / D | External override; this delegate records unsupported branches |
| `chooseStartingHand` | D | Inherited strategic AI path, recorded on invocation |
| `chooseSaToActivateFromOpeningHand` | D | Inherited strategic AI path, recorded on invocation |
| `chooseNumber` | D | Inherited strategic AI path, recorded on invocation |
| `chooseNumber` | D | Inherited strategic AI path, recorded on invocation |
| `chooseNumber` | D | Inherited strategic AI path, recorded on invocation |
| `chooseFlipResult` | D | Inherited strategic AI path, recorded on invocation |
| `chooseTarget` | D | Inherited strategic AI path, recorded on invocation |
| `chooseBinary` | A / D | External candidate selection; unsupported branches remain recorded |
| `chooseBinary` | A / D | External candidate selection; unsupported branches remain recorded |
| `chooseModeForAbility` | A / D | External override; this delegate records unsupported branches |
| `chooseColorAllowColorless` | D | Inherited strategic AI path, recorded on invocation |
| `chooseColor` | D | Inherited strategic AI path, recorded on invocation |
| `chooseColors` | D | Inherited strategic AI path, recorded on invocation |
| `chooseCounterType` | D | Inherited strategic AI path, recorded on invocation |
| `chooseKeywordForPump` | D | Inherited strategic AI path, recorded on invocation |
| `chooseSingleReplacementEffect` | A / D | External override; this delegate records unsupported branches |
| `chooseProtectionType` | D | Inherited strategic AI path, recorded on invocation |
| `payManaCost` | A / D | External override; this delegate records unsupported branches |
| `payCombatCost` | D | Inherited strategic AI path, recorded on invocation |
| `chooseCardsForCost` | D | Inherited strategic AI path, recorded on invocation |
| `applyManaToCost` | A / D | External override; this delegate records unsupported branches |
| `getCostDecisionMaker` | A / D | External override; this delegate records unsupported branches |
| `payCostToPreventEffect` | D | Inherited strategic AI path, recorded on invocation |
| `payCostDuringRoll` | D | Inherited strategic AI path, recorded on invocation |
| `orderSimultaneousSa` | A / D | External override; this delegate records unsupported branches |
| `orderAndPlaySimultaneousSa` | A / D | External override; this delegate records unsupported branches |
| `playTrigger` | A / D | External override; this delegate records unsupported branches |
| `playSaFromPlayEffect` | A / D | External override; this delegate records unsupported branches |
| `chooseTargetsFor` | A / D | External override; this delegate records unsupported branches |
| `chooseNewTargetsFor` | D | Inherited strategic AI path, recorded on invocation |
| `chooseCardsPile` | D | Inherited strategic AI path, recorded on invocation |
| `cheatShuffle` | D | Inherited strategic AI path, recorded on invocation |
| `chooseCardsForConvokeOrImprovise` | D | Inherited strategic AI path, recorded on invocation |
| `chooseCardName` | D | Inherited strategic AI path, recorded on invocation |
| `chooseCardName` | D | Inherited strategic AI path, recorded on invocation |
| `chooseSingleCardForZoneChange` | A / D | External override; this delegate records unsupported branches |
| `chooseCardsForZoneChange` | A / D | External override; this delegate records unsupported branches |
| `chooseSingleCardFace` | D | Inherited strategic AI path, recorded on invocation |
| `chooseSingleCardFace` | D | Inherited strategic AI path, recorded on invocation |
| `chooseSingleCardState` | D | Inherited strategic AI path, recorded on invocation |
| `chooseCardsForSplice` | D | Inherited strategic AI path, recorded on invocation |
| `chooseOptionalCosts` | A / D | External override; this delegate records unsupported branches |
| `chooseNumberForKeywordCost` | D | Inherited strategic AI path, recorded on invocation |
| `chooseNumberForCostReduction` | D | Inherited strategic AI path, recorded on invocation |
| `chooseCardsForEffectMultiple` | D | Inherited strategic AI path, recorded on invocation |

| Other methods | Class | Evidence |
| --- | --- | --- |
| declareAttackers, declareBlockers | A/D | V1j native complete-declaration validators; explicit costs/banding/multiplayer fallback. |
| assignCombatDamage | D | V1j records every controller damage distribution. |
| orderBlockers, orderAttackers | A with limitation | V1j retained permutation, modern engine does not invoke legacy seam. |
| reveal, tempShowCards, endTempShowCards, notifyOfValue, revealAISkipCards, revealUnsupported | B | Informational UI callbacks; not acceptance decisions. Temporary reveal visibility in generic DTOs remains limited. |
| getGame, getMatch, getPlayer, getLobbyPlayer, getAi, isAI, isGuiPlayer, getFullControl, isFullControl, canPlayUnlimitedLands, isOrderedZone, getAnteResult | B | Accessors/configuration. isAI remains true for compatibility and therefore needs explicit scrutiny at effect call sites. |
| resetAtEndOfTurn, autoPassCancel, awaitNextInput, cancelAwaitNextInput | B | AI memory reset or no-op UI input hooks. |
| chooseManaFromPool | B with limitation | Pinned AI returns first entry; special shard selection remains outside deterministic mana support. |
| chooseSingleStaticAbility, orderCosts | B with limitation | Pinned first-entry / input-order behavior; full-control timestamp and cost-order strategy not implemented. |
| sideboard, chooseCardsYouWonToAddToDeck, revealAnte, complainCardsCantPlayWell, acceptsDrawOffer | E | Sideboarding/ante/match-level UI outside single Commander game. |
| pilotsNonAggroDeck, setupAutoProfile | E | AI profile plumbing, not Node policy. |
| PlayerController final convenience overloads | B | Delegate to the listed virtual controller seams. |

## Scope and actual evidence

The common external families are `yes_no`, `object_selection` and
`ordering_selection`, using the same broker and the existing `objectId` selector.
Each staged selection contains native min/max bounds, whether it may finish,
the selected prefix, sanitized labels, and exact retained candidates. No new
cost-selection family replaces V1h. Single mandatory candidates are returned
deterministically; no AI chooses them. Hidden candidates remain labeled with
opaque references when Forge's card view does not expose their identity.
Temporary search/reveal information is not yet added to AgentObservation.

`GameAction.handleLegendRule` supplies the already filtered `CardCollection`
to `chooseSingleEntityForEffect`; the bridge returns the exact chosen permanent.
`GameAction` commander state-based actions ask `confirmAction` before returning
a commander from graveyard/exile to command. Hand/library commander replacements
use the native replacement system; `confirmReplacementEffect` and
`chooseSingleReplacementEffect` now have external seams. Forge still owns
replacement layering, commander tax, casting counts, and commander damage.
Multiple commanders are not a dedicated validated fixture.

The original AI trigger path was `orderAndPlaySimultaneousSa` / `playTrigger`
→ private `prepareSingleSa` → `AiController.doTrigger`; this bypassed the
controller target callback. Ordinary noncopied triggers now use the shared
native `PlaySpellAbility` execution paths, matching the human controller.
`chooseTargetsFor` no longer requires an accepted primary action, and supported
single modes also work outside primary actions. `source.actionId` is null for
these decisions. Random/divided targets and unsupported mode shapes still
reach recorded AI delegates. Copied/mixed ability groups explicitly retain
the old preparation path. Cost objects inside triggers use the audited cost
visitor; nonprimary complex payments remain a recorded gap.

Trigger ordering expresses **resolution order**, first chosen resolves first;
native stack insertion occurs in reverse. Mandatory triggers are not optional
acceptance decisions. `confirmTrigger` returns true immediately when mandatory.
Optional confirmations pause only when Forge asks for acceptance.

Pregame policy is explicitly fixed **keep opening hand / choose self to start**.
`cheatShuffle` preserves the native shuffled input instead of letting AI reorder
it. This is a baseline policy, not full external mulligan strategy. London
bottoming has a candidate-selection seam but no normal keep-only E2E coverage.
Special starting hands and opening-hand abilities remain recorded fallbacks.

New real-process fixtures prove:

- Viashino Pyromancer ETB: Node selects itself as the player target, independent
  of the accepted primary action; native life total becomes 38.
- Soul's Attendant: Node declines and accepts optional triggers; simultaneous
  triggers resolve in the Node-selected source order and life changes.
- Two Isamaru permanents: Node selects the exact cardRef to remain; the other
  leaves battlefield and appears in the native graveyard/command zone.

Replacement choice, hidden search presentation, and legacy ordering do not
receive an E2E PASS merely because their callbacks exist.

## Remaining strategic AI boundary

The D rows remain explicit gaps: complex payment/reduction/splice/convoke/delve,
retargeting or copied groups, arbitrary numbers/colors/card-name
choices, specialized multi-group selections, exotic dice/voting/contraptions,
starting-hand variants, and exotic combat. `AuditedPlayerControllerAi` records
invocations; `AsphodelCostDecision` records unsupported cost selections. Basic
mana abilities' zero mana payment is deterministic plumbing, not a strategic
fallback. Effects retaining arbitrary AI internals are never labeled supported.

A method returning the first option is still potentially strategic. The
historical B-with-limitation rows for static/cost/shard order above must not be
read as a universal rules-only guarantee. Static-ability selection is now
external; special mana-pool shard and full-control cost ordering remain gaps.

The game module's `isAI` sites were also inspected: sideboarding and UI control
flags are outside scope; PhaseHandler imposes an AI loop guard; ChangeZoneEffect
uses iterative selection instead of its human multiselect UI; CopyPermanentEffect
and PlayEffect filter AI-unsuitable generated card choices (unsupported generated
card shapes); Camouflage has an AI-only alternate block path (unsupported);
Cryptic Spires pregame color selection reaches the logged color callback.


Scry/surveil now return a Node-selected top/other partition and native-order
permutations. Only the cards Forge explicitly supplied for looking at are
shown in those option labels. Forge applies the movement, scry/surveil triggers,
and subsequent draw. Opt and Consider fixtures verify the exact runtime card
ends in hand or graveyard. Generic library searching still has the temporary
visibility limitation above.


## V1k gate

Full Forge build/test: 3 JVM tests and 50 real-process integration tests pass.
Backend: 16 tests pass; backend and frontend builds pass. `git diff --check`
passes; vendor/forge remains clean at the pinned SHA. V1k adds no intelligent
agent, dataset persistence, or frontend gameplay. The recorded D categories
remain explicit limitations, not supported strategic decisions.


## V1l follow-up

The full-game check externalizes `chooseCounterType` through the generic
candidate selector (single mandatory candidates are deterministic), and routes
nominal zero-mana ability payments through native player payment setup.
These close the extra calls exposed by Krenko's native attack trigger.
See the [final readiness report](external-controller-readiness-v1l.md) for the
scoped zero-fallback assertion and the two allowed damage fallback calls.
