# V2a — Baseline Asphodel Agent v0

Baseline implemented on validated Asphodel `ddc4dcefb62e2962f1d770ddb8c15476b30452c7`.
Forge remains unmodified at `6356c1ad565029c82513c96e42ad5492c1b09c4e`.

## Architecture and input contract

`backend/src/agent/baseline-agent.ts` exports:

```ts
interface AsphodelAgent {
  choose(observation: AgentObservation, decision: ForgePendingExternalDecision): AgentChoice;
}
```

`BaselineAsphodelAgent` is a pure synchronous heuristic with one switch over decision families and shared visible-card scoring. There is no policy registry, service framework, strategy database or mutable policy state. `AgentChoice` carries the pending `decisionId`, a typed selector (`action`, `target`, `mode`, `value`, `optional_cost`, `object`, `mana`), an opaque supplied ID or integer, and a stable machine-readable reason.

The agent imports only protocol **types**. It has no access to the bridge client, Java objects, game internals, Forge AI evaluation, Scryfall, network, filesystem, or runtime card database. It reads public player/zone characteristics and its own hand from `AgentObservation`, and options/labels/source ability text supplied with the pending decision. It never indexes an opponent hand or library. Card names are not used to rank cards. Public characteristics of face-down battlefield cards remain usable; hidden identities are not needed.

The DTO boundary remains responsible for visibility sanitation, as validated in V1l. This is a structural information boundary, not an OS sandbox for arbitrary third-party agent implementations. The built-in agent obeys it by construction. The runner passes exactly these two DTOs to `choose`; telemetry, decklists and the terminal result never enter policy input.

`agent-runner.ts` owns the start/poll/choose/validate/submit loop through the existing `ForgeExternalMatchClient`. Bridge process startup/shutdown belong to the caller. The CLI starts/stops that process in `try/finally`. One external player plays against Forge AI; the existing bridge does not support two external controllers, so self-play is not added.

## Policies

Equal scores retain Forge's supplied option order. No ID, object or combination is invented.

| Family | Rule | Example reason |
| --- | --- | --- |
| Priority | Legal land, commander from command zone, creature, other permanent, recognizable useful activation, other spell, pass. Card type comes from the observation via `cardRef`. Unknown activations rank below pass to avoid repeatedly activating an unclassified ability. | `play_land_before_spells` |
| Targets | Lightweight source-text classification: damage favors hostile players; removal favors hostile cards; benefits favor friendly targets. Unknown semantics choose the first supplied target. Finish when the minimum is satisfied and Forge permits it. | `target_damage`, `first_legal_target` |
| Modes | Generic text preference: draw, tokens, damage, removal, counters, life, then original order. Finish at the required minimum. | `highest_static_mode_score` |
| Values | X is the smallest positive integer in range (1 for 0..positive; 0 for 0..0). Other values use the minimum. | `minimum_positive_legal_x` |
| Optional costs | Conservatively select the supplied decline option. | `decline_optional_cost` |
| Cost objects | Finish if permitted; otherwise choose the lowest visible score. Non-commanders are considered first whenever a legal alternative exists. | `lowest_visible_cost_object_score` |
| Mana | Legal floating mana first; otherwise minimize overproduction, prefer exact exposed shard color, then smaller production and supplied order. Native Forge supplies affordability/legal options. | `spend_legal_floating_mana` |
| Attackers | Prefer opposing player defenders; avoid zero-power attacks and a visibly stronger untapped enemy creature that could kill the attacker and survive. Keep creatures back at life <=10 or visible lethal pressure. | `attack_without_obvious_suicide` |
| Blockers | Favor surviving kills and value-neutral/favorable trades. Otherwise chump only under life pressure, preferring lower-value blockers. | `block_trade_or_life_pressure` |
| Combat edits | Finish a valid draft when no profitable addition remains. If finish is unavailable, use supplied additions/edits to satisfy mandatory restrictions. Combat order uses visible value and stable ties. | `complete_required_combat_draft` |
| Yes/no | Decline explicit pay/sacrifice/discard/lose prompts; otherwise Yes, with first-option fallback if the expected label is absent. | `decline_optional_self_cost` |
| Objects | Legend prompts keep the highest visible value. Scry/surveil keeps cards of visible value >=3; cards without exposed characteristics are kept in supplied order. Other unknown kinds use the first option. | `keep_highest_visible_legend` |
| Ordering | Highest visible source value first, stable ties; finish if only finish remains. | `stable_visible_impact_order` |

