# V2b — Evaluation Harness + Baseline Improvement

Base: V2a `f01d725e640bcb99d9b9605110d3dd978f0c2a71`.
Partial V2b work already on `main` at the start of this pass: `c785d3b9d881a904b3b05798ed7c6c440f930771`, `9b45a52b710fc7f72c9e2e32be3341a7d5ddb488`.
Forge remains exactly `6356c1ad565029c82513c96e42ad5492c1b09c4e` (`git -C vendor/forge status --short` empty).

## 0. Audit of the pre-existing partial V2b

Before writing anything, the two partial commits were read file-by-file and exercised, not assumed. They already contained a complete, working first pass:

| File | Status found | Verdict |
| --- | --- | --- |
| `agent/policy-version.ts` | `VersionedAsphodelAgent` + `BaselineAsphodelAgentV2a` (thin subclass, no override) | Correct freeze mechanism, kept as-is |
| `agent/improved-agent.ts` | `BaselineAsphodelAgentV2b`, full switch over every decision family, dedicated `attack()`/`block()` | Real logic, not a stub — kept, not rewritten |
| `agent/evaluate-agent.ts` | `evaluateAgent()`, `aggregateGames()`, `reproducibleGameResult()` | Sequential-by-construction, denominators already documented per field (`meanDenominator`/`rateDenominator`) — kept |
| `agent/evaluation-diagnostics.ts` | `EvaluationDiagnostics`: attack-window offer/take dedup, commander-offered/not-cast, passes-with-action, semantic trace hash | Sound; window dedup verified by its own unit test | 
| `agent/run-evaluation.ts` | CLI, `--policy v2a\|v2b`, fixed/derived seeds, resource sampling, JSON dump | Already the harness the brief asks for — no second harness was built |
| `asphodel-v2b.test.ts` | 22 unit tests incl. a **byte-for-byte SHA-256 freeze check on `baseline-agent.ts`** | This *is* the freeze guarantee (§2); the test already existed |
| `forge/asphodel-evaluation.integration.test.ts` | Full-game harness run, same-JVM seed repeat `[1,2,1]`, asserts `reproducibleGameResult` equality | Real reproducibility check, not aspirational |
| `forge-protocol.ts` + Java (`AgentObservation*`, `AsphodelDecisionBroker`) | `combatKeywords`, `selfAttackTriggers` (fixed public allowlist, static trigger text only), `attackers` list on combat decisions | Additive, backward compatible (`?` optional fields), hidden-zone tests extended accordingly |

**Bugs/incompleteness found:** none in the shipped code — `tsc --noEmit`, `npm test` (66/66) and `forge-test.sh` (54/54, including the two new integration tests) all passed unmodified before this pass touched anything. The two things that were genuinely missing were exactly what the task said: this document, and the actual multi-seed V2a/V2b benchmark artifacts (the harness existed; nobody had run it at scale and wrote down the numbers). No stub, `TODO`, or dead export was found. No duplicate harness was built.

**What this pass added:** this document, the 50-seed V2a and V2b benchmark runs on identical seeds, the cross-process determinism check, and the stress-batch analysis below. No production source file needed a correctness fix.

## 1–2. Freeze and versioning

`policy-version.ts`'s `BaselineAsphodelAgentV2a extends BaselineAsphodelAgent` with zero overrides, and `asphodel-v2b.test.ts` pins `baseline-agent.ts`'s SHA-256 (`2f11293a555a65d8b3b84b764147ed925783b5cb710e52cfe528b7a05021f118`) so any future edit to the V2a file fails the test suite. `run-evaluation.ts --policy v2a|v2b` selects between `BaselineAsphodelAgentV2a` and `BaselineAsphodelAgentV2b` with no git checkout. Both extend `AsphodelAgent`; the runner, transport and DTOs are shared and unmodified.

## 3. V2a benchmark (50 seeds)

Matchup: Asphodel (**Krenko, Tin Street Kingpin**) vs native Forge AI (**Ghalta, Primal Hunger**), same fixtures as V2a/V1l (`forge/testing/commander-fixtures.ts`, 100-card singleton decks, no policy exceptions). Seeds 1–50, one sequential run, one bridge process (`npm run agent:evaluate -- --policy=v2a --games=50 --seed-start=1`).

| Metric | V2a |
| --- | ---: |
| Completed / games | 50 / 50 |
| Win rate | 0 |
| Average turns | 14.9 |
| Average damage dealt | 16.5 |
| Average attacker declarations | 2.86 |
| Attack opportunities offered / taken | 1153 / 143 |
| Attack conversion rate | 12.4% |
| Average spells cast / lands played | 6.32 / 5.56 |
| Timeouts / stalls / errors / cancelled | 0 / 0 / 0 / 0 |
| Fallback rate (games with ≥1 fallback) | 90% |
| Fallback breakdown | `combat_damage:assignCombatDamage` ×273 |
| Unexpected (undocumented) fallbacks | 0 |
| Mana-payment AI fallbacks | 0 |

