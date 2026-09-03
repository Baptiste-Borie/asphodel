# Asphodel Forge Bridge — Deck Adapter V1b

## Scope

This bridge is an isolated validation seam between the Node.js backend and the
original Java [Card-Forge/forge](https://github.com/Card-Forge/forge) engine. V1b
loads real Forge card scripts, converts Deck Library views into real
`forge.deck.Deck` instances, and lets two Forge AI controllers play them to
completion. The integration is backend-only: it adds no product Game HTTP API,
persistent Game model, human controller, or frontend behavior.

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
`run_deck_match`.

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
  this V1 test.
- Seed reproducibility is verified only for the pinned fixture in one JVM.
- Requests are processed serially; a running match occupies the bridge until it
  ends or times out.
- There is no automatic restart after JVM failure, no pending-decision API, no
  physical-table synchronization, and no Asphodel ML agent.
- Missing Java, jar, assets, protocol mismatch, timeout, or JVM exit is surfaced
  as a typed bridge/process error.
- Forge upstream is unmodified. V1b only reads its sources and runtime assets.

## Updating Forge

Review and pin a new full commit SHA, update the gitlink,
`EXPECTED_FORGE_REVISION`, Maven properties, test expectations, and this report,
then rerun all bridge and product checks. Never track a moving Forge branch in a
release. See `forge-bridge/NOTICE.md` and `vendor/forge/LICENSE` for attribution.
