# V2g — Physical Companion V0

Base: V2f.1 `8f14b4c`. Forge remains exactly `6356c1ad565029c82513c96e42ad5492c1b09c4e`
(`git -C vendor/forge status --short` empty). `BaselineAsphodelAgentV2b` and its scoring policy are
unmodified — this milestone is architecture, not intelligence (spec §30).

## 1. One Forge state, two play modes

Asphodel has always supported exactly one authoritative game: a real Forge `Game` driven through
`AsphodelDecisionBroker`/`PlayerControllerAsphodel`, with both seats configured as `"external"`
(`ExternalMatchSession`). V2g does not fork that into `DigitalGame`/`PhysicalGame`. It introduces one
new concept — `PlayMode = "digital" | "physical"` (`backend/src/human/playtest-session-manager.ts`)
— that changes two things only:

1. **Input**: in physical mode, the human's hidden-zone card identities come from a physical
   declaration instead of being silently correct-by-construction (see §2).
2. **Presentation**: the frontend renders the human seat as a compact mirror instead of a full
   digital tabletop half (`TableSeatPresentation`, frontend-only).

Everything else — targets, modes, mana payment, combat, dual commanders, resume-after-refresh,
reports — is the exact same Forge decision infrastructure V2e/V2f already built. Physical mode is
additive; digital mode's behavior is untouched.

## 2. The hard problem: hidden-zone authority

Confirmed directly in vendor Forge (`Player.java`, `GameAction.java`, `PlayerController.java`) before
writing any bridge code (spec §31):

- The human's Forge `Library` is a **real, fully-known-to-Forge, digitally-shuffled** zone —
  `ForgeDeckFactory` builds a genuine `forge.deck.Deck`, and Forge itself shuffles it
  (`Player.shuffle`, seeded `MyRandom`) at `match.startGame()`, before any bridge code runs again.
  Forge therefore always knows the *composition* correctly; it just shuffles it in an order that has
  nothing to do with the human's real, physically-shuffled deck.
- **Draw and mill never call a `PlayerController` hook at all.** `Player.drawCards`/`Player.mill`
  read `library.get(0)` / the real top-N directly. There is no seam to intercept these proactively.
