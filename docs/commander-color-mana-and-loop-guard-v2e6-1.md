# V2e.6.1 — Commander-Color Mana and Failed-Cast Loop Protection

Base: V2e.6 `605ead4`. Forge remains exactly `6356c1ad565029c82513c96e42ad5492c1b09c4e`
(`git -C vendor/forge status --short` empty) — **vendor/forge was not touched**. This is a focused
corrective milestone from a real failed human playtest, not a UI feature: no mulligan, no strategic
policy change, no broad combo-mana support. Bridge Java changes were expected and made.

## 1. The real regression

A real playtest (Human: Uurg, Asphodel: Elenda gain de vie, seed 500) reached **over 4,000**
Asphodel decisions in a single priority window via a failed-cast loop: Turn 5 Main 1, Asphodel's
battlefield was Swamp + Rogue's Passage + Command Tower; hand held Lifecreed Duo (`{1}{W}`),
Suture Priest (`{1}{W}`), Vito, Thorn of the Dusk Rose (`{2}{B}`). Forge legally offered "Cast
Lifecreed Duo"; Asphodel selected it; the external mana-payment enumerator exposed only
Swamp→B and Rogue's Passage→C (**Command Tower was entirely absent**); Asphodel paid the generic
`{1}` with Rogue's Passage, leaving `{W}` unpayable; payment returned `false`; Forge rolled the cast
back; priority returned to the *exact same state*; Asphodel re-selected Lifecreed Duo; repeat,
forever.

## 2. Root cause: Command Tower is Forge's "Combo ColorIdentity"

Command Tower's mana ability is `Produced$ Combo ColorIdentity` — Forge's own
`AbilityManaPart.isComboMana()` is true for it, and `getComboColors(sa)` resolves it against the
controller's real `getCommanderColorID()`. `ForgeManaPaymentChoiceEnumerator` (the bridge's
external-protocol enumerator) intentionally rejected **all** combo mana via `isSimpleFixedPart`,
so Forge's own affordability logic understood Command Tower fine while the external protocol never
saw it as an option at all. That mismatch — not any AI/strategy defect — is the entire root cause.

## 3. The fix: a narrow, documented "Combo ColorIdentity" subset

`ForgeManaPaymentChoiceEnumerator` still rejects arbitrary combo mana, special mana, variable/
conditional production, restricted mana, multi-cost sources, side-effect mana, and unsupported
replacement semantics — unchanged. It now additionally recognizes exactly one shape:
`isSupportedComboColorIdentityPart` = every existing `isBaseSimplePart` check (no restrictions, no
side effects, tap-only cost, exactly one mana part) **plus** `part.isComboMana() &&
"Combo ColorIdentity".equals(part.getOrigProduced())`. Command Tower is the canonical, and
currently only known, case; the check is a narrow documented string match against Forge's own
pinned representation rather than a semantic API (none simpler was available), exactly as the spec
allowed as a fallback.

For a matching ability, `comboColorIdentityCandidates` calls Forge's own
`AbilityManaPart.getComboColors(sa)` — which reads the real controller's `getCommanderColorID()`,
never a card name, Scryfall lookup, decklist string, or frontend guess — splits it into individual
colors, and keeps only the colors that are both commander-identity-legal **and** currently useful
for the exact `ManaCostBeingPaid` (`cost.isAnyPartPayableWith(colorAtom, player.getManaPool())`,
the same affordability primitive every other candidate in this enumerator is already filtered
through). Each surviving color becomes its own `Candidate.comboColorIdentity(ability, color)`, with
`produces = [color]` (e.g. `["W"]`) — **never** the vague `["Combo", "ColorIdentity"]` Forge uses
internally — and a new `forcedColor` field carrying that exact color. A WB commander's Command
Tower therefore externalizes as up to two separate options, "→ W" and "→ B", never a color outside
W/B.

## 4. Applying the choice: Forge's own express-choice mechanism

`PlayerControllerAsphodel.applyManaOption` was extended: for a candidate whose `forcedColor()` is
non-null, every `AbilityManaPart` on the resolved mana ability gets
`part.setExpressChoice(forcedColor)` set **immediately before** `PlaySpellAbility.playSpellAbility`
activates it, and `part.clearExpressChoice()` runs in a `finally` block regardless of success or
failure — scoped to that one activation, never leaking into a later one. This works because pinned
Forge's own `ManaEffect.resolve()` already reads `getExpressChoice()` before resolving combo mana:
when pre-set to a single color, it restricts `colorOptions` to just that color and calls
`chooser.getController().chooseColor(...)` with a now-single-color `ColorSet` —
`PlayerControllerAi.chooseColor`'s `colors.countColors() < 2` short-circuit then returns that exact
color deterministically. No new external decision type was needed: Forge remains entirely
responsible for tapping the source, producing the mana, and paying the cost — this bridge only ever
pre-declares which color the very next combo-mana resolution should use.

## 5. Revalidation includes the chosen color

