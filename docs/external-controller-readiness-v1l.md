# External controller readiness: V1j–V1l

**YES WITH LIMITATIONS.** An external Node controller can drive a real Commander
1v1 game through Asphodel. This is still a hybrid controller: damage distribution
and the explicit unsupported families in the audit can use Forge AI. It is not
a claim that an arbitrary Commander deck is fully externally piloted.

## Commits and scope

| Milestone | Commit |
| --- | --- |
| V1j: external combat decisions | `a91857b0ef2673e6b1d06f33798b5f4127093760` |
| V1k: external remaining strategic decisions | `6287a5b5a4d5a24238656f8278e100fb8510e236` |
| V1l: full external controller validation | This report is included in the separately named V1l commit; use `git log --oneline -3` for its SHA. |

Base: `c2fbecb5e911efde3185e2fc1cc2aa812ca289ac`.
Forge remains exactly `6356c1ad565029c82513c96e42ad5492c1b09c4e`.

## V1j results

The [combat research and protocol report](external-controller-v1j.md) records
the pinned call paths through PhaseHandler, PlayerController/Ai/Human, Combat,
CombatUtil, AttackConstraints, AttackRequirement and AttackRestriction.

New DTO families are `attackers_selection`, `blockers_selection` and
`combat_order_selection`. Staged add/remove/finish choices retain native objects
and cross-link with observation cardRefs. Native complete-declaration validation
gates finish. Tests prove zero, exact and multiple attacks with life/tap-state
effects; zero, exact and multiple blocks on one attacker with graveyard effects;
flying eligibility; double-strike damage-step behavior; and stale/invalid IDs.
Independent block edges use the same native pairwise and capacity checks.

Planeswalker/battle defenders come from Forge's defender set, but dedicated
E2E fixtures are not claimed for those targets. Historic damage-order callbacks
have an external permutation seam, but modern Forge does not invoke them and
no legacy-rule E2E PASS is claimed. Native first/double-strike processing is
unchanged. Damage allocation is an explicit AI fallback because the pinned
headless engine consumes controller allocations without a reusable validator.
Other combat fallback categories are taxes, exert/enlist, banding, multiplayer
and declaration on another player's behalf.

## V1k results

The [controller audit](external-controller-audit-v1k.md) inventories inherited
and overridden methods, native dispatch paths and remaining limitations.
`AuditedPlayerControllerAi` records unsupported delegated calls, while
`AsphodelCostDecision` records unsupported strategic cost selections.

| Family | Result and proof |
| --- | --- |
| Yes/no and may triggers | Soul's Attendant acceptance/decline changes native life totals. Mandatory triggers are not acceptance decisions. |
| Trigger targets | Viashino Pyromancer targets self by Node choice and deals 2 damage. No accepted-primary-action requirement. |
| Trigger order | Node chooses the resolution order of simultaneous Soul's Attendant triggers; the first resolving source is checked. |
| Generic entities/cards | Native caller candidate sets and bounds, retained objects, staged selection with finish. Legend-rule fixture proves exact permanent retention. |
| Legend rule | Two Isamaru permanents: chosen cardRef remains, the other leaves for the native graveyard/command zone. |
| Scry/surveil | Opt/Consider prove the chosen native card moves to hand/graveyard. Only the supplied looked-at cards are shown. |
| Replacement effects | External optional-confirmation and multiple-replacer choice seams; no dedicated multiple-replacer E2E PASS. |
| Mulligan/start | Explicit keep-opening-hand/self-start policy and native shuffle. Full strategic mulligan not implemented; bottoming seam unproven in keep-only games. |
| Commander | Native command-zone cast/tax/tracking retained; command-zone return confirmation external. Multiple commanders and all replacement destinations not exhaustively tested. |

Random/divided targets, copied groups, complex costs/mana, arbitrary
number/color/card-name choices, unusual pregames and specialized selections
remain documented limitations. Hidden search candidates retain opaque identity,
but temporary reveal information is not yet a complete observation capability.

## V1l architecture and flagship result

`backend/src/forge/testing/external-controller-driver.ts` is **test tooling**.
It consumes the public bridge protocol with an exhaustive decision-type switch.
It plays a supplied legal land, prioritizes a legal command-zone cast, otherwise
takes the first supplied cast/activation or passes. It uses first candidates
for other supported decisions, declines optional costs, adds all eligible
attackers, and chooses no blocks when Forge permits finishing. This is a fixed
fixture policy, with no evaluation function or production agent.

Player 1 is `PlayerControllerAsphodel`, controlled by Node; player 2 is Forge
AI. Existing single-session architecture supports this configuration. Two
external players were not added.

Each deck has one commander, 42 basic lands and 57 distinct printed creatures:
Krenko, Tin Street Kingpin with Mountains versus Ghalta, Primal Hunger with
Forests. The fixture includes numerous Goblins and native Krenko token creation.
The exact singleton lists live in `testing/commander-fixtures.ts`; these are
simple validation decks, not tuned agent decks.

Flagship seed **42**:

