# V1j: external combat decisions

Status: V1j validated with the explicit damage/legacy-order limitations below.
Forge is pinned at `6356c1ad565029c82513c96e42ad5492c1b09c4e`.

## Exact pinned call paths

The following paths refer to the original source under `vendor/forge`.

| Stage | Call path and native responsibility |
| --- | --- |
| Attacks | `PhaseHandler.declareAttackersTurnBasedAction` → `PlayerController.declareAttackers(Player, Combat)` → `CombatUtil.validateAttackers(Combat)`, retrying invalid declarations. AI delegates to `AiController.declareAttackers`; human uses `InputAttack`. |
| Defenders | `Combat.initConstraints` → `CombatUtil.getAllPossibleDefenders`: opponent players, planeswalkers and battles protected by opponents. |
| Attack legality | `CombatUtil.canAttack(Card, GameEntity)` checks individual eligibility. Complete validation compares `AttackConstraints.countViolations(Map<Card, GameEntity>)` with `getLegalAttackers()`. `AttackRestriction` contains individual/group restrictions; `AttackRequirement` contains defender-specific, goad and must-attack requirements. |
| Attack mutation | `Combat.addAttacker(Card, GameEntity)` / `removeFromCombat(Card)`. PhaseHandler later taps, pays costs and fires triggers. |
| Attack costs | PhaseHandler → `getOptionalAttackCostCreatures` for `CostExert` / `CostEnlist` → controller `exertAttackers` / `enlistAttackers` → `CombatUtil.checkPropagandaEffects`. Failed payments can invalidate declarations. |
| Blocks | `PhaseHandler.declareBlockersTurnBasedAction` → DeclareBlocker replacement → controller `declareBlockers(Player, Combat)`. AI uses `AiController.declareBlockersFor`; human uses `InputBlock`. The bridge must itself call `CombatUtil.validateBlocks(Combat, Player)`; PhaseHandler has no attack-style declaration retry loop here. |
| Block legality | `CombatUtil.canBlock(attacker, blocker, combat)` checks capacity, eligible attackers, lure/must-block constraints and pairwise blocking restrictions. The native pairwise checks include flying/reach and protection. `validateBlocks` checks mandatory blocks, group restrictions and `canAttackerBeBlockedWithAmount` (including menace). |
| Block mutation/costs | `Combat.addBlocker(attacker, blocker)` / `removeBlockAssignment(attacker, blocker)`. PhaseHandler calls `CombatUtil.payRequiredBlockCosts` and removes invalid blocks. |
| Ordering | `Combat.orderBlockersForDamageAssignment` → controller `orderBlockers`; `orderAttackersForDamageAssignment` → controller `orderAttackers`. These are strategic callbacks only for multiple combatants with `GameRules.hasOrderCombatants()` enabled. Modern mode skips them. |
| Damage | PhaseHandler → `Combat.assignCombatDamage(boolean)` → private `assignAttackersDamage` / `assignBlockersDamage` → controller `assignCombatDamage(Card, CardCollectionView, CardCollectionView, int, GameEntity, boolean)` → native damage tables → `dealAssignedDamage`. Ordinary unblocked damage is computed directly inside Combat. |
| First/double strike | `Combat.dealDamageThisPhase` and `combatantsThatDealtFirstStrikeDamage` determine who assigns in each damage step. The bridge does not simulate those steps. |

## Protocol and retained objects

The existing broker publishes `attackers_selection`, `blockers_selection`, and
`combat_order_selection` in `ForgePendingExternalDecision`. Submit through
`submitCombatChoice` using the existing `objectId` selector. No separate broker.

Each decision has `decisionId`, `playerId`, native phase `context`, `options`
and `selected`. Options contain an opaque `objectId`, operation (`add`,
`remove`, `finish`, `order`), `cardRef`, `relatedRef` and public label. Related
references identify attack defenders or blocked attackers. For ordering,
`selected` contains the ordered prefix and options contain remaining cards.

This is an editable native declaration, like Forge's human input. An `add`
option is a Forge-eligible edge, not a promise that the resulting incomplete
declaration satisfies all group requirements. Node can undo choices. `finish`
exists only when Forge validates the complete declaration, including mandatory
attacks/blocks. Multiple blockers and blocking capacity use Forge's helpers.

The game thread retains exact `Card` / `GameEntity` objects and applies native
combat edits after the broker wait. Each observation and decision is captured
together between edits. Unknown IDs do not consume the pending decision;
consumed IDs remain stale. Cancellation releases pending choices. Labels use
public references, avoiding face-down identity disclosure. No production card
name lookup, TypeScript legality, tapping, or custom damage algorithm is added.

## Explicit limitations

Session snapshots expose `forgeAiStrategicFallbacks`, listing family, method,
source reference when available and reason. This instruments combat only; it
does not yet claim an exhaustive controller audit.

| Shape | Behavior |
| --- | --- |
| Ordinary declarations | External; Forge validates and executes. |
| Player/planeswalker/battle defender | Exact Forge defender set. Only player attacks currently have dedicated E2E coverage. |
| Banding / bands with other | Explicit whole-declaration AI fallback. |
| Attack/block taxes | Explicit whole-declaration AI fallback, detected with native cost queries before edits. Primary-action mana payment does not yet compose safely with combat costs. |
| Optional exert/enlist | Explicit attack-declaration fallback. |
| Multiplayer / another player's declaration | Explicit fallback. Normal 1v1 ownership is the supported scope. |
| Modern ordering | No strategic ordering callback in pinned Forge. |
| Legacy ordering callback | Retained-object external permutation, awaiting dedicated legacy-mode E2E validation. |
| Controller damage assignment (including trample and multi-block distribution) | Explicit AI fallback. Combat consumes the returned map without a reusable engine legality validator. |
| Ordinary unblocked damage | Deterministic native Combat execution without a strategic controller callback. |

Damage fallback is not described as rules-only: `PlayerControllerAi` calls
`ComputerUtilCombat.distributeAIDamage`, which chooses order, distribution and
sometimes delays tramplers to assign other attackers first. Human assignment
uses `PlayerControllerHuman` → GUI `assignCombatDamage` → desktop/mobile
`VAssignCombatDamage`. The legality controls (`canAssignTo`, `checkDamageQueue`,
`getDamageToKill`, remaining-damage checks) are private UI logic, not a reusable
headless validator. Externalizing those allocations safely remains a gap.

## Validation fixtures

Real-process tests use Isamaru/Savannah Lions against a Forest-only Ghalta deck
for zero/exact/multiple attacks, life totals, tap state, stale and invalid IDs.
Block fixtures use Memnite against Grizzly Bears and Memnite/Ornithopter against
Skyhunter Skirmisher for flying eligibility and double-strike step behavior.
These repeated-card decks are deterministic fixtures, not singleton deck
examples.

Validation: `./scripts/forge-build.sh` and `./scripts/forge-test.sh` pass (3 JVM
checks, 45 real-process integration tests including 3 new combat fixtures).
`backend/npm test`: 16 passed. Backend and frontend builds pass. `git diff
--check` passes. The pinned Forge submodule is clean and unchanged.

The modern-rule fixtures do not invoke the historical ordering callback; no
legacy-order E2E PASS is claimed. Damage distribution remains an explicit
strategic fallback, even when ordinary declarations are externally selected.