`isStillLegal` now branches on `candidate.forcedColor()`: for a forced-color candidate,
`isForcedColorStillLegal` re-checks the source is still on the battlefield and controlled by the
payer (via the shared `isBaseUsableAbility` gate, unchanged from the simple-mana path), re-derives
`getComboColors` fresh, confirms the **specific previously-selected color** is still among the
legal commander-identity colors, and confirms that color can still contribute to the *current*
remaining cost. If the originally-chosen color (e.g. W) is no longer useful/legal by the time the
choice is submitted, the candidate is rejected outright — it is never silently substituted for a
different color (e.g. B).

## 6. Existing simple sources are untouched

`isSimpleFixedPart` is now `isBaseSimplePart(...) && !part.isComboMana()` — a pure refactor
extracting the shared base checks (`isBaseSimplePart`) that both the fixed-mana and combo-
color-identity paths reuse; the fixed-mana behavior itself is unchanged. Verified directly: the new
Command Tower integration test's own fixture battlefield also includes a Swamp and a Rogue's
Passage, and both still produce exactly `["B"]`/`["C"]` with `color: null`, side by side with
Command Tower's new options, in the same `mana_payment` decision.

## 7. The general failed-cast loop guard

Fixing Command Tower removes *this* root cause, but not the general hazard: any unsupported
payment/choice could still turn one rules mismatch into thousands of identical decisions. A new,
strategy-agnostic infrastructure guard was added at the human-vs-agent orchestration layer
(`backend/src/human/agent-loop-guard.ts`, wired into `runHumanVsAgentMatch`) — **not** inside
`BaselineAsphodelAgentV2b`, which is entirely unmodified this milestone (still `v2b`).

`AgentCastLoopGuard` tracks, for the agent's `priority_action` decisions only:

- a **semantic state signature** — the agent's own `AgentObservation` canonicalized (object keys
  sorted; array order left alone), which is already free of any transient `decisionId`/`actionId`
  (those live only on the decision, never the observation) and therefore stable enough on its own;
- a **semantic cast-action key** — `{type, cardRef, sourceZone, manaCost, abilityText ?? label}` for
  a `cast_spell` action, deliberately excluding `actionId`/`decisionId` since Forge regenerates both
  every time the same decision recurs, and using `cardRef` (never a card name) so two physically
  distinct cards sharing a name are never conflated;
- a small per-signature `failedCastKeys` set.

Before calling the unchanged policy on any agent `priority_action` decision, the guard checks
whether this exact state signature recurred with the immediately-previous cast attempt's target
still legally offered — if so, that previous attempt is deemed rolled back, its key is added to
`failedCastKeys`, and a filtered view of the decision (with every already-failed `cast_spell`
excluded) is handed to the policy instead. The policy's returned choice is always validated and
submitted against the **original, unfiltered** Forge decision — the policy is simply offered a
narrower legal menu, never a fabricated one. A new semantic state signature (hand, battlefield,
tapped state, counters, stack, life, phase, turn, command zone, …) immediately clears the entire
failure memory, and `Pass` (or any non-`cast_spell` action, including a genuinely successful
`play_land`/`activate_ability`) is never remembered as a failure. This guard is never applied to the
human's decisions.

A small hard safety fuse backs this up: if the exact same already-excluded semantic cast is ever
found still offered a second time from the exact same semantic state (which should be structurally
impossible once filtering is correctly wired), the guard throws
`human_vs_agent_semantic_cast_loop_detected` rather than silently looping — a defensive assertion,
not the primary mechanism. `maxDecisions` was **not** lowered; long Commander games can legitimately
need many real decisions. This guard targets only a repeated semantic no-progress loop.

## 8. Agent mana-payment ranking — verified, not changed