Visible score = 1000 for a publicly identified commander + twice nonnegative power + nonnegative toughness + type weight (creature 4, land 2, other 3) - 0.25 if tapped. An unavailable card has score 0, apart from its public commander marker. This is a baseline ranking, not a comprehensive evaluation.

The text classifier recognizes a few generic English patterns. It does not parse full Oracle text, search by card name, infer hidden characteristics, or reconstruct rules. Target and mana legality, payment, combat restrictions and resolution remain native Forge responsibilities.

## Legality, progress and determinism

Before submission, `validateChoice` checks the pending decision ID, selector family, membership in the supplied options, and integer value bounds. Invalid choices fail closed before transport. Forge validates again. A submitted decision ID is never submitted twice, even if polling returns the same paused snapshot again.

Runner defaults: 120 seconds, 5000 accepted decisions, 5000 consecutive idle polls, 2 ms between polls. AbortSignal, elapsed time, idle and decision limits trigger cancellation and an `AgentRunError` with the latest snapshot and last 20 choices. Cancellation failures are preserved alongside the original error. Individual transport calls retain `ForgeBridgeClient`'s finite request timeout (35 seconds by default); the runner checks its wall-clock limit between calls, so an in-flight call can delay cancellation. The CLI handles SIGINT/SIGTERM through AbortSignal and always stops the bridge.

A watchdog prevents an unbounded run; it does not prove every legal Commander position can be completed. Compound combat restrictions may cause a deterministic draft-edit cycle and eventually cancellation. The supported full-game fixture completes without a watchdog, stale submission or illegal submission. This is the tested scope of the quality gate, not a claim of complete Magic coverage.

There is no random source, time read, mutable cache or external query in the policy. For identical JSON input, the same first maximum is selected with the same reason. Unit scenarios compare repeated calls and JSON-equivalent cloned input and verify input immutability. A separate test installs throwing getters for opponent hidden zones and card names. Runner timing and Forge's own shuffle/opponent behavior are outside this policy determinism guarantee; seed 42 pins the validation game.

## Metrics

Runner output includes turns, accepted external choices, counts per family, committed lands/spells, attacks, blocks, damage to players/cards, commander casts, terminal result, strategic fallback counts by family/method and mana fallback count. Missing telemetry from an older bridge is reported as `null`, never inferred as zero damage.

`ExternalMatchTelemetry` subscribes to native public game events before the match starts and exposes copied numeric counters in `publicTelemetry`, including the completed snapshot. It does not change decisions, rules or vendor sources.

- Turns are Forge turn numbers, not rounds; 12 turns in this two-player game are six rounds.
- `externalDecisions` counts accepted choices across every family. Historical `progress.decisionsSubmitted` counts priority decisions only.
- Lands/spells are the external broker's completed primary-action counters, not merely choices attempted.
- Attacks count individual native attacker declarations across combats, not combat phases.
- Blocks count native attacker/blocker pairs, not unique creatures across the game. Forge's attacker-to-itself placeholders for unblocked attackers are excluded.
- Damage sums `GameEventPlayerDamaged` and `GameEventCardDamaged` amounts, credited to the source's controller. These are native applied damage events, including infect/counter/loyalty forms when emitted, not life loss, power estimates or attempted damage before prevention. Player and card damage are separately available.
- Commander casts count actual spell-cast events whose source has public commander status, from any zone. This differs from observation's `castsFromCommand`, which specifically tracks command-zone casts.
- Terminal player metadata contains initial zones, not final hidden zones. Its inherited `ai: true` flag also appears for `PlayerControllerAsphodel`; `controllerClass` distinguishes the actual controller.

### First completed game (seed 42)

Both decks reuse `forge/testing/commander-fixtures.ts`: 100 printed cards, one commander, 42 basic lands and 57 distinct same-color creatures. Asphodel uses **Krenko, Tin Street Kingpin**; the native Forge AI opponent uses **Ghalta, Primal Hunger**. There are no production policy exceptions for either deck.

