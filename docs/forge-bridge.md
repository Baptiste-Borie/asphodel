# Asphodel Forge Bridge — External Targets V1f

## Scope

This bridge is an isolated validation seam between the Node.js backend and the
original Java [Card-Forge/forge](https://github.com/Card-Forge/forge) engine. It
loads real Forge card scripts, converts Deck Library views into real
`forge.deck.Deck` instances, and supports either two normal Forge AI controllers
or an asynchronous match with one hybrid Asphodel controller. V1d made the
Asphodel controller's primary-action decisions driven by real, enumerated
Forge legal actions instead of a single Forge AI suggestion (see
[Primary Legal Actions V1d](#primary-legal-actions-v1d) below). V1e adds a
player-specific, sanitized observation captured alongside each pending decision
(see [AgentObservation V1e](#agentobservation-v1e)). V1f externalizes ordinary
player, card, and stack-spell targets while retaining the exact Forge
`SpellAbility` selected by Node (see
[External Targets V1f](#external-targets-v1f)). The integration
is backend-only: it adds no product Game HTTP API, persistent Game model, full
human controller, or frontend behavior.

Forge is pinned as the `vendor/forge` Git submodule at revision
`6356c1ad565029c82513c96e42ad5492c1b09c4e` (`2.0.15-SNAPSHOT`). The Asphodel
reactor compiles only `forge-core`, `forge-game`, `forge-ai`, and the bridge.
No GUI, desktop, mobile, Android, Adventure, installer, or Forge asset module is
compiled. The card and AI data files under `vendor/forge/forge-gui/res` are read
at runtime as data only.

## Architecture

```text
TypeScript backend
      |
      +-- DeckService -> DeckDetailView -> ForgeDeckAdapter
      |
      | NDJSON over stdin/stdout
      v
Asphodel Forge Bridge (Java)
      |
      +-- ForgeDeckFactory -> PaperCard lookup -> forge.deck.Deck
      +-- ExternalMatchSession -> PlayerControllerAsphodel
      +-- AgentObservationBuilder -> sanitized immutable observation
      +-- ForgeTargetChoiceEnumerator -> Forge-legal opaque targets
      +-- forge-core  (CardStorageReader, StaticData, card scripts)
      +-- forge-game  (GameRules, RegisteredPlayer, Match, Game)
      `-- forge-ai    (LobbyPlayerAi, PlayerControllerAi)
```

The bridge owns only small transport DTOs; no raw Forge object crosses the
process boundary. SQLite, Drizzle, Scryfall metadata, `DeckService`, and
Asphodel SQL IDs remain TypeScript concerns. Maven resolves the Forge modules
directly from the pinned submodule reactor, not from Maven Central.

## Requirements, setup, build, and test

- Git with submodule support
- Java 17 or newer
- `curl`, `sha512sum`, and `tar`
- Node.js and the existing backend dependencies

Run:

```sh
./scripts/forge-setup.sh
./scripts/forge-build.sh
./scripts/forge-test.sh
```

Setup initializes the exact submodule revision and bootstraps the SHA-512
verified Apache Maven 3.9.11 archive under ignored `.cache/`. The build creates:

```text
forge-bridge/app/target/asphodel-forge-bridge.jar
```

The test command builds the Java reactor, runs its available tests, and then
runs the real-process TypeScript integration suite. Product checks remain:

```sh
cd backend && npm test && npm run build
cd frontend && npm run build
```

## Asphodel Deck Adapter V1b

The product-side conversion path is:

```text
Deck Library / SQLite
        |
        v
DeckService.getDeck() -> DeckDetailView
        |
        v
ForgeDeckAdapter -> ForgeDeckSpec
        |
        v  NDJSON
ForgeDeckFactory -> Forge CardDb -> PaperCard -> forge.deck.Deck
        |
        v
RegisteredPlayer.forCommander -> LobbyPlayerAi -> Match -> GameOutcome
```

The exact TypeScript protocol DTO is:

```ts
interface ForgeDeckCardSpec {
  name: string;
  quantity: number;
  section: "commander" | "mainboard";
}

interface ForgeDeckSpec {
  sourceDeckId?: number;
  name: string;
  cards: ForgeDeckCardSpec[];
}
```

`ForgeDeckAdapter` preserves the Deck Library name, exact canonical card name,
quantity, and section. It intentionally drops Scryfall IDs, Oracle text, mana
cost, colors, and image fields. `sourceDeckId` is optional Node-side diagnostic
provenance; Gson ignores it because the Java `DeckSpec` has no corresponding
field. `ForgeDeckMatchRunner` supports both already-loaded `DeckDetailView`
values and deck IDs resolved through `DeckService.getDeck()`.

V1b accepts exactly one commander and a non-empty mainboard, with positive
integer quantities. Zero commanders and empty mainboards are invalid; more
than one commander returns `UNSUPPORTED_COMMANDER_CONFIGURATION`. This is only
structural conversion validation. It does not implement or claim Commander
legality checks for deck size, singleton, color identity, or banned cards.

`ForgeDeckFactory` first resolves every unique exact name through Forge's
`CardDb`. Only after all names resolve does it allocate and populate the deck:
`mainboard` maps to `DeckSection.Main`, and `commander` maps to
`DeckSection.Commander`. Missing names are accumulated and returned as
`FORGE_CARDS_NOT_FOUND` with `details.cards`; no partial deck or Scryfall-rules
fallback is used.

Exact-name coverage includes Mountain, Forest, Lightning Bolt, Grizzly Bears,
Krenko, Tin Street Kingpin, Ayula, Queen Among Bears, and the apostrophe-bearing
Ajani's Pridemate. With this pinned Forge revision, the full Scryfall double-face
name `Delver of Secrets // Insectile Aberration` does not resolve through the
same exact CardDb lookup (Forge indexes the front-face name). V1b deliberately
reports it in `FORGE_CARDS_NOT_FOUND`; alias/fuzzy/double-face normalization is
deferred.

| Capability | Status | Notes |
| --- | --- | --- |
| DeckDetailView conversion | PASS | Pure TypeScript adapter; UI/Scryfall-only fields excluded. |
| Mainboard mapping | PASS | Populates `DeckSection.Main` with supplied quantities. |
| Commander mapping | PASS | Populates `DeckSection.Commander`; exactly one commander in V1b. |
| Forge card resolution | PASS WITH LIMITATION | Exact CardDb names pass; full Scryfall DFC names can differ from Forge's index. |
| Missing card detection | PASS | All missing names in one spec are accumulated before deck construction. |
| inspect_deck | PASS | Counts and commander names are read from the constructed Forge Deck. |
| run_deck_match | PASS | Exactly two Commander decks, two real Forge AI players, terminal outcome. |
| SQLite → Forge match | PASS | Parser, test CardProvider, SQLite/Drizzle, DeckService, adapter, JVM, and Forge game covered end to end. |
| Post-timeout second game | PASS | A new `run_deck_match` terminates normally in the same JVM after `GAME_TIMEOUT`. |
| Commander legality | NOT TESTED | Deliberately non-legal small fixtures keep engine tests fast. |

## External Controller V1c (historical)

> **Superseded for primary-action selection.** This section documents the V1c
> design as originally shipped. As of V1d, `PlayerControllerAsphodel` no longer
> calls `super.chooseSpellAbilityToPlay()` and no longer exposes a single Forge
> AI suggestion; see [Primary Legal Actions V1d](#primary-legal-actions-v1d)
> below for the current flow and DTO shape. The session/protocol scaffolding
> described here (`ExternalMatchManager`, `ExternalMatchSession`,
> `AsphodelDecisionBroker`, ping/get/submit/cancel responsiveness) is unchanged
> and still applies.

V1c adds asynchronous, in-memory match sessions without unsolicited NDJSON
events:

```text
Node request / NDJSON reader thread
        |
        +---- remains responsive to ping/get/submit/cancel
        |
        v
ExternalMatchManager (maximum one active Forge match)
        |
        v
ExternalMatchSession worker thread
        |
        v
Forge game -> LobbyPlayerAsphodel -> PlayerControllerAsphodel
                                      |
                                      v
                              AsphodelDecisionBroker
                                      ^
                                      |
                         submit_external_decision
```

`LobbyPlayerAsphodel` extends Forge's `LobbyPlayerAi` and overrides
`createIngamePlayer(Game, int)`. It creates the Forge `Player`, then installs
`new PlayerControllerAsphodel(game, player, this, broker)` with
`Player.setFirstController(...)`. Player 2 is still created by the unmodified
`LobbyPlayerAi` and therefore uses `forge.ai.PlayerControllerAi`.

`PlayerControllerAsphodel` temporarily extends `PlayerControllerAi`. Its only
externalized method is `chooseSpellAbilityToPlay()`: it first calls
`super.chooseSpellAbilityToPlay()`, publishes either PASS alone or PASS plus the
Forge suggestion, and waits on a `CompletableFuture`. The NDJSON reader thread
submits an opaque action ID through the broker. PASS returns `null`; accepting
the suggestion returns the retained `List<SpellAbility>` object. The overridden
`playChosenSpellAbility(...)` delegates back to Forge AI and records, by object
identity, that the retained ability was actually passed to Forge.

No `Game`, `Player`, `Card`, or `SpellAbility` is serialized. The exact pending
decision shape is:

```ts
interface ForgePendingDecision {
  decisionId: string;
  type: "priority_action";
  playerId: string;
  context: {
    turn: number;
    phase: string;
    activePlayerId: string;
    priorityPlayerId: string;
    stackSize: number;
  };
  actions: Array<
    | {
        actionId: string;
        type: "pass";
        label: string;
        cardName: null;
        abilityText: null;
      }
    | {
        actionId: string;
        type: "forge_ai_suggestion";
        label: string;
        cardName: string | null;
        abilityText: string | null;
      }
  >;
}
```

The broker uses synchronization plus one `CompletableFuture` per decision; the
game thread performs no sleep or busy-wait. Unknown actions leave the future and
pending decision intact. Accepted decisions immediately become stale, and the
action-to-`SpellAbility` references are cleared after the game thread resumes.
Cancellation completes any wait exceptionally, marks the Forge game as a draw,
interrupts the worker, clears retained abilities, and waits briefly for worker
termination before allowing a replacement session.

The session protocol consists of:

- `start_external_match`: validates/builds exactly two Commander decks, starts
  a worker, and immediately returns `{ sessionId, status: "running" }`.
- `get_external_match`: returns `starting`, `running`,
  `waiting_for_decision`, `completed`, `cancelled`, or `failed`, plus a pending
  decision, terminal result, or sanitized error where applicable.
- `submit_external_decision`: accepts `sessionId`, `decisionId`, and opaque
  `actionId`.
- `cancel_external_match`: releases a pending decision and allows another
  session to start.

Errors include `MATCH_ALREADY_RUNNING`, `MATCH_NOT_FOUND`,
`MATCH_NOT_WAITING`, `DECISION_NOT_FOUND`, `STALE_DECISION`,
`ACTION_NOT_FOUND`, and `MATCH_COMPLETED`. Synchronous Forge matches are refused
while an external session is active, protecting Forge's global `MyRandom`.

| Capability | Status | Notes |
| --- | --- | --- |
| Asphodel controller created | PASS | `PlayerControllerAsphodel` extends `PlayerControllerAi`. |
| Player 2 Forge AI | PASS | Exact controller class is `forge.ai.PlayerControllerAi`. |
| Async game session | PASS | Forge runs on a dedicated daemon worker. |
| Bridge responsive while waiting | PASS | `ping` returns `pong` during a pending decision. |
| Pending decision | PASS | Sanitized priority context and opaque actions only. |
| PASS from Node | PASS | Returns `null` to `PhaseHandler`; Forge continues. |
| Accept Forge suggestion | PASS | Retained object identity is observed in `playChosenSpellAbility`. |
| Stale action protection | PASS | Reusing an answered decision returns `STALE_DECISION`. |
| Match cancel | PASS | Pending wait is released; a replacement starts in the same JVM. |
| Full game driven by Node | PASS | Test auto-driver reaches a real terminal `GameOutcome`. |
| Full legal actions | NOT IMPLEMENTED | V1d. |
| Secondary decisions external | NOT IMPLEMENTED | Forge AI still handles targets, mana, combat, modes, triggers, and other secondary choices. |

V1c exposes only PASS or the single recommendation returned by Forge AI. It
does not enumerate all legal Magic actions and does not scan zones or abilities
to imitate such an API. Full legal Asphodel action candidates remain V1d work.

## Primary Legal Actions V1d

V1d replaces V1c's single Forge-AI-suggestion primary action with a real,
enumerated set of legal primary actions. The flow is:

```text
Forge priority
      |
      v
ForgeLegalActionEnumerator (Card.getAllPossibleAbilities, restrictions,
                             affordability, target feasibility)
      |
      v
supported primary actions: PASS / PLAY LAND / CAST SPELL / ACTIVATE ABILITY
      |
      v
AsphodelDecisionBroker (pending decision, opaque actionId per candidate)
      |
      v
Node chooses actionId
      |
      v
exact retained SpellAbility object (no re-lookup, no re-derivation)
      |
      v
Forge executes (targets/modes/mana/X/sacrifices/combat/triggers remain
                 inherited PlayerControllerAi secondary decisions)
```

`PlayerControllerAsphodel.chooseSpellAbilityToPlay()` no longer calls
`super.chooseSpellAbilityToPlay()` at all for primary selection: it asks
`ForgeLegalActionEnumerator.enumerate(game, player)` for every supported,
currently-legal candidate on the acting player's own visible cards, and hands
the candidates to `AsphodelDecisionBroker.requestPriorityDecision(...)`, which
publishes them (plus a synthetic PASS entry) as one `PendingDecision` and waits
on a `CompletableFuture`. No Forge AI scoring, ordering preference, or
`AiController.chooseSpellAbilityToPlay()`/`SpellAbilityPicker` strategic
selection is consulted to choose the primary action — an objectively bad but
legal play (e.g. casting a removal spell with no useful target available) is
enumerated exactly like a good one. PASS is represented as `null`: the broker
returns `null` from `chooseSpellAbilityToPlay()` when the chosen action has no
candidate, which `PhaseHandler` interprets as passing priority; returning an
empty `List<SpellAbility>` is deliberately avoided because Forge's
`PhaseHandler` can re-enter priority repeatedly against an empty list instead
of advancing.

The retained `SpellAbility` object accepted by the Node is the exact object
Forge produced during enumeration — there is no re-lookup or re-derivation
step between selection and execution. `playChosenSpellAbility(SpellAbility)`
resolves targets via the inherited `PlayerControllerAi.chooseTargetsFor(...)`
when the ability requires them (`ForgeLegalActionEnumerator.requiresTargets`),
then delegates execution to `super.playChosenSpellAbility(ability)` and records
the result by object identity through
`AsphodelDecisionBroker.recordPrimaryActionResult(...)`. Every other secondary
decision Forge asks the controller for during that execution — modes, mana
payment, X values, sacrifice/additional-cost choices, optional additional
costs (e.g. Kicker), combat, and triggered-ability decisions — falls through
to the inherited `PlayerControllerAi` untouched. `PlayerControllerAsphodel`
still extends `PlayerControllerAi` and `isAI()` is unchanged (`true`); V1d
externalizes only the primary priority decision.

### Legal action enumeration

`ForgeLegalActionEnumerator.enumerate(Game, Player)` scans exactly these zones
on the acting player's own side — `Hand`, `Battlefield`, `Command`,
`Graveyard`, `Exile` — and, for every card, every ability returned by
`Card.getAllPossibleAbilities(player, true)`. `Library` is deliberately never
scanned, including the acting player's own library: the top card of a library
is hidden information until something reveals it, so treating it as visible
(as an earlier V1d draft briefly did) would leak identity Forge itself would
not disclose. Play from library is NOT IMPLEMENTED until a future pass
explicitly models Forge's play/reveal permissions. Opponent zones are never
scanned at all — the enumerator only ever runs for the acting player, so
opponent hidden hand/library contents cannot surface by construction.

Each candidate ability is classified into one of exactly three supported
types — `play_land` (`SpellAbility.isLandAbility()`), `cast_spell`
(`SpellAbility.isSpell()`), `activate_ability` (activated, non-mana,
non-trigger) — or dropped. Mana abilities and triggered abilities are excluded
by construction of `classify(...)`, and any ability type outside these three is
simply never classified and therefore never exposed. No strategic filtering is
applied (no "wait for later," "save removal," or creature-quality evaluation);
an objectively bad but legal action is enumerable like any other.

A classified candidate must then pass real Forge feasibility checks, in order,
with no AI heuristic among them:

1. `Cost.hasXInAnyCostPart()` — X-cost abilities are excluded outright (see
   Cost/variant support below).
2. `SpellAbility.checkRestrictions(card, player)` — Forge's own restriction
   checks (e.g. sorcery-speed-only, "activate only once per turn").
3. `SpellAbility.isLegalAfterStack()` and `SpellAbility.canPlay()` — Forge's
   own timing/legality checks, including instant-speed vs. sorcery-speed
   windows. Timing is never reimplemented by hand in the bridge.
4. `ComputerUtilCost.canPayCost(ability, player, false)` — real affordability
   against the player's actual current resources, not a heuristic "should
   pay" judgment.
5. `ComputerUtilAbility.isFullyTargetable(ability)` — target feasibility, i.e.
   whether legal targets exist at all; the specific target is not chosen here.

Every candidate that survives becomes one `AsphodelDecisionBroker.ExternalAction`
carrying an opaque `actionId`, a `cardRef` derived from `Card.getId()` (distinct
per physical card instance, so two cards sharing a name still get distinct
`cardRef`/`actionId` pairs), `cardName`, `sourceZone`, `label`, `abilityText`,
`manaCost`, and `requiresTargets`. Commanders are never special-cased in the
enumerator: an affordable commander in the command zone surfaces as an ordinary
`cast_spell` candidate with `sourceZone: "command"` purely because
`Card.getAllPossibleAbilities` and the same restriction/affordability chain
produce it — the same code path as any other card.

### Primary action DTO

```ts
type ForgeExternalAction =
  | {
      actionId: string;
      type: "pass";
      label: string;
      cardRef: null;
      cardName: null;
      sourceZone: null;
      abilityText: null;
      manaCost: null;
      requiresTargets: false;
    }
  | {
      actionId: string;
      type: "play_land" | "cast_spell" | "activate_ability";
      label: string;
      cardRef: string;
      cardName: string;
      sourceZone:
        | "hand" | "battlefield" | "command" | "graveyard" | "exile"
        | "library" | "other";
      abilityText: string | null;
      manaCost: string | null;
      requiresTargets: boolean;
    };
```

No raw Forge `Game`, `Player`, `Card`, or `SpellAbility` crosses the process
boundary; the retained `SpellAbility` stays inside the JVM, addressed only by
`actionId`. `sourceZone: "library"` and `"other"` are represented in the wire
type for forward compatibility but are never produced by the current
enumerator, since the library is not scanned.

### Cost and variant support

| Variant | Status | Notes |
| --- | --- | --- |
| Normal costs | PASS | Checked via `ComputerUtilCost.canPayCost` against real player resources. |
| Alternative costs (e.g. Flashback) | PASS WITH LIMITATION | Mechanically exposed as separate `SpellAbility` instances by `Card.getAllPossibleAbilities`, filtered through the same restriction/affordability chain, but not proven correct end-to-end by a dedicated test. |
| Mandatory additional costs (e.g. sacrifice) | PASS WITH LIMITATION | Affordability is checked by `ComputerUtilCost.canPayCost`; the actual choice of what to pay is an inherited `PlayerControllerAi` secondary decision, not externalized. |
| Optional additional costs (e.g. Kicker) | PASS WITH LIMITATION | Not modeled as a distinct primary action; Forge asks the controller during execution, which falls through to inherited `PlayerControllerAi`. |
| X costs | NOT IMPLEMENTED | Excluded outright (`Cost.hasXInAnyCostPart()`) because a value must be chosen before affordability can be established, and that primary choice is out of scope for V1d. Forge AI is not used to manufacture a value. |

### Execution and secondary decisions

Actions produced by `ForgeLegalActionEnumerator` are execution-ready without
any Forge AI primary-selection step: the Node's chosen `actionId` maps
directly back to the retained `SpellAbility`, which is handed straight to
`playChosenSpellAbility(...)`. For abilities that require targets, V1d still
delegates target selection to the inherited `PlayerControllerAi` — this is
explicit and intentional, not an oversight. The same applies to every other
secondary decision Forge requests during execution: modes, mana payment, X
values, sacrifice/additional-cost choices, combat, and triggered-ability
decisions are all inherited `PlayerControllerAi` behavior and are not
externalized in V1d.

### Capability table

| Capability | Status | Notes |
| --- | --- | --- |
| Pass priority | PASS | Returns `null` from `chooseSpellAbilityToPlay()`; `PhaseHandler` interprets this as pass. An empty list is deliberately avoided. |
| Ordinary land play | PASS | `play_land`, verified end to end: exposed, selected, played, `landsPlayed` counter updates, and the played card's action disappears from the next decision. |
| Ordinary spell | PASS | `cast_spell`, verified end to end including `spellsCast` counter update. |
| Activated non-mana ability | PASS | `activate_ability`, verified end to end including `abilitiesActivated` counter update. |
| Commander cast | PASS | Surfaces as an ordinary `cast_spell` with `sourceZone: "command"` once affordable; not special-cased in the enumerator. |
| Timing restrictions | PASS | Verified via Forge's own `isLegalAfterStack()`/`canPlay()`: an instant is exposed on the opponent's turn, a sorcery-speed spell is not. No phase logic is reimplemented by hand. |
| Cost affordability | PASS | `ComputerUtilCost.canPayCost` filters out a visible, unaffordable card even when it is the only card in hand. |
| Multiple legal actions | PASS | A single decision can expose more than one real supported action (e.g. several lands), not just one AI-preferred pick. |
| Duplicate card identity | PASS | Two cards sharing a name get distinct `cardRef` (from `Card.getId()`) and distinct `actionId`. |
| Hidden-info safety | PASS | Opponent zones are never scanned; the acting player's own `Library` (including its top card) is never scanned either. Regression-tested. |
| Play from library | NOT IMPLEMENTED | Deferred until Forge's play/reveal permissions and visibility are explicitly modeled. |
| Alternative costs | PASS WITH LIMITATION | See Cost and variant support above. |
| Optional costs | PASS WITH LIMITATION | See Cost and variant support above. |
| X costs | NOT IMPLEMENTED | See Cost and variant support above. |
| Mana abilities | NOT EXPOSED | Excluded by `classify(...)`; mana payment remains an inherited Forge AI secondary decision. |
| Targets external | HISTORICAL V1d LIMITATION | Externalized by V1f below. |
| Modes external | NOT IMPLEMENTED | Inherited Forge AI secondary decision. |
| Combat external | NOT IMPLEMENTED | Inherited Forge AI secondary decision. |
| Full legal-action completeness | PASS WITH LIMITATION | Proven for the four supported action types under the tested fixtures; not claimed as an exhaustive Magic legal-action API. |

### Progress metrics

`AsphodelDecisionBroker` tracks `decisionsRequested`, `decisionsSubmitted`,
`passesSubmitted`, `primaryActionsSubmitted`, `primaryActionsPlayed`,
`landsPlayed`, `spellsCast`, and `abilitiesActivated`. There were no obsolete
V1c "Forge suggestion" counters to remove — V1c's counters already matched
this shape; only the meaning of "primary action" changed, from a single Forge
AI suggestion to any enumerated candidate.

## AgentObservation V1e

Forge owns the complete game truth, including hidden zones. V1e introduces
`AgentObservationBuilder` as an explicit visibility boundary:

```text
Forge Game (complete truth)
      |
      v
AgentObservationBuilder(Game, observing Player)
      |  CardView visibility + conservative face-down sanitization
      v
immutable AgentObservation (only what player-1 may know)
      |
      v
get_external_match: observation + pendingDecision
```

The builder is read-only and factual. It neither chooses/evaluates actions nor
calls Forge AI strategy, and it never serializes a raw Forge object. Runtime
cards use the same `card-<Card.id>` identity as V1d actions, allowing a client
to join a visible hand entry directly to its `play_land` or `cast_spell`
candidate.

### Observation DTO

```ts
interface AgentObservation {
  gameRef: string;
  game: {
    turn: number;
    phase: string;
    activePlayerId: string;
    priorityPlayerId: string;
  };
  selfPlayerId: string;
  players: (AgentSelfPlayerObservation | AgentOpponentPlayerObservation)[];
  stack: AgentStackItem[];
}

interface AgentCardObservation {
  cardRef: string;
  name: string | null;
  zone: "hand" | "battlefield" | "graveyard" | "exile" | "command";
  ownerId: string | null;
  controllerId: string | null;
  faceDown: boolean;
  hidden: boolean;
  tapped: boolean | null;
  summoningSick: boolean | null;
  counters: Record<string, number> | null;
  power: number | null;
  toughness: number | null;
  typeLine: string | null;
}
```

Both player variants contain identity, life/starting life, zone sizes, public
zone arrays, commander summaries, and a diagnostic `externalController` flag.
Only `AgentSelfPlayerObservation` has a `hand` field. The opponent concrete DTO
has no such field at all, so Gson cannot accidentally emit opponent hand card
objects; only `handSize` is transported. Neither variant has a library-card
array or top-card field.

Commander summaries contain `cardRef`, public name, `inCommandZone`, and
Forge's `castsFromCommand` count. Stack entries contain `stackRef`, top-first
`position`, source card reference/name when visible, activating player,
sanitized description, and face-down/hidden flags. Targets and internal mode
choices are deliberately absent.

### Visibility and engine APIs

Global context comes from `Game.getId()`, `Game.getPhaseHandler()`,
`PhaseHandler.getTurn()/getPhase()/getPlayerTurn()/getPriorityPlayer()`, and
`Game.getRegisteredPlayers()`. Player facts and zone contents come from
`Player.getLife()`, `getStartingLife()`, `getCardsIn(ZoneType)`, and
`getCommanders()`.

For every serialized card, `CardView.canBeShownTo(observer.getView())` checks
zone visibility. A face-down card additionally requires
`CardView.canFaceDownBeShownTo(observer.getView())` before its real name or
identity-bearing characteristics are exposed. Otherwise `name` is `null`,
`hidden` is `true`, and non-public characteristics are `null`. This applies to
face-down exile, command/graveyard edge cases, and face-down stack sources. A
face-down battlefield permanent still exposes public current P/T, type,
tapped state, and counters while hiding its underlying name.

Public runtime state comes directly from `Card.getOwner()/getController()`,
`isTapped()`, `isSick()`, `getCounters()`, `getNetPower()`,
`getNetToughness()`, and `getType()`. Commander status uses
`Game.getCardState()`, `Card.isInZone(ZoneType.Command)`, and
`Player.getCommanderCast()`. The stack is iterated through `Game.getStack()`;
each `SpellAbilityStackInstance` supplies its stable runtime ID, source card,
activating player, and stack description.

### Snapshot consistency

`PlayerControllerAsphodel.chooseSpellAbilityToPlay()` enumerates legal actions,
then builds the observation on the game thread before publishing either.
`AsphodelDecisionBroker` stores both immutable DTOs in one `PendingInternal`
object and only then pauses that thread on its `CompletableFuture`.
`ExternalMatchSession.snapshot()` reads one `PendingAgentTurn` under the
broker's synchronization and returns its `observation` and `pendingDecision`
together. The NDJSON thread never traverses a mutating `Game`; during
`waiting_for_decision`, context and actions therefore describe the same paused
state.

### Capability table

| Capability | Status | Notes |
| --- | --- | --- |
| Turn/phase context | PASS | Captured from the paused Forge `PhaseHandler`. |
| Active/priority player | PASS | Uses the existing `player-1`/`player-2` IDs and is cross-checked against `PendingDecision.context`. |
| Own hand identities | PASS | Full sanitized card summaries; `hand.length === handSize` is tested. |
| Opponent hand size | PASS | Numeric size only. |
| Opponent hand identities hidden | PASS | Opponent DTO has no `hand` field; a distinctive hidden card-name regression test passes. |
| Library sizes | PASS | Numeric sizes for every player. |
| Library identities hidden | PASS | No library array, top card, or known-card field exists in the DTO. |
| Battlefield public state | PASS | Names plus engine-derived controller/owner, tapped, counters, type, and creature P/T. |
| Graveyard public state | PASS | Opponent `Soul Summons` is observed after real resolution. |
| Exile visibility | PASS WITH LIMITATION | `CardView` current visibility is enforced; Pyxis face-down exile is regression-tested. Historical knowledge is not retained. |
| Command zone | PASS | Public cards plus commander presence and Forge commander-cast count. |
| Stack summary | PASS WITH LIMITATION | Top-first public source/activator/description; targets and hidden descriptions are omitted. |
| Runtime cardRef consistency | PASS | Same `cardRef` is tested across self hand, legal action, then battlefield after play. |
| Face-down sanitization | PASS WITH LIMITATION | Opponent manifest and both players' Pyxis exile are tested; current Forge visibility is authoritative, with no historical knowledge model. |
| Historical known information | NOT IMPLEMENTED | Future knowledge model. |
| Revealed hand memory | NOT IMPLEMENTED | Future knowledge model. |
| Known top-of-library memory | NOT IMPLEMENTED | Future knowledge model. |

V1e adds no card score, recommendation, threat value, database persistence,
frontend, Scryfall game-state lookup, or AI. Its original snapshot contains no
chosen-target annotations; V1f adds target decisions without changing this
observation DTO.

## External Targets V1f

For an ordinary targeted primary action, control now crosses the process
boundary twice:

```text
Node selects actionId for Lightning Bolt
       |
       v
JVM retains that exact SpellAbility and asks Forge for current targets
       |
       v
get_external_match -> target_selection (player/card/spell targetId values)
       |
       v
Node submits one targetId
       |
       v
JVM adds the retained GameObject to the retained SpellAbility TargetChoices
       |
       v
Forge validates, pays costs, puts the spell on the stack, and continues
```

`PlayerControllerAsphodel.playChosenSpellAbility(...)` calls
`SpellAbility.setupTargets()`. Forge walks the real root/sub-ability chain and
calls the controller's overridden `chooseTargetsFor(...)` for each targeting
block. `ForgeTargetChoiceEnumerator` derives cards through
`CardUtil.getValidCardsToTarget`, players through `SpellAbility.canTarget`, and
stack spells through `SpellAbility.canTargetSpellAbility`. Forge's
`StaticAbilityMustTarget.filterMustTargetCards` is applied under the same
parent/sub-ability condition used by Forge's human target flow. No target
restriction is parsed or reimplemented from card text.

The pending wire decision is a discriminated sibling of `priority_action`:

```ts
interface ForgePendingTargetDecision {
  decisionId: string;
  type: "target_selection";
  playerId: string;
  context: ForgePendingDecision["context"];
  source: {
    actionId: string | null;
    cardRef: string;
    cardName: string;
    abilityText: string | null;
  };
  prompt: string;
  minTargets: number;
  maxTargets: number;
  selectedTargetIds: string[];
  canFinish: boolean;
  finishTargetId: string | null;
  targets: ForgeExternalTarget[];
}
```

Each target has an opaque `targetId` and a `type` of `player`, `card`, or
`spell`. Player targets carry `playerId`; card targets carry `cardRef`; stack
targets carry `stackRef` and their source `cardRef`. Visible labels/names use
the same `CardView` visibility checks as `AgentObservation`. A legal face-down
or otherwise hidden card remains selectable by opaque reference but has
`name: null` and `hidden: true`.

The submission command accepts exactly one selector field:

```ts
{ type: "submit_external_decision", sessionId, decisionId, actionId }
{ type: "submit_external_decision", sessionId, decisionId, targetId }
```

Using `actionId` for `target_selection` returns `TARGET_ID_REQUIRED`; using
`targetId` for `priority_action` returns `ACTION_ID_REQUIRED`. Unknown targets
return `TARGET_NOT_FOUND` without consuming the pending choice. Re-submitting
an answered target decision returns `STALE_DECISION`.

Targets with `maxTargets > 1` are selected sequentially. After every submitted
target, Forge recomputes the candidates against the same ability and its
already-populated `TargetChoices`, so constraints such as distinct targets or
different controllers remain engine-authoritative. Once the minimum is met,
`canFinish` and `finishTargetId` allow Node to stop before the maximum.

The broker adds `targetDecisionsRequested`, `targetDecisionsSubmitted`, and
`targetsSelected` progress counters. Integration tests prove each supported
target shape from the requested flow. Node chooses `player-2` for a retained
Lightning Bolt and separately chooses the public `cardRef` of Grizzly Bears;
after Forge resolves the Bolt, that exact Bears reference is observed in the
graveyard. Dedicated validation fixtures additionally prove:

- `Counterintelligence` recomputes candidates after the first of two creature
  targets, reports that target in `selectedTargetIds`, omits the duplicate,
  and returns both exact chosen `cardRef` values to their owner's hand.
- A second `Counterintelligence` run exposes no finish before its minimum, then
  exposes and accepts `finishTargetId`; only the one submitted creature moves.
- `Predict`'s non-targeting `NameCard` root reaches its target-bearing `DBMill`
  sub-ability. Node targets `player-2`, whose real library and graveyard counts
  then change by exactly one.
- `Counterspell` exposes the opponent's real Grizzly Bears stack instance. Its
  target `stackRef` and source `cardRef` equal the same AgentObservation stack
  entry; after Node selects it, both cards reach their expected graveyards and
  the Bears never enters the battlefield.

All target submissions in these fixtures pass through the external target
decision counters. `PlayerControllerAi.chooseTargetsFor(...)` remains only the
explicit random-target and divided-allocation fallback.

### Target capability table

| Capability | Status | Notes |
| --- | --- | --- |
| Player targets | PASS | Both real players are exposed for Lightning Bolt and selected by `targetId`. |
| Public card targets | PASS | Grizzly Bears is selected by `cardRef`/`targetId` and its real zone transition is verified. |
| Hidden card targets | PASS WITH LIMITATION | Targetable via opaque reference; current Forge visibility is enforced and no historical knowledge is modeled. |
| Stack spell targets | PASS | A real Counterspell targets the exact observed Grizzly Bears stack object by matching `stackRef`/`sourceCardRef`, counters it, and both spells reach their expected graveyards. |
| Multiple targets | PASS | Real Counterintelligence fixtures prove two sequential exact targets, candidate recomputation/duplicate omission, no finish before the minimum, and successful early finish after it. |
| Root/sub-ability target chains | PASS | Real Predict proves `setupTargets` reaches the target-bearing `DBMill` sub-ability; Node's player target is retained and the exact mill resolves. |
| Must-target effects | PASS WITH LIMITATION | Forge filtering and final `setupTargets` validation are used; no dedicated fixture test yet. |
| Random targets | FORGE FALLBACK | `TargetRestrictions.isRandomTarget()` remains with Forge so Node cannot override randomness. |
| Divided allocations | FORGE FALLBACK | Target plus amount allocation remains with Forge until an allocation decision DTO exists. |
| Mana, X, sacrifices, combat, triggers, replacements | NOT IMPLEMENTED | Remain inherited Forge AI secondary decisions; fixed single modes are covered by V1g below. |

## External Mode Selection V1g

V1g externalizes the fixed, choose-exactly-one subset of Forge modal choices
without changing primary action enumeration:

```text
Node selects CAST SPELL / ACTIVATE ABILITY
       |
       v
Forge CharmEffect.makeChoices asks the controller for a mode
       |
       v
mode_selection exposes Forge-filtered AbilitySub objects by opaque modeId
       |
       v
Node selects modeId
       |
       v
if the retained mode targets: target_selection -> Node selects targetId
       |
       v
Forge chains its copy of the selected mode and resolves normally
```

### Pinned Forge API and call path

At Forge revision `6356c1ad565029c82513c96e42ad5492c1b09c4e`, the
controller seam is:

```java
List<AbilitySub> chooseModeForAbility(
    SpellAbility sa,
    List<AbilitySub> possible,
    int min,
    int num,
    boolean allowRepeat
)
```

`PlayerController` declares it, while `PlayerControllerAi` delegates to
`AiController.chooseModeForAbility` and then the Charm AI chosen list.
`ComputerUtil.handlePlayingSpellAbility` calls `CharmEffect.makeChoices(sa)`
while playing a modal spell. `makeChoices` calls
`CharmEffect.makePossibleOptions(sa)`, which removes a mode when its mandatory
targets have no candidate and applies `ChoiceRestriction`; it then invokes the
choosing player's `chooseModeForAbility`. Finally,
`CharmEffect.chainAbilities` sorts the returned mutable list and appends Forge
copies of the chosen `AbilitySub` objects.

`PlayerControllerAsphodel` overrides exactly that seam for a Node-accepted
primary ability. The supported branch returns the broker-retained `AbilitySub`
to Forge rather than reconstructing it. If that mode targets, it calls
`setupTargets()` on the retained mode after Node selects it and before
`CharmEffect` copies and chains it; Forge's `SpellAbility.copy()` preserves the
real `TargetChoices`. This gives the required mode-before-target order. No
`PlayerControllerAi` mode or target strategy runs on this supported branch.

### Mode decision protocol

`ForgePendingExternalDecision` now includes:

```ts
interface ForgePendingModeDecision {
  decisionId: string;
  type: "mode_selection";
  playerId: string;
  context: ForgeDecisionContext;
  source: {
    actionId: string | null;
    cardRef: string | null;
    cardName: string | null;
    abilityText: string | null;
  };
  prompt: string | null;
  minModes: number;
  maxModes: number;
  selectedModeIds: string[];
  canFinish: boolean;
  finishModeId: string | null;
  modes: Array<{
    modeId: string;
    label: string;
    description: string | null;
  }>;
}
```

The broker maps each `mode-N` to the exact `AbilitySub` instance supplied by
Forge. Mode labels and descriptions come only from the static card-script
`SpellDescription`; the bridge does not interpolate game state or hidden card
names. A missing static description, mode cost, nonliteral count, optional
count, random choice, or repeatable mode shape makes the whole request fall
back to inherited Forge AI.

`submit_external_decision` accepts exactly one of `actionId`, `targetId`, or
`modeId`. A wrong selector for a mode decision returns `MODE_ID_REQUIRED`; an
unknown mode returns `MODE_NOT_FOUND` without consuming the decision; reuse of
an answered decision returns `STALE_DECISION`. Progress adds
`modeDecisionsRequested`, `modeDecisionsSubmitted`, and `modesSelected`.

The real `Gruesome Realization` fixture proves a fixed single mode: Node chooses
the draw-two/lose-two mode, observes both effects, and observes that the
opponent's Grizzly Bears did not receive the alternative -1/-1 effect. The real
`Light of Hope` fixture proves legal filtering and composition: with no legal
enchantment target, Forge exposes only gain-life and put-counter; Node chooses
put-counter, then V1f exposes the observed Grizzly Bears `cardRef`, and the exact
creature receives the counter while life does not change. Both decisions link
back to the original primary `actionId` and capture their observation on the
paused Forge game thread.

### Mode capability table

| Capability | Status | Notes |
| --- | --- | --- |
| Single-mode choice | PASS | Real Gruesome Realization and Light of Hope choose-exactly-one fixtures resolve Node-selected modes. |
| Legal mode enumeration | PASS | Forge's `makePossibleOptions` removes Light of Hope's destroy-enchantment mode when it has no legal target. |
| Real Forge mode object retained | PASS | Opaque `modeId` maps to the exact supplied `AbilitySub`; Forge then performs its normal copy/chain operation. |
| Observation/mode same snapshot | PASS | Mode context is cross-checked against the fresh observation captured at the paused call. |
| Primary action link | PASS | Both fixtures preserve the original cast action in `source.actionId`. |
| Mode -> target composition | PASS | Light of Hope produces mode selection, then V1f card targeting, then the exact counter result. |
| Invalid mode protection | PASS | Wrong selector and unknown `modeId` are rejected without consuming the decision. |
| Stale mode protection | PASS | Reusing the answered mode decision returns `STALE_DECISION`. |
| Multiple modes | FORGE FALLBACK | Counts other than fixed one are deliberately delegated to inherited Forge AI. |
| Optional mode count | FORGE FALLBACK | `MinCharmNum` shapes other than fixed one are not externalized. |
| Repeated same mode | FORGE FALLBACK | `CanRepeatModes` is not externalized. |
| Dynamic/hidden modes | FORGE FALLBACK | Only nonblank static script `SpellDescription` values are exposed; other shapes remain with Forge AI. |
| X-dependent modes | NOT IMPLEMENTED | Primary X actions remain omitted; nonliteral modal counts are not externalized. |

V1g does not externalize X, mana selection/payment, optional or mandatory
additional costs, sacrifices, combat, triggers, replacement effects, or
mulligans. `PlayerControllerAsphodel.isAI()` remains inherited as `true`.

## Card database initialization

`ForgeDataRepository` initializes the pieces normally prepared by Forge's GUI
model while remaining GUI-free: language/localization, dynamic card types,
non-stacking keywords, headless image-key paths, and Forge AI profiles. It then
creates `StaticData` from real `CardStorageReader` instances rooted at:

```text
vendor/forge/forge-gui/res/cardsfolder
vendor/forge/forge-gui/res/tokenscripts
vendor/forge/forge-gui/res/editions
vendor/forge/forge-gui/res/blockdata
vendor/forge/forge-gui/res/setlookup
```

Normal cards are indexed lazily and resolved with
`StaticData.attemptToLoadCard`; tokens are loaded eagerly because card scripts
may create them during play. Fixtures include Mountain, Island, Swamp, Plains,
Forest, Lightning Bolt, Counterintelligence, Predict, Counterspell, Gruesome
Realization, Light of Hope, Grizzly Bears, Goblin Piker, Krenko, Tin Street
Kingpin, Talrand, Sky Summoner, Ayara, First of Locthwain, Isamaru, Hound of
Konda, and Ayula, Queen Among Bears. No rules text or ability is hardcoded. The
response exposes Lightning Bolt's parsed `CardRules`, Oracle text, mana cost,
and raw `SP$ DealDamage` script ability as integration evidence.

## Fixture and game orchestration

`run_test_game` retains small, in-memory engine-test fixtures for V1 regression:

- Red: 10 Mountain, 5 Lightning Bolt, 5 Goblin Piker; Krenko as commander.
- Green: 10 Forest, 10 Grizzly Bears; Ayula as commander.

They are intentionally nonconformant deck lists (duplicates and fewer than 100
cards) accepted by this low-level Forge match path. This keeps the validation
fixture simple and does not claim deck-legality validation.
`ForgeGameRunner` no longer creates these lists: it receives two already-built
`Deck` objects, so the same runner executes both regression fixtures and V1b
Deck Library matches.

For Commander, `RegisteredPlayer.forCommander` supplies 40 starting life and
the commander configuration. `GameRules(GameType.Commander)` activates the
variant; `Match.createGame()` creates the real game; `Match.startGame()` sets up
libraries, opening hands, all normal zones, and the command zone before running
the normal Forge turn loop. Both lobby players are `LobbyPlayerAi` instances
whose game controllers are real `forge.ai.PlayerControllerAi` objects.

`MyRandom.setRandom(new Random(seed))` uses Forge's supported shared RNG seam.
The integration test repeats seed `12345` in the same JVM and observes the same
starting snapshot, winner, and turn count. This is demonstrated reproducibility
for the pinned fixture, not a compatibility promise across Forge revisions,
JDKs, or platforms.

Each game runs on a dedicated daemon executor. A configurable wall-clock
timeout (1–120 seconds, default 30) cancels the task, asks Forge to end the game
as a draw, and returns the structured `GAME_TIMEOUT` error without deliberately
terminating the long-lived JVM. The executor is also interrupted and given a
short termination window. The integration suite forces this path and then runs
a terminal `run_deck_match` in the same JVM. No separate turn cap is used
because the inspected match API already provides a simulation timeout setting
and the bridge enforces the wall-clock bound.

## Forge Game Bootstrap V1 capability report

| Capability | Status | Forge API used | Notes |
| --- | --- | --- | --- |
| Real card loading | PASS | `CardStorageReader`, `StaticData.attemptToLoadCard`, `PaperCard` | Real scripts/assets from the pinned submodule; Lightning Bolt ability asserted. |
| forge-game linkage | PASS | `forge.game.Game`, `Match`, `GameRules` | Module is in the local Maven reactor and shaded bridge. |
| Game creation | PASS | `Match.createGame()` | Two real registered players and in-memory decks. |
| Commander bootstrap | PASS WITH LIMITATION | `GameType.Commander`, `RegisteredPlayer.forCommander` | Real variant, but deliberately nonconformant small fixtures. |
| Command zone | PASS | `Player.getZone(ZoneType.Command)`, `Player.getCommanders()` | Each commander is verified in the command zone after setup. |
| 40 starting life | PASS | `RegisteredPlayer.forCommander`, `Player.getStartingLife()` | Both players report 40. |
| Forge AI player | PASS | `LobbyPlayerAi`, `PlayerControllerAi` | Two actual Forge AI controllers; no Asphodel/random bot. |
| Headless full game | PASS | `Match.startGame()`, `GameOutcome` | Seed 12345 fixture reaches a terminal engine outcome. |
| Deterministic seed | PASS WITH LIMITATION | `MyRandom.setRandom(Random)` | Same-JVM integration repeat matches setup, winner, and turns for the pinned fixture. |

## Process and protocol

`ForgeBridgeClient` starts one long-lived process equivalent to:

```sh
java -Dasphodel.forge.assets=vendor/forge/forge-gui/res \
  -jar forge-bridge/app/target/asphodel-forge-bridge.jar
```

The default absolute assets path is derived by the TypeScript client and can be
overridden with `forgeAssetsPath`. Requests and responses are one JSON object
per line. The bridge retains the original stdout stream exclusively for NDJSON
and redirects `System.out` to stderr before Forge initializes, because upstream
Forge code emits diagnostics through both logging and `System.out`.

The client uses UUID request IDs, correlates in-flight requests, rejects pending
work on exit, and supports clean shutdown. Supported commands are `ping`,
`engine_info`, `forge_color_identity`, `run_test_game`, `inspect_deck`, and
`run_deck_match`, plus the four external-session commands documented above.

Example inspection request:

```json
{"protocolVersion":1,"requestId":"req-inspect","type":"inspect_deck","deck":{"name":"Krenko","cards":[{"name":"Krenko, Tin Street Kingpin","quantity":1,"section":"commander"},{"name":"Mountain","quantity":10,"section":"mainboard"}]}}
```

Successful inspection response (the counts come from the constructed Forge
Deck):

```json
{"protocolVersion":1,"requestId":"req-inspect","ok":true,"type":"inspect_deck","result":{"name":"Krenko","totalCards":11,"mainboardCards":10,"commanderCards":1,"commanders":["Krenko, Tin Street Kingpin"],"resolvedUniqueCards":2}}
```

`run_deck_match` accepts `format: "commander"`, optional `seed` and
`timeoutSeconds`, and exactly two `ForgeDeckSpec` values. Its player summaries
include `deckName` provenance in addition to AI/controller and starting-zone
evidence.

Errors are structured and do not normally stop the process. Codes are
`INVALID_JSON`, `INVALID_REQUEST`, `UNSUPPORTED_PROTOCOL`, `INVALID_PAYLOAD`,
`UNSUPPORTED_COMMANDER_CONFIGURATION`, `FORGE_CARDS_NOT_FOUND`,
`UNKNOWN_COMMAND`, `GAME_TIMEOUT`, and `INTERNAL_ERROR`.

## Known limitations and failure modes

- Small fixtures validate conversion and engine execution, not Commander deck
  legality.
- Full Scryfall double-face names are not normalized to Forge front-face names
  in V1b and can return `FORGE_CARDS_NOT_FOUND`.
- Commander tax, commander damage, and replacement effects are not asserted by
  these bridge tests.
- Seed reproducibility is verified only for the pinned fixture in one JVM.
- NDJSON requests are processed serially, but an external game runs on its
  worker so polling, action/target submission, cancellation, and ping remain
  responsive. Synchronous V1b matches still occupy the request thread.
- There is no automatic restart after JVM failure, complete legal-action API,
  physical-table synchronization, or Asphodel ML agent.
- Missing Java, jar, assets, protocol mismatch, timeout, or JVM exit is surfaced
  as a typed bridge/process error.
- Forge upstream is unmodified. V1f only calls its public runtime APIs.

## Updating Forge

Review and pin a new full commit SHA, update the gitlink,
`EXPECTED_FORGE_REVISION`, Maven properties, test expectations, and this report,
then rerun all bridge and product checks. Never track a moving Forge branch in a
release. See `forge-bridge/NOTICE.md` and `vendor/forge/LICENSE` for attribution.
