# Physical Companion playtest stabilization

## Evidence and causes

Read-only source: homelab `/home/user/asphodel/backend/playtest-reports/2026-09-13_21-48_k-rrik-vs-elenda-gain-de-vie/decisions.json`, session `6a94e743-3195-4fae-a2c1-d5195f13b84a`, seed 32, 24 turns. The newest local reports contained no decisions.

- **Corruption:** physical declarations `decision-229` (turn 10) and `decision-383` (turn 14) incorrectly classified new command-zone objects as `library_to_command`; both accepted Swamp. Observations subsequently show Swamps `card-74` and `card-59` in Command. The first predates Mind Stone in the graveyard (turn 12). This establishes corruption independently of the user's sacrifice hypothesis. Command is no longer a declaration destination; commanders and immutable effects are excluded. `Card.equals/hashCode` already used Forge IDs, so Java object identity was NOT the demonstrated cause. Explicit integer tracking documents the contract. Shuffle now invalidates only library IDs, retaining known stack cards without confirming unrelated fresh arrivals. Known-card replacement is rejected; swaps preflight the whole batch and use native rollback membership writes to avoid duplicate zone-entry bookkeeping.
- **Stale UI:** successful submit cleared `submitting` while old polling snapshots and callbacks could survive. A session-scoped consumed-decision gate now rejects them, removes action mappings/menus immediately and prevents remounting the accepted decision. Backend `getState` already takes ordinary pending observations and decisions from one provider snapshot; that pairing was preserved.
- **K'rrik:** the new real-match regression exposed native AI `applyManaToCost`'s `assert(false)` placeholder when unsupported Phyrexian shards reached it. Audit delegation now calls its same native helper directly. More importantly, external payment supports Phyrexian shards and asks a contextual yes/no for life, using exactly Forge human payment operations (`canPayLife`, `payPhyrexian`, `decreaseShard`, `payLife`), reserving life until successful completion. Native keyword `PayLifeInsteadOf:B` is generic, not a card-name rule. No legality enumeration changes.
- **X:** report A0046 / decision-94 exposes Exsanguinate bounds `[0,0]`; agent chose the only supplied value. Bounds come from native announcement bounds intersected with `ComputerUtilMana.determineLeftoverMana`. The report cannot establish every intermediate native mana calculation. Do not override this bound. Agent text classification now recognizes X life loss/gain as well as damage, draws and tokens; unknown X remains conservative. Casting a legal but low-value X=0 spell is still possible.
- **Trigger clarity:** the yes/no renderer discarded existing source name/text. It now includes both and the original question; no new hidden data is queried.
- **Declaration:** initial post-mount input focus was missing; connected-node rAF autofocus added.
- **Token:** report's public name is `Human Soldier Token`; exact lookup missed Scryfall's token name. Forge's suffix is resolved exclusively inside the layout-filtered token catalogue, never by looking up the stripped name as a main-deck card. Exact printed-card behavior stays unchanged.
- **Combat:** physical human attackers/blockers decisions focus that player's board once per decision. Existing major combat banners are preserved. New decisions have a 650 ms Space guard rejecting buffered/held events. Physical nonlands are stably ordered Creature, Planeswalker/Battle, Artifact, Enchantment, other; Digital order and all Forge zones stay unchanged.

## Regression coverage

- `PhysicalIdentityCoordinatorTest`: real Forge known discard/reanimation/commander zone transitions, sacrifice movement versus fresh draw, genuine library-to-graveyard/battlefield/exile arrivals, shuffle with known stack/fresh hand, known-card swap rejection, atomic invalid batch rejection.
- `FromUnderTheFloorboardsPhysicalCompanionTest`: added full external physical match casting K'rrik through human life/payment decisions, then actually activating Mind Stone's sacrifice/draw; checks exact sacrificed ref, zone sizes, one draw declaration and surviving commander.
- `decision-gate.test.ts`: N consumption, stale poll and callback rejection, only N+1 actionable, rejected-request retry.
- `asphodel-v2b.test.ts`, `human-decision-render.test.ts`, `scryfall-provider.test.ts`, `land-zone.test.ts`: generic X patterns/zero bound, exposed trigger context with exact choice IDs, token-only aliases/clean fallback, stable non-mutating categories.
- `physical-polish-check.mjs`: autofocus and detached stale callback exercised in a real browser, alongside existing physical checks. Digital browser fixture now advances its decision ID after acceptance, as actual Forge does; existing assertions retained.

## Deliberate limits

This does not repair already-corrupted saved games; start a new match. The server and artwork were not changed. Token art variants sharing a name are still deterministic catalogue choices, not characteristic-level matching. Reactive library reconciliation still cannot undo effects already executed before its checkpoint; this pass does not redesign that architecture. Library peeks keep their existing declaration path. The report records AI decisions and commander availability, not all human click events: the exact historical no-op cannot be attributed solely to stale UI versus payment, although both boundaries now have regressions. Browser transport fixtures and real bridge tests are separate, not one live-server browser-to-JAR test.

## Validation

- Frontend production build and backend TypeScript build: passed.
- Frontend: 189 tests passed. Backend: 235 tests passed.
- Maven bridge: 30 tests passed (including 8 new coordinator tests and the new full K'rrik/Mind Stone scenario); vendor game suite: 3 passed. JAR rebuilt successfully.
- Physical polish browser checks: passed, including autofocus, consumed decision remount prevention and detached callback rejection.
- Digital browser checks: passed, including action menus, mana cancellation, resume and layout.
- `vendor/forge` clean at `6356c1ad565029c82513c96e42ad5492c1b09c4e`; artwork unchanged. `git diff --check` passed.

## Changed paths

Bridge: `PhysicalIdentityCoordinator.java`, `AsphodelDecisionBroker.java`, `PlayerControllerAsphodel.java`, `ForgeManaPaymentChoiceEnumerator.java`, `AuditedPlayerControllerAi.java`, `PhysicalIdentityCoordinatorTest.java`, `FromUnderTheFloorboardsPhysicalCompanionTest.java`.

Backend: `agent/improved-agent.ts`, `asphodel-v2b.test.ts`, `cards/scryfall-provider.ts`, `scryfall-provider.test.ts`, `human/human-decision-render.ts`, `human/human-decision-render.test.ts`.

Frontend: `playtest/decision-gate.ts`, `decision-gate.test.ts`, `playtest-view.ts`, `physical-declare.ts`, `physical-scene.ts`, `land-zone.ts`, `land-zone.test.ts`, `board-renderer.ts`.

Browser: `scripts/physical-polish-check.mjs`, `scripts/tabletop-visual-check.mjs`. This document records scope and remaining limitations.