| Metric | Asphodel baseline |
| --- | ---: |
| Turns | 12 |
| Accepted external decisions | 128 |
| Priority / mana / blocker / attacker decisions | 114 / 8 / 4 / 2 |
| Lands / spells / commander casts | 3 / 3 / 1 |
| Attacker declarations / blocker pairs | 0 / 1 |
| Damage to players / cards / total | 0 / 2 / 2 |
| Mana AI fallbacks | 0 |
| Undocumented strategic fallbacks | 0 |
| Documented combat damage fallback calls | 1 |
| Stale/invalid submissions / watchdogs | 0 / 0 |

Natural result: Forge AI (`player-2`) wins, `AllOpponentsLost`, no draw. The baseline never finds an attack passing its conservative visible-stat heuristic in this fixture/seed; this zero is reported rather than treated as a metrics failure. It plays three lands, casts its commander and creatures, and eventually makes one defensive block. This proves autonomous progression, not strategic strength.

The agent calls **no Forge AI strategic helper**. The existing external controller still delegates unsupported combat damage distribution to Forge AI (`combat_damage:assignCombatDamage`, once here), as documented in [V1l readiness](external-controller-readiness-v1l.md). The opponent intentionally uses Forge AI. Therefore the entire match is not claimed to be free of AI calls. Other inherited unsupported callbacks remain audited and would fail this integration fixture's fallback allowlist.

## Running and validation

From the repository root:

```sh
./scripts/forge-build.sh
./scripts/forge-test.sh
cd backend
npm test
npm run build
npm run agent:baseline
# Optional argument: JSON tuple [playerForgeDeckSpec, opponentForgeDeckSpec]
npm run agent:baseline -- /path/to/decks.json
cd ../frontend
npm run build
cd ..
git diff --check
git -C vendor/forge status --short
git -C vendor/forge rev-parse HEAD
```

The CLI prints metrics and the lightweight reason trace as JSON and uses seed 42. It needs no frontend, database or Scryfall connection. The native deck loader validates supplied deck specs. This CLI is a local trusted-input tool.

Focused integration from `backend`:

```sh
FORGE_BRIDGE_JAR=../forge-bridge/app/target/asphodel-forge-bridge.jar \
  ./node_modules/.bin/tsx --test src/forge/asphodel-agent.integration.test.ts
```

The integration writes a temporary diagnostic result to `/tmp/asphodel-v2a-game.json` (and a full public snapshot/trace to `/tmp/asphodel-v2a-debug.json`). These are local validation artifacts, not a persistent replay dataset. The integration is skipped without `FORGE_BRIDGE_JAR`; `forge-test.sh` sets it and must run with no skips.

Validation: 44 backend tests (16 existing, 20 policy/contract tests, 8 runner/metrics tests); 53 Forge integration tests (52 existing, 1 V2a); three existing JVM tests during the Forge build. TypeScript backend, frontend and Forge reactor builds pass. The full-game test checks the native result, unique decision IDs, committed action counters, damage telemetry, blocker counts and the fallback allowlist.

## Weaknesses and V2b

This deliberately shallow baseline ignores keywords, evasion, deathtouch, first strike, trample, combat tricks, multi-block search, commander-damage lethal, synergy and card advantage beyond its tiny score. It can miss useful attacks and activations, cast spells with poor targets, over-block under pressure or take unnecessary optional effects. Keyword matches can misclassify mixed/conditional text. Unknown scry/library options expose names but no characteristic DTO in V1l; v0 keeps them and cannot perform meaningful mana-curve filtering there. Pregame keep/start remains the bridge's fixed V1l behavior. Complex compound combat drafts may need better completion support. The runner safely cancels failures; it does not turn unsupported decisions into successful gameplay.

No ML, RL, neural network, embeddings, MCTS, training, persistent replay collection, self-play, camera or gameplay frontend was added.

Recommended **V2b**: build a deterministic multi-seed/deck evaluation suite and improve visible combat/effect descriptors before learning. Prioritize exposing combat keywords and explicitly revealed card characteristics safely, validating draft completion under mandatory group restrictions, and externalizing the remaining combat-damage choices. Keep the v0 policy/metrics as the comparison baseline. Two external controllers and strategic mulligans are further prerequisites for clean self-play; learning should wait for that contract and broader coverage.