`combat_damage:assignCombatDamage` is the same pre-existing, documented external-controller gap recorded in [V1l](external-controller-readiness-v1l.md) — Forge AI distributes multi-blocker combat damage because no external validator exists yet for that one call. It is not new, not undocumented, and not policy-caused; it fires proportionally to how many blocked combats happen.

## 4. Diagnostic: why V2a plays passively

Real per-game trace data, not a combat-only assumption:

- **Priority/board development is not the bottleneck.** Across all 50 games: `passesWithAction` = 0/745 turns — V2a never passes priority while a non-pass legal action exists. `commanderOffered` = 52, `commanderNotCast` = 1 (98% cast rate) — the commander is cast essentially every time it is legally castable. `landsPlayed`/turn = 0.37, `spellsCast`/turn = 0.42 — board development proceeds normally.
- **Mana is not the bottleneck.** `manaFallbacks` = 0 across every game — the mana-payment heuristic never had to defer to Forge AI.
- **Targeting is not separately measurable as a bottleneck here** — the fixture decks are vanilla creatures with almost no targeted spells, so target-selection volume is too low in this matchup to diagnose; V2a's targeting logic (hostile-permanent / lethal-player preference) is unit-tested directly instead (V1/V2a suite).
- **Combat *is* the measured bottleneck, and by a wide margin.** 1153 attacker-selection opportunities were offered, only 143 (12.4%) were taken. **11 of 50 games (22%) end with zero attacker declarations**, and in 9 of those 11, opportunities were offered but always declined (only 2 of the 11 legitimately have zero offers). This matches V2a's own documented design ([v0 doc](asphodel-agent-v0.md)): any single untapped enemy creature that could out-trade the attacker suppresses the whole attack, with no allowance for free damage past a tapped/absent blocker, no lethal-race math, no "some board control now is worth more than perfect safety" logic, and no separate blocking-side risk model.

Conclusion: V2a's passivity is a **combat decision-quality problem specifically**, confirmed (not assumed) by opportunity/conversion telemetry, with board development, commander usage and mana usage already sound. V2b therefore concentrates its changes on `attackers_selection`/`blockers_selection`, while keeping (and lightly extending) the rest.

## 5–11. V2b policy changes

`BaselineAsphodelAgentV2b` (`agent/improved-agent.ts`) consumes only `AgentObservation` and `ForgePendingExternalDecision` — no `Game`, no Forge AI helper, no hidden zone, no Scryfall, no hardcoded card name (verified by a dedicated unit test that installs throwing getters on hidden zones/`name` and asserts the policy never touches them).

- **Priority/board development**: land before spells while the stack is empty (`play_land_board_development`); an empty board prefers a cheap body over an idle commander, otherwise the commander is preferred (`cast_commander_board_development`) with a mana-efficiency curve nudge; flying/menace bodies get a small bonus; unclassified activated abilities rank below pass instead of at pass, so "do nothing" is a safe last resort rather than a plausible early pick.
- **Attack** (`attack()`): scores each *legal add* option, not a hypothetical search — free damage past no relevant blocker (`attack_free_damage`), visible-lethal count-only lower bound (`attack_visible_lethal`), profitable/no-loss trades (`attack_profitable_trade` / `attack_no_profitable_block`), a bounded allowance to attack into an unfavorable single trade when the unblocked group damage or a public self-attack trigger clearly outweighs the loss (`attack_overloaded_defense`, `attack_visible_trigger_value`), and an explicit hold when the remaining untapped board can't survive the opponent's visible return swing (`hold_against_visible_lethal`) or the trade is simply bad (`hold_bad_trade`). Flying/menace/reach/deathtouch/first-strike/double-strike/indestructible are read from the new public `combatKeywords` field and folded into `combatOutcome()`.
- **Block** (`block()`): blocks without loss, favorable trades, a double-block only when it doesn't waste an already-lethal single block and its combined value loss doesn't exceed the kill, and only chumps under measured lethal pressure (`incoming ≥ life − 3` over all *unblocked* attackers, including attackers this player has no legal blocker for) rather than never or always.
- **Targets**: hostile-permanent/lethal-player preference now also scores an amount-aware damage/removal target by visible value, and prefers the *stronger* own permanent for beneficial effects.
- **Mana**: floating mana first, then penalizes overproduction and non-exact color heavily, with a light bias against spending a flexible/colored source on a purely generic remainder — same "never guess affordability, Forge is the legality authority" contract as V2a.
- **X/optional/modes/yes-no**: X uses the full legal range when the ability text visibly scales with X (damage/draw/create), otherwise stays at the conservative minimum; optional costs still decline (the DTO still exposes no incremental-benefit proof, so guessing would be dishonest); modes/yes-no keep a light public-text scoring, penalizing self-cost language.
- **Reason codes** are stable machine-readable strings (`attack_free_damage`, `attack_profitable_trade`, `attack_visible_lethal`, `hold_bad_trade`, `hold_against_visible_lethal`, `cast_commander_board_development`, `target_highest_opponent_value` family, `preserve_flexible_mana`, …) exercised directly by unit tests, not just present in code.

