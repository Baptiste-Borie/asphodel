# Asphodel Forge Bridge — Game Bootstrap V1

## Scope

This bridge is an isolated validation seam between the Node.js backend and the
original Java [Card-Forge/forge](https://github.com/Card-Forge/forge) engine. V1
loads real Forge card scripts, creates an in-memory fixture match, and lets two
Forge AI controllers play it to completion. It is not connected to the
Asphodel HTTP API, Deck Library, SQLite, Drizzle, Scryfall, or frontend.

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
      | NDJSON over stdin/stdout
      v
Asphodel Forge Bridge (Java)
      |
      +-- forge-core  (CardStorageReader, StaticData, card scripts)
      +-- forge-game  (GameRules, RegisteredPlayer, Match, Game)
      `-- forge-ai    (LobbyPlayerAi, PlayerControllerAi)
```

The bridge owns the small Asphodel-facing DTOs; no raw Forge object crosses the
process boundary. Maven resolves the Forge modules directly from the pinned
submodule reactor, not from Maven Central.

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

The bridge deliberately uses small, in-memory engine-test fixtures rather than
product decks:

- Red: 10 Mountain, 5 Lightning Bolt, 5 Goblin Piker; Krenko as commander.
- Green: 10 Forest, 10 Grizzly Bears; Ayula as commander.

They are intentionally nonconformant deck lists (duplicates and fewer than 100
cards) accepted by this low-level Forge match path. This keeps the validation
fixture simple and does not claim deck-legality validation.

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
terminating the long-lived JVM. No separate turn cap is used because the
inspected match API already provides a simulation timeout setting and the
bridge enforces the wall-clock bound.

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
| Headless full game | PASS | `Match.startGame()`, `GameOutcome` | Seed 12345 fixture ended naturally after 23 turns in the reference run. |
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
`engine_info`, `forge_color_identity`, and `run_test_game`.

Example request:

```json
{"protocolVersion":1,"requestId":"req-game","type":"run_test_game","format":"commander","seed":12345,"timeoutSeconds":30}
```

Condensed successful response:

```json
{"protocolVersion":1,"requestId":"req-game","ok":true,"type":"run_test_game","result":{"gameId":"forge-game-1","format":"commander","seed":12345,"players":[{"id":"player-1","name":"Test AI Red","startingLife":40,"ai":true,"controllerClass":"forge.ai.PlayerControllerAi","zones":{"library":13,"hand":7,"battlefield":0,"graveyard":0,"command":2},"commanders":["Krenko, Tin Street Kingpin"],"commandersInCommandZone":true},{"id":"player-2","name":"Test AI Green","startingLife":40,"ai":true,"controllerClass":"forge.ai.PlayerControllerAi","zones":{"library":13,"hand":7,"battlefield":0,"graveyard":0,"command":2},"commanders":["Ayula, Queen Among Bears"],"commandersInCommandZone":true}],"winnerId":"player-2","turns":23,"gameOver":true,"draw":false,"terminalReason":"AllOpponentsLost","commanderRulesActive":true}}
```

Errors are structured and do not normally stop the process. Codes are
`INVALID_JSON`, `INVALID_REQUEST`, `UNSUPPORTED_PROTOCOL`, `INVALID_PAYLOAD`,
`UNKNOWN_COMMAND`, `GAME_TIMEOUT`, and `INTERNAL_ERROR`.

## Known limitations and failure modes

- Fixtures validate engine execution, not Commander deck legality or Asphodel
  deck conversion.
- Commander tax, commander damage, and replacement effects are not asserted by
  this V1 test.
- Seed reproducibility is verified only for the pinned fixture in one JVM.
- Requests are processed serially; a running match occupies the bridge until it
  ends or times out.
- There is no automatic restart after JVM failure, no pending-decision API, no
  physical-table synchronization, and no Asphodel ML agent.
- Missing Java, jar, assets, protocol mismatch, timeout, or JVM exit is surfaced
  as a typed bridge/process error.
- Forge upstream is unmodified. V1 only reads its sources and runtime assets.

## Updating Forge

Review and pin a new full commit SHA, update the gitlink,
`EXPECTED_FORGE_REVISION`, Maven properties, test expectations, and this report,
then rerun all bridge and product checks. Never track a moving Forge branch in a
release. See `forge-bridge/NOTICE.md` and `vendor/forge/LICENSE` for attribution.