With Command Tower correctly externalized as an exact-color option, `BaselineAsphodelAgentV2b`'s
existing (unmodified) mana-payment scoring already resolves the exact real bug: given the exact
reported options (Swamp→B, Rogue's Passage→C, Command Tower→B, Command Tower→W) against a
remaining `{1}{W}`, its existing `exact`/`waste`/`flexible` scoring ranks Command Tower→W highest
(the only option matching a still-needed shard) — never the generic-only dead end that caused the
real bug. This was **proven by a regression test**, not assumed; per the spec, no scoring change
was made since none was needed.

## 9. What was deliberately not touched

No mulligan UI, no graveyard UI, no hidden-library search, no resolution-order UI, no multiplayer,
no physical deck sync, no token-art overhaul, no general arbitrary combo-mana support, no AI
strategic redesign, and `vendor/forge` was never modified.

## 10. Tests

- **Bridge/Forge** (`forge-bridge.integration.test.ts`, +1, real Forge, real card data — a WB
  commander, Elenda, Saint of Dusk, with a battlefield of only Swamp/Rogue's Passage/Command Tower,
  no Plains at all, so Command Tower is the *only* white source): confirms Command Tower appears in
  `mana_payment` with exactly one option per legal color (never `Combo`/`ColorIdentity`, never a
  color outside W/B), that selecting "→ W" actually taps the real permanent and drops the remaining
  cost's W pip through real Forge, that the cast completes, and that Swamp/Rogue's Passage remain
  exactly as before alongside it.
- **Backend unit** (`asphodel-v2b.test.ts`, +1): the exact reported option shape drives V2b to
  Command Tower→W, never a generic-only dead end — §8 above.
- **Backend unit** (`human/agent-loop-guard.test.ts`, +3, and `human-vs-agent.test.ts`, +1): the
  guard excludes a repeated failed cast and lets the next candidate try, forgets everything once the
  state genuinely changes, never remembers Pass as a failure, and its hard safety fuse throws if a
  policy ignores the filtered view and resubmits an already-excluded cast a second time — plus one
  test exercising the exact same shape through the real `runHumanVsAgentMatch` wiring, not just the
  guard class in isolation.
- One pre-existing fixture (`playtest-session-manager.test.ts`) reused a byte-for-byte identical
  observation across three deliberately-successive "successful" Asphodel decisions; the new guard
  correctly (and rightly) treated that as a rollback. Fixed by giving each step a genuinely distinct
  hand, matching how real Forge state actually changes after a real successful action — not by
  weakening the guard.

Full suites: backend `npm run build`/`npm test` (159/159), frontend `npm run build`/`npm test`
(107/107), and the full Forge bridge suite `./scripts/forge-test.sh` (56/56, +1 over V2e.6's 55).

## 11. Manual smoke test — honestly reported

No display and no browser-automation tool are available in this sandboxed session (checked again —
none connected). What follows is what was verified for real: the actual Forge integration test in
§10 is a real JVM subprocess driving a real Commander game with real card data (not a mock), and is
treated here as genuine verification of the Command Tower mechanism end to end. Additionally, the
real `./scripts/dev.sh` HTTP server was started, the bridge jar rebuilt beforehand
(`./scripts/forge-build.sh`), and two full real games were driven end-to-end via scripted `curl`
against the live server (fixture Krenko-vs-Ghalta decks, seeds `424242` and `777`): the first ran a
natural 14-turn game to a real Forge-decided conclusion (`AllOpponentsLost`); the second was driven
to prefer casting spells specifically to exercise live `mana_payment` decisions, which produced six
real "Pay mana" decisions with the expected unchanged `"Mountain (produces R)"` shape, before being
ended cleanly by the human. Zero errors/exceptions appeared in the dev server log across both runs,
and the new loop guard never needed to intervene (no such log line, and no anomalous hang) in either
live game.

Answering the required verdict questions directly, from the real Forge integration test (§10):

1. **Was real Command Tower present in `mana_payment`?** Yes.
2. **What exact colors were exposed?** Exactly `W` and `B` — the real WB commander identity, never
   a vague combined shape and never an off-identity color.
3. **Did selecting W actually produce/pay W?** Yes — the remaining cost dropped from `{1}{W}` to
   `{1}` after selecting Command Tower→W, verified against Forge's own reported remaining cost, not
   a Node-side computation.
4. **Did Command Tower tap through Forge?** Yes — the real battlefield card's `tapped` field
   flipped to `true` after selection, and it was never offered a second time.
5. **Did the cast complete?** Yes — Lifecreed Duo (or Suture Priest, whichever the deck's shuffle
   drew first as the `{1}{W}` spell) reached the battlefield with zero fallback to Forge's own AI
   payment path.
6. **Maximum repetition count for the previously-looping semantic state?** Zero — the test never
   entered a rollback at all, since the root cause is fixed; nothing repeated even once.
7. **Did the guard ever need to intervene in the now-fixed Command Tower case?** No — Command Tower
   being correctly payable means the cast never fails, so the loop guard's filtering path was never
   exercised by this scenario. Its behavior is instead proven directly and exhaustively by its own
   dedicated unit tests (§10), which construct the exact failure/recovery/reset sequence deliberately.
8. **Were basic/fixed mana sources unchanged?** Yes — Swamp (`B`) and Rogue's Passage (`C`) appeared
   in the same decision with `color: null`, unchanged from before this milestone, and the separate
   live-server smoke test's plain Mountain payments were likewise unaffected.

## Validation

- `cd backend && npm run build && npm test` — 159/159.
- `cd frontend && npm run build && npm test` — 107/107.
- `./scripts/forge-build.sh && ./scripts/forge-test.sh` — 56/56.
- `git diff --check` — clean.
- `git -C vendor/forge status --short` — empty; HEAD still `6356c1ad565029c82513c96e42ad5492c1b09c4e`.

## Verdict

**GO.** The real root cause (Command Tower's combo mana invisible to the external protocol) is
fixed narrowly and safely, verified against real Forge with real card data; the general failed-cast
loop hazard now has a dedicated, strategy-agnostic infrastructure guard with its own test coverage
including a hard safety fuse; V2b's mana-payment ranking was verified (not changed) to already
handle the fixed Command Tower correctly; every existing simple mana source remains exactly as
before; and the live server ran two full real games with zero errors.