| Evidence | Observed result |
| --- | --- |
| Game | Naturally completed, Ghalta/Forge AI wins (`AllOpponentsLost`) |
| Turns | **12 Forge turns** (individual player turns, not 12 complete rounds) |
| External decisions | **135** distinct decisions |
| Primary decisions | 119, including 113 passes |
| Primary actions completed | 3 lands and 3 spells |
| Mana choices | 8; zero mana-payment fallback count |
| Other exercised decisions | Attack declarations, block declarations, yes/no commander return |
| State evidence | Life decreases, battlefield grows, cards reach graveyard, commanders retain exact references, commander casts and Goblin token creation occur |
| Supported/unexpected fallback count | **0** |
| Explicit unsupported damage fallback calls | **2**, both `assignCombatDamage`, with retained source cardRef and reason |
| Deadlock/stale leak | No watchdog failure; completed snapshot has no pending decision; JVM still answers ping |

The zero count is scoped: the test rejects every fallback except the documented
`combat_damage` family. It does not disguise those two calls as external decisions
or rules-only behavior. It does not prove every unsupported card/effect path
is externally controlled.

The long-run test exposed nominal zero-mana trigger execution and counter-type
selection still reaching AI. V1l routes zero-cost execution through native
`PlaySpellAbility` adjustment/payment and uses the generic counter candidate
selector. A single mandatory counter type needs no AI strategy or Node prompt.

## Watchdog, trace and serialization

The test driver has maximum decision, polling-step and elapsed-time limits.
Failures include the latest observation, pending decision and recent trace.
A real-game test forces the one-decision limit, verifies this diagnostic, then
cancels the session and verifies that no observation/pending decision leaks and
the bridge remains responsive.

The trace contains turn, phase, player, decision type/id, source and chosen
opaque ID/value. The flagship writes `asphodel-v1l-trace.json` and a diagnostic
`asphodel-v1l-debug.json` under the OS temporary directory (on this run, `/tmp`).
These are disposable test debugging artifacts, not dataset persistence.

The exhaustive driver handles priority, targets, modes, values, optional costs,
cost objects, mana, all combat DTOs, yes/no, generic selection and ordering.
The native integration suite exercises the existing decision families and V1k
families through NDJSON; paused observation/decision turn and phase are checked.
Legacy combat ordering remains explicitly unproven in an actual legacy game.

## Readiness matrix

| Core capability | Status | Practical limit |
| --- | --- | --- |
| Observe state | PASS WITH LIMITATION | Sanitized own/public state; incomplete temporary search/reveal and combat-state detail outside decision DTOs |
| Choose primary action | PASS WITH LIMITATION | Existing supported Forge action enumeration; library permissions and special actions remain gaps |
| Targets | PASS WITH LIMITATION | Ordinary primary/trigger targets; random/divided/retargeting/copied shapes remain gaps |
| Modes | PASS WITH LIMITATION | Existing single-mode semantics |
| X/values | PASS WITH LIMITATION | Existing bounded X shapes; arbitrary announcements not closed |
| Costs | PASS WITH LIMITATION | Existing optional/single sacrifice/discard support; complex cost visitor fallbacks recorded |
| Mana | PASS WITH LIMITATION | Basic deterministic payments, floating mana, Sol Ring, tested kicker/X; complex payments remain gaps |
| Combat | PASS WITH LIMITATION | Native validated declarations; **FORGE FALLBACK** for controller damage distribution and complex combat |
| Triggers | PASS WITH LIMITATION | Ordinary targets/acceptance/order native execution; copied/mixed groups remain fallback |
| Replacements | PASS WITH LIMITATION | Clean external controller seams; multiple-replacer E2E not established |
| Generic selections | PASS WITH LIMITATION | Supplied candidate sets, legend rule, scry/surveil proven; visibility/specialized shapes remain gaps |
| Mulligan | PASS WITH LIMITATION | Fixed keep/self-start only; full strategic mulligan **NOT IMPLEMENTED** |
| Commander decisions | PASS WITH LIMITATION | Casting, native counters/tracking, return confirmation; not exhaustive multi-commander/destination coverage |

Before a first real agent can operate without Forge AI strategy across arbitrary
Commander decks, close the explicit damage-distribution and payment gaps,
complete hidden-information presentation, validate replacement/legacy-order
seams, and extend the audited specialized families needed by that deck.
The present foundation can support a first agent restricted to the validated
scope, provided its use of documented fallbacks is explicit.

## Final validation gate

All required gates pass:

| Gate | V1j | V1k | V1l |
| --- | --- | --- | --- |
| `./scripts/forge-build.sh` / build inside `forge-test.sh` | PASS | PASS | PASS |
| JVM tests | 3 passed | 3 passed | 3 passed |
| Real-process integration tests (`./scripts/forge-test.sh`) | 45 passed | 50 passed | 52 passed |
| `backend/npm test` | 16 passed | 16 passed | 16 passed |
| Backend TypeScript build | PASS | PASS | PASS |
| Frontend build | PASS | PASS | PASS |
| `git diff --check` | PASS | PASS | PASS |
| `vendor/forge` status | Clean | Clean | Clean |

Forge SHA is unchanged at every gate:
`6356c1ad565029c82513c96e42ad5492c1b09c4e`.
Counts are suite totals at each milestone, not cumulative execution counts.
Final run logs are in `/tmp/asphodel-v1l-tests.log` and
`/tmp/asphodel-v1l-backend.log`.

All runtime objects and rule mutation remain Forge-owned. Node chooses the
supported strategic choices through the same `AsphodelDecisionBroker`; no
separate combat/trigger broker exists. No vendor edits, custom TypeScript Magic
rules, intelligent agent, ML, self-play, frontend gameplay or camera work was
added.