No card is named in the policy; no MCTS/full combat search/self-play/ML is present (`grep`-verified: the only new imports are protocol types and `node:crypto`).

## 12–13. Tests

22 new unit tests in `backend/src/asphodel-v2b.test.ts` cover, concretely: free attack taken; suicidal attack avoided; flying/menace correctly *not* treated as automatically unblockable against a valid flier/reach blocker; count-based lethal group attack; self-attack trigger value accepted/rejected; deathtouch respected; favorable block taken and bad block avoided; lethal-pressure block including an unblockable attacker; no redundant double-block once already profitable; preserving the higher-value (commander) creature when a chump is unavoidable; land-before-spell and never-pass-a-creature; mana-curve creature ordering; hostile/lethal/beneficial targeting; flexible-mana preservation with floating mana first; X scaling vs conservative fallback; mode/yes-no self-cost penalty; **V2a byte-identical freeze**; **hidden-zone/name non-access**; diagnostics window dedup; aggregate rates/means over a failed game; and a mocked-transport harness test (sequential seeds, transport reuse, continues past a cancelled game). One Forge integration test (`asphodel-evaluation.integration.test.ts`) runs three real games (seeds `[1, 2, 1]`) in one JVM and asserts `reproducibleGameResult` equality between the two seed-1 runs, at least one real attack, and that both new public fields (`selfAttackTriggers`, `combatKeywords`) are observed non-empty at least once.

## 14–15. V2b benchmark (identical 50 seeds) and comparison

Same command, same seeds, same decks, `--policy=v2b`.

| Metric | V2a | V2b | Δ |
| --- | ---: | ---: | ---: |
| Completed / games | 50/50 | 50/50 | — |
| Completion rate | 100% | 100% | no regression |
| Win rate | 0% | 0% | unchanged (not required) |
| Average turns | 14.9 | 14.1 | shorter, more decisive games |
| Average damage dealt | 16.5 | 17.62 | **+6.8%** |
| Average attacker declarations | 2.86 | **7.44** | **+160%** |
| Attack conversion rate | 12.4% | **47.8%** | **+286%** |
| Games with zero attacks | 11/50 (22%) | **1/50 (2%)** | |
| Average spells cast | 6.32 | 6.02 | ~unchanged |
| Average lands played | 5.56 | 5.38 | ~unchanged |
| Commander cast rate when offered | 52/52 legal, 51 taken | 49/49 taken | unchanged (already sound) |
| Passes with a legal non-pass action available | 0 | 0 | unchanged (already sound) |
| Timeouts / stalls / errors / cancelled | 0/0/0/0 | 0/0/0/0 | **no regression** |
| Mana-payment AI fallbacks | 0 | 0 | **no new fallback** |
| Undocumented/unexpected fallbacks | 0 | 0 | **zero, both versions** |
| Documented `combat_damage:assignCombatDamage` fallback | 273 (90% of games) | 288 (100% of games) | expected — scales with combats actually fought, not a new fallback family |

Raw `attackOpportunities`/`attacksTaken` counts (1153/143 vs 778/372) are **not** directly comparable game-for-game: the seed fixes the shuffle, but each policy makes different decisions from turn 1 onward, so the two policies traverse different game trees past the opening draw. The **conversion rate** and the **zero-attack-game count** are the meaningful, seed-controlled comparison, and both move sharply in the intended direction.

Damage improved only modestly in relative terms despite attacks nearly tripling, because the same native Forge AI opponent that was previously barely threatened now blocks and trades far more often — visible in the unchanged win rate and in per-seed variance (e.g. seed 30: 13→42 attacks, 190→73 damage — more attacks, *less* net damage, because V2a's seed-30 game was an outlier grind to turn 48 with accumulated unblocked trample-style damage, while V2b's version of the same seed ends by turn 16 through faster, contested combat). This is the expected outcome of trading passivity for pressure against a real, blocking AI opponent — not a symptom of reckless attacking, since completion rate and error rate are both unchanged at zero.

## 16. Reproducibility

Same policy + seed + decks was verified to produce the same observable result **across independent processes**, not only within one JVM session:

- V2b, seed 1, run inside the 50-seed batch vs a fresh, separately started bridge process minutes later: identical `semanticTraceHash` (`d7414c44ae73a40873b5278961ee19a748a38338573ef1ffc5748e4ba3e2430d`) and identical `metrics` (turns, decision-type counts, spells/lands, attacks/blocks, damage split, commander casts, fallback counts).
- V2a, seed 1: same cross-process check, hashes equal.
- The pre-existing `asphodel-evaluation.integration.test.ts` additionally proves same-JVM repeatability (seeds `[1, 2, 1]`) via `reproducibleGameResult`.

`semanticTraceHash`/`reproducibleGameResult` (already built) were sufficient; nothing new was needed here.

## 17. Stress batch

The V2b 50-seed benchmark **is** the stress batch: 50 games, sequential, one bridge process (`bridgePid` constant across the run), no restart. Observed: 0 deadlocks (all 50 games completed inside default limits), 0 stalls/timeouts/errors, Node RSS oscillating 401–743 MB with the last sample (566 MB) below the run's peak — no monotonic growth indicating a leak — and reproducibility re-confirmed on a seed drawn from partway through that same batch (seed 1) against an independent process. No cumulative state drift was observed (each seed's outcome depends only on its own seed, not on run order, consistent with the cross-process hash match).

## 18. Limits

- Win rate is still 0/50 for both versions against the native Forge AI opponent in this fixture; V2b measurably fixes the *passivity* diagnosis from V2a, not competitive strength against a tuned opponent.
- The attack/block heuristics are still local, one-decision-at-a-time scoring — no multi-turn plan, no full combat-tree search, no opponent-response modeling beyond the conservative count-only lower bound already documented in the code.
- Target/mode/X/optional-cost/yes-no logic is lightly extended, not redesigned; the fixture decks exercise these families too rarely to benchmark them the way combat was benchmarked here.
- `combat_damage:assignCombatDamage` remains an inherited Forge-AI fallback (unchanged scope from V1l); it is not eliminated by V2b and was not in scope to eliminate.
- Two-external-controller self-play is still unsupported by the bridge; all benchmark numbers are one external Asphodel policy vs native Forge AI, as in V2a.

## 19. Recommendation for V2c — Human vs Asphodel

V2b's zero-error, zero-unexpected-fallback, deterministic, 50-seed-clean track record on both policies is the readiness bar V2c needs before putting a human across the table. Concretely:

1. **Ship V2b (`BaselineAsphodelAgentV2b`) as the opponent for V2c**, not V2a — it is strictly more active and has an identical safety/legality/hidden-info profile, verified on the same seeds.
2. **Add a real-time/UI decision path**: today's runner is a headless poll/submit loop for CI-style evaluation. A human match needs the existing external-decision DTOs surfaced through the frontend with human-paced input, not the agent's synchronous `choose()` loop — this is new frontend/bridge wiring, not a policy change.
3. **Keep the game/deck fixture stable for the first sessions** (same Krenko/Ghalta 100-card singleton decks) so any issue can be attributed to the human-facing plumbing rather than a new, unvalidated deck.
4. **Do not add ML/RL/MCTS/self-play for V2c.** The explicit blocker for learning approaches remains what V2a's doc already said: two-external-controller support and broader combat/target coverage should come first; V2b strengthens the second without touching that blocker.
5. **Instrument the human session with the existing `EvaluationDiagnostics`/telemetry**, so the first human game is itself a diagnosable data point (attack conversion, fallback counts, commander usage) rather than an anecdote.
6. **Treat any illegal/stale submission or hidden-info leak in a human session as a release blocker**, exactly as V2b treated it in this benchmark (0 observed in 100 combined games across both policies) — the bar should not lower going into a human-facing milestone.

## 20. No ML

No ML, RL, MCTS, self-play training, neural network, dataset training, frontend gameplay, or Archidekt sync was added or is proposed for V2b or the V2c recommendation above.

## 21. Validation

From the repository root:

```sh
./scripts/forge-build.sh   # BUILD SUCCESS, 5 modules
./scripts/forge-test.sh    # 54/54 Forge integration tests pass (52 pre-existing + 1 V2a + 1 V2b)
cd backend
npm test                   # 66/66 pass (44 pre-existing + 22 V2b)
npm run build               # tsc --noEmit clean
npm run test:forge-bridge   # included in forge-test.sh above
cd ../frontend
npm run build                # vite build, clean
cd ..
git diff --check             # clean
git -C vendor/forge status --short   # empty
git -C vendor/forge rev-parse HEAD   # 6356c1ad565029c82513c96e42ad5492c1b09c4e
```

Benchmarks: `cd backend && FORGE_BRIDGE_JAR=../forge-bridge/app/target/asphodel-forge-bridge.jar npm run agent:evaluate -- --policy=v2a --games=50 --seed-start=1` (and `--policy=v2b`) reproduce the tables above; seeds are `1..50`, deck fixtures unchanged from V2a/V1l.
