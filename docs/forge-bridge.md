# Asphodel Forge Bridge — External Controller V1c

## Scope

This bridge is an isolated validation seam between the Node.js backend and the
original Java [Card-Forge/forge](https://github.com/Card-Forge/forge) engine. V1c
loads real Forge card scripts, converts Deck Library views into real
`forge.deck.Deck` instances, and supports either two normal Forge AI controllers
or an asynchronous match with one hybrid Asphodel controller. The integration
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

## External Controller V1c

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
may create them during play. The fixture requires Mountain, Forest, Lightning
Bolt, Grizzly Bears, Goblin Piker, Krenko, Tin Street Kingpin, and Ayula, Queen
Among Bears. No rules text or ability is hardcoded. The response exposes
Lightning Bolt's parsed `CardRules`, Oracle text, mana cost, and raw
`SP$ DealDamage` script ability as integration evidence.

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
`run_deck_match`, plus the four V1c external-session commands documented above.

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
- NDJSON requests are processed serially, but a V1c external game runs on its
  worker so polling, decision submission, cancellation, and ping remain
  responsive. Synchronous V1b matches still occupy the request thread.
- There is no automatic restart after JVM failure, complete legal-action API,
  physical-table synchronization, or Asphodel ML agent.
- Missing Java, jar, assets, protocol mismatch, timeout, or JVM exit is surfaced
  as a typed bridge/process error.
- Forge upstream is unmodified. V1c only reads its sources and runtime assets.

## Updating Forge

Review and pin a new full commit SHA, update the gitlink,
`EXPECTED_FORGE_REVISION`, Maven properties, test expectations, and this report,
then rerun all bridge and product checks. Never track a moving Forge branch in a
release. See `forge-bridge/NOTICE.md` and `vendor/forge/LICENSE` for attribution.