- **Mulligan (keep + London bottom), scry, surveil, and tutor/search already have real hooks**
  (`mulliganKeepHand`, `tuckCardsViaMulligan`, `arrangeForScry`, `arrangeForSurveil`,
  `chooseSingleCardForZoneChange`/`chooseCardsForZoneChange`) and V2e.8 already externalizes them
  with real card labels — correct for digital (Forge's shuffle *is* "the deck"), wrong for physical
  (Forge's shuffle is *not* the same order as the real shuffled deck on the table).
- `cheatShuffle(List<Card>)` is a real hook fired on every shuffle of that library — currently a
  no-op passthrough, and the one genuine "a shuffle just happened" signal available anywhere.

**Model:** Forge remains the sole authority on rules, state, and card *counts*. It is never asked to
know the real physical order. Instead, whenever Forge silently places a digitally-arbitrary card
into a physical-mode zone, or is about to reveal digitally-arbitrary library cards to that seat, the
bridge asks the human to *declare* the true identity, then swaps Forge's own real objects so the
same slot ends up holding an object whose real rules text matches the declaration. Declaring is
never "trust me" — it always resolves to an actual Forge `Card` object with the real mana ability,
keywords, and P/T the physical card has.

### 2.1 Two invocation styles, one primitive

`forge-bridge/app/.../PhysicalIdentityCoordinator.java` implements one operation:

```java
List<Card> reconcile(List<Card> wrongCards, List<String> declaredNames)
```

For each position where `wrongCards[i].getName() != declaredNames[i]`, it finds a real,
not-yet-claimed `Card` of the declared name still in the library, and swaps it with the wrong card
using direct `Zone.add`/`Zone.remove` — **never `GameAction.moveTo`**, so no "enters this zone"
trigger fires a second time for a card that (from Forge's perspective) already silently entered that
zone once. Zone sizes and rules-legal composition never change; only *which* real object occupies a
given slot changes.

- **Proactive** (mulligan bottom is already-known hand cards, so only scry/surveil/tutor need this):
  `PlayerControllerAsphodel.arrangeTop` (scry/surveil) calls
  `AsphodelDecisionBroker.reconcilePhysicalLibraryPeek(...)` **before** delegating to the existing
  V2e.8 scry/surveil flow, so what that flow then reveals is already the true physical identity —
  zero changes needed to the existing scry/surveil decision rendering. Tutor/search needs **no**
  reconciliation at all: `ChangeZoneEffect`'s candidate pool is built from Forge's own real library
  contents, already correctly named; any object of the chosen name is rules-interchangeable.
- **Reactive** (draw, mill, and anything else with no hook): every single
  `AsphodelDecisionBroker.request*Decision(...)` call — for *either* seat, since a triggered draw/mill
  can happen on any turn — first calls `ensurePhysicalReconciled(Game)`. This diffs the physical
  seat's Hand/Battlefield/Graveyard/Exile/Command zones against a tracked baseline
  (`PhysicalIdentityCoordinator`); any zone that grew since the last checkpoint means Forge silently
  placed a card there, and the coordinator raises a `physical_identity_declare` decision for exactly
  that many cards before the *original* decision — or its `AgentObservation` — is ever built.

**Critical ordering bug found and fixed during implementation:** `ensurePhysicalReconciled` must run
strictly *before* the caller builds its own `AgentObservation`, never after — an observation built
before reconciliation is stale and would show the pre-reconciliation (wrong) hand to the very next
decision. Every one of the ~11 `AgentObservationBuilder.build(...)` call sites in the bridge
(`PlayerControllerAsphodel`, `AsphodelCostDecision`, `ForgeStrategicSelections`,
`ForgeCombatDecisions`) now calls `ensurePhysicalReconciled`/`freshObservation()` immediately first.
This was caught by a real Forge integration test (declared multiset didn't match the observed hand)
before being shipped — see §11.

### 2.2 Shuffle invalidates known order, not composition

`cheatShuffle` calls `PhysicalIdentityCoordinator.recordShuffle()`, which re-baselines the tracked-card
set to whatever is genuinely sitting in tracked zones *at that instant*. Composition/count knowledge
is never touched (it was never derived from order in the first place); only the "this exact object is
already known" bookkeeping is reset, so a London-mulligan redraw after a shuffle is correctly treated
as a brand-new, undeclared event — proven directly by a real Forge integration test (§11).

### 2.3 Known, honest limitation

A replacement/triggered effect that inspects a drawn/milled card's *specific identity* mid-resolution
(e.g. "if you drew a nonland card, ...") sees whatever Forge's own shuffle produced, not yet the
reconciled identity — reconciliation happens at the next decision checkpoint, not synchronously
inside Forge's own zone-change code. This is a real, narrow gap (spec's anticipated "some exotic
effects may remain unsupported"), not a vendor patch avoided for convenience: fixing it would require
patching vendor Forge's draw/mill internals directly, which V2g deliberately does not do (spec §34).
Turn-scoped engine bookkeeping keyed off "entered this zone this turn" (e.g. descend/landfall-style
counters) can also be affected by a reconciliation swap in rare cases, for the same reason.

## 3. PhysicalCardProvider architecture

`backend/src/physical/physical-card-provider.ts`:

```ts
interface PhysicalCardRequest { decisionId, playerId, context, eventKind, count, candidates }
interface PhysicalCardSelection { declaredNames: string[] }
interface PhysicalCardProvider { chooseCard(request, observation?): Promise<PhysicalCardSelection> }
```

`human-vs-agent-runner.ts`'s dispatch loop treats a `physical_identity_declare` decision (always
owned by `humanPlayerId`) specially: when `options.physicalCardProvider` is set, it calls
`physicalCardProvider.chooseCard(...)` **instead of** `human.choose(...)`, wraps the result back into
an ordinary `AgentChoice{kind:"physical_identity"}`, and runs it through the exact same
validate/submit/trace/record pipeline as every other decision. The rest of the game — Forge bridge,
runner, ledger, report — never knows or cares whether the identity came from typing into the browser
or a future camera; only that a `PhysicalCardSelection` eventually arrives.

`ManualPhysicalCardProvider` (V0's only implementation) mirrors `WebHumanDecisionProvider`'s exact
"one pending item, resolved by `submit()`" contract, deliberately as an **independent channel** (not
layered on top of `WebHumanDecisionProvider`) so the two can be pending at different moments without
one leaking into the other's transport shape. `observation` is accepted but presentation-only —
never required to answer, since the human looks at their real cards, not the screen; a future
`CameraPhysicalCardProvider` can ignore it entirely and answer without a browser at all.

`playtest-session-manager.ts` wires this in: `Session.physicalProvider` is non-null only when
`playMode === "physical"`. `getState()` prefers a pending physical declaration over the ordinary
provider's pending decision (rendered via `describePhysicalDeclare`, `human-decision-render.ts`) and
falls back to the session's last known human observation so the compact board mirror never goes
blank while a declaration is pending. `submitChoice()` routes `choice.kind === "physical_identity"`
to `physicalProvider.submit(...)` — through the exact same generic `POST /playtests/:id/choice` route,
no new HTTP endpoint.

## 4. What the physical ledger knows

`backend/src/physical/physical-ledger.ts`'s `PhysicalLedger` deliberately does **not** independently
recompute "what remains" — Forge's own library contents, recomputed fresh by the bridge on every
physical request, are the only authoritative source (spec §4: never weaken Forge correctness).
Maintaining a second, Node-side count would be exactly the kind of driftable duplicate state that
guarantee forbids. Instead it distinguishes the three things spec §5 asks for by construction:

- **Known deck composition**: `deckCompositionFrom(spec)` — static, from the resolved decklist's
  mainboard section at match start (commander cards are never in the library, so never counted here).
- **Known physical card identity**: `accounted()` — deckComposition minus Forge's own latest
  authoritative remaining count, i.e. every copy already placed somewhere non-hidden.
- **Unknown library order**: never modeled at all. The ledger tracks name *counts*, never *positions*
  — there is no "next N cards" cache to invalidate on shuffle, because none is ever kept. (The actual
  order semantics live entirely in `PhysicalIdentityCoordinator` on the bridge side, §2.2.)

The ledger is a presentation/diagnostic mirror only — the browser's fast local fuzzy-search
candidate list — never itself a legality check; the bridge is the only validator of a declaration.

## 5. What Asphodel AI is allowed to know

Unchanged from before V2g, and re-verified: `AgentObservationBuilder` never exposes library
contents, and a `physical_identity_declare` decision's `playerId` is always the human's own —
`BaselineAsphodelAgentV2b.choose()` explicitly throws
(`agent_cannot_answer_physical_identity_declare`) if it is ever asked one, which spec §30 requires
can never happen (only the human seat is ever configured as `physicalPlayerId`). Declared identities,
the physical ledger, and `PhysicalCardRequest`/`Selection` never appear in `AgentObservation` or in
`DecisionRecorder` (which only ever records `owner === "agent"`). They are recorded separately, for
humans debugging their own game, in `playtest-report.ts`'s new `physicalDeclarations` diagnostic list
— never folded into the agent-decision report Asphodel's own choices populate.

## 6. Supported V0 physical event families

| Event | Mechanism | Status |
| --- | --- | --- |
| Opening hand | Reactive (hand 0 -> 7 at game start) | Real Forge integration test |
| Mulligan redraw | Reactive + shuffle invalidation | Real Forge integration test |
| Normal draw | Reactive | Real Forge integration test |
| Scry reveal/keep | Proactive | Real Forge integration test |
| Surveil reveal | Proactive (same code path as scry) | Integration-tested via shared `arrangeTop` path, not a dedicated fixture |
| Mill | Reactive (Graveyard growth) | Implemented, exercised only by the generic reconciliation mechanism — no dedicated real-mill Forge fixture test yet |
| Tutor/search | No reconciliation needed — Forge's real candidate pool is already correctly named | Already proven by V2e.8's Cultivate fixture; unchanged by V2g |
| Discard (own hand, any cause) | No reconciliation needed — own hand is always already-known/reconciled | N/A |
| Exile from library, reveal from library, put on top/bottom, library-to-battlefield/command | Reactive, same generic mechanism (by zone) | Implemented, not covered by a dedicated fixture test |
| Shuffle | `cheatShuffle` invalidation | Real Forge integration test |

## 7. Unsupported / theoretical

- A replacement/trigger inspecting a drawn/milled card's exact identity mid-resolution (§2.3).
- Simultaneous multi-zone events in one checkpoint (e.g. a mill AND a draw both resolving before the
  next decision) are handled by looping one declaration round per zone in a stable order
  (Hand, Battlefield, Graveyard, Exile, Command) — implemented, not exercised by a dedicated test.
- Turn-scoped bookkeeping counters possibly double-counting across a reconciliation swap (§2.3).
- No multiplayer (still strictly 1 human vs 1 Asphodel, per spec §29).
- No camera/vision of any kind (per spec §28) — see §8.

## 8. Camera replacement path

Everything upstream of `ManualPhysicalCardProvider` — the Forge bridge reconciliation, the
`PhysicalCardProvider` interface, the runner's dispatch — is already camera-agnostic. A future
`CameraPhysicalCardProvider implements PhysicalCardProvider` would recognize a card from a video
frame and resolve `chooseCard(request)` with a `PhysicalCardSelection`, never touching the browser,
`WebHumanDecisionProvider`, or any HTTP route. `human-vs-agent-runner.ts`/`playtest-session-manager.ts`
would need zero changes beyond constructing the different provider.

```text
Forge Game (real, digitally-shuffled library)
      │
      ▼
AsphodelDecisionBroker.ensurePhysicalReconciled / reconcilePhysicalLibraryPeek
      │  (raises physical_identity_declare with Forge's own real remaining-composition candidates)
      ▼
human-vs-agent-runner.ts  ──►  PhysicalCardProvider.chooseCard(request)
                                    │                       │
                         ManualPhysicalCardProvider   (future) CameraPhysicalCardProvider
                                    │                       │
                         browser (WebPlaytestStateDTO   video frame → recognized card
                         .pendingDecision.rendered
                         .kind === "physical_declare")
                                    │
                                    ▼
                    PhysicalCardSelection { declaredNames }
                                    │
                                    ▼
                 PhysicalIdentityCoordinator.reconcile(...)  (real Zone swap, no vendor patch)
```

## 9. Tests

- **Forge integration** (`backend/src/forge/forge-bridge.integration.test.ts`, real JVM, no mocks):
  opening hand + shuffle-invalidated redraw + normal draw all reconcile to exactly the declared
  multiset (not merely the right count); a real Opt scry pile reveals the declared identity and the
  following draw reconciles to the same name. Both new tests pass alongside the full pre-existing
  63-test Forge suite (61 pre-existing + 2 new), zero regression.
- **Backend unit**: `physical-ledger.test.ts`, `physical-card-provider.test.ts`,
  `human-decision-render.test.ts` (`describePhysicalDeclare`), `playtest-session-manager.test.ts`
  (physical-mode session lifecycle, resume, routing), `playtest-report.test.ts` (playMode +
  physicalDeclarations rendering) — see the final V2g report for exact counts.
- **Frontend unit**: seat-presentation, declare-picker pure logic — see the final V2g report.

## 10. Validation

```sh
cd backend && npm run build && npm test
./scripts/forge-build.sh && ./scripts/forge-test.sh
cd ../frontend && npm run build && npm test
cd .. && git diff --check
git -C vendor/forge status --short   # empty
```
