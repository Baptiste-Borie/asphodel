# V2e — Web Playtest Interface

Base: V2d `65eaa00`.
Forge remains exactly `6356c1ad565029c82513c96e42ad5492c1b09c4e` (`git -C vendor/forge status --short` empty). **Vendor Forge, `BaselineAsphodelAgentV2b` and its scoring policy are all unmodified.**

This is not Asphodel's final board. It replaces the CLI as the primary human interface with a plain, functional web screen — Vite + TypeScript + vanilla DOM, no framework, no images, no drag-and-drop, no animation — built specifically so the same pieces (`CardSearch`, the decision-menu contract, the session manager) carry forward into the physical-cards milestone without a frontend rewrite.

## Architecture

```
Browser (Vite/TS/DOM)
   │ fetch, same-origin relative URLs (/playtests/...)
   ▼
Fastify (backend/src/app.ts)
   │ registerPlaytestRoutes
   ▼
PlaytestSessionManager (one active playtest at a time)
   │ owns: bridge, transport, WebHumanDecisionProvider, BaselineAsphodelAgentV2b, DecisionRecorder
   ▼
runHumanVsAgentMatch  (V2c, unchanged switch/validation logic; +endRequested)
   │
   ▼
ForgeExternalMatchClient → Forge bridge (unmodified)
```

The browser never talks to Forge directly, never receives Asphodel's observation, and never invents a choice — every button the frontend renders comes from a choice object the backend already built and validated the shape of. No second game engine and no manual board reconstruction exist anywhere in this stack: the board the browser renders is built from the same `AgentObservation` the CLI already renders from, and the session manager exposes it, never recomputes it.

## `WebHumanDecisionProvider`

`backend/src/human/web-human-decision-provider.ts` implements `HumanDecisionProvider` exactly:

- `choose(observation, decision)` stores both and returns a `Promise` that stays pending — there is only ever one in flight, because `runHumanVsAgentMatch` never calls a provider's `choose()` again before the previous call resolves.
- `current()` exposes `{ observation, decision }` (or `null` when it is not the human's turn) to the session manager — read-only, no mutation path.
- `submit(choice)` is the only way to resolve the pending promise: it rejects immediately (submitting nothing) on a wrong/stale `decisionId` (`WebHumanDecisionError("STALE_DECISION")`) or when nothing is pending (`"NO_PENDING_DECISION"`), and always calls the existing `validateChoice(decision, choice)` — the same check the CLI and V2b's agent runner already use — before ever resolving. An illegal choice throws from `validateChoice` itself and is never submitted.
- `requestEnd()`/`endRequested()` implement the "end at any time" contract (see below).

## `PlaytestSessionManager`

`backend/src/human/playtest-session-manager.ts` — one active playtest at a time, a personal tool, not a multi-user system (a second `POST /playtests` while one is `starting`/`running`/`waiting_for_human` is refused with `PLAYTEST_ALREADY_RUNNING`; once terminal, a new one is accepted, replacing the old record).

`start()` resolves both decks (reusing `deck-resolver.ts`, see below), starts a bridge, and launches `runHumanVsAgentMatch` in a **background promise** it does not await — the HTTP call returns `{ sessionId, status: "starting" }` immediately, and Fastify keeps serving other requests while the match runs. `getState()` derives `WebPlaytestStatus` from two things only: the manager's own coarse phase (`starting` / `in_progress` / a terminal phase) and `WebHumanDecisionProvider.current()` — `in_progress` reports `waiting_for_human` when a decision is pending, else `running`. No separate polling loop or duplicated Forge state exists.

`bridge`/`client`/`agent` construction is injectable (`PlaytestSessionManagerDeps`) purely for testing — production code (`app.ts`) uses the real `ForgeBridgeClient`/`ForgeExternalMatchClient`/`BaselineAsphodelAgentV2b` via the defaults.

## HTTP API

| Route | Behavior |
| --- | --- |
| `POST /playtests` | Body `{ humanDeck: DeckInput, asphodelDeck: DeckInput, seed? }`, `DeckInput = {type:"fixture"} \| {type:"library",value} \| {type:"archidekt",value}`. Refuses a second concurrent playtest (409 `PLAYTEST_ALREADY_RUNNING`). Returns `{ sessionId, status }`. |
| `GET /playtests/:sessionId` | Returns `WebPlaytestStateDTO`: status, both deck names, **the human's own `observation` only** (`null` when it isn't the human's turn), a ready-to-render `pendingDecision` (see below), the public event log, `asphodelDecisionCount`, `endedByHuman`, the terminal `result`, and `error`. Meant to be polled every ~300ms — no WebSocket in V2e. |
| `POST /playtests/:sessionId/choice` | Body is a raw `AgentChoice`. Delegates straight to `WebHumanDecisionProvider.submit` — same staleness/`validateChoice` guarantees as above; a rejected choice is a 409, never a silent no-op. |
| `POST /playtests/:sessionId/end` | The web equivalent of the CLI's `end`. Cancels Forge exactly once, preserves the final snapshot and every already-recorded Asphodel decision, writes the V2d report, and returns the settled `WebPlaytestStateDTO` — never an error. |
| `GET /playtests/:sessionId/report` | `{ directory, summaryPath, decisionsPath }` once the playtest has actually finished; 409 `REPORT_NOT_READY` before that. |

`pendingDecision.rendered` is exactly `describeDecision(observation, decision)`'s return value (`human-decision-render.ts`, the module `human-cli-render.ts` was renamed to in this milestone so both the CLI and this "web frontend DTO builder" can share it) — a menu of `{label, choice}` pairs or a bounded numeric prompt. **The decision-to-label transform runs once, on the backend.** The frontend never re-derives a choice from the raw Forge decision; it only ever renders `rendered.items[].choice` verbatim back through `POST .../choice`.

### Ending a playtest at any moment, not only on the human's turn

The CLI's `end`/`quit` only ever fires while `TerminalHumanDecisionProvider.choose()` is actually being asked — a human always types it in response to their own prompt. A browser has no such constraint: "End playtest" can be clicked while Asphodel is mid-turn, with no human decision pending at all. `HumanVsAgentOptions` gained an `endRequested?: () => boolean` predicate, polled once per `runHumanVsAgentMatch` loop iteration alongside the existing `signal` check. `WebHumanDecisionProvider.requestEnd()` covers both cases: if a decision is currently pending, it rejects that in-flight `choose()` immediately with `HumanEndMatchError`; otherwise it sets the flag `endRequested()` reports, caught on the very next loop iteration (effectively instant — well under one poll interval). Either path lands in the exact same `HumanEndMatchError` branch already built in V2d: Forge is cancelled once, the last snapshot and every already-recorded decision survive, and the manager returns `endedByHuman: true` — never `AgentRunError`, never a "session failed" message.

## Deck resolution (shared, not duplicated)

`backend/src/decks/deck-resolver.ts` is the one place `DeckInput`/`parseDeckArg`/`resolveDeckInput` live. Both `run-human-vs-asphodel.ts` (CLI, unchanged behavior) and `PlaytestSessionManager` (web) call it — the CLI's own former `resolveDeckArg` was deleted, not duplicated. A `{type:"fixture"}` input keeps the caller's default fixture untouched; `{type:"library",value}` and `{type:"archidekt",value}` reuse V2d's `DeckService`/`ForgeDeckAdapter` and `ArchidektDeckSource` exactly as before.

## Frontend

```
frontend/src/
  main.ts                    — thin bootstrap: nav wiring + init both views
  dom.ts                     — shared element() query helper
  api/api-client.ts          — apiRequest/ApiError, extracted verbatim from the old main.ts
  api/playtest-api.ts         — typed wrappers for the 5 routes above
  decks/deck-library-view.ts — the pre-existing Deck Library screen, extracted unchanged
  playtest/
    types.ts                 — mirrors the backend DTOs field-for-field (same convention the old
                                main.ts already used for DeckDetail/DeckCard — no cross-package
                                TS import between two separate npm packages)
    board-renderer.ts         — pure describeCard/formatPhase (unit-tested) + DOM board building
    decision-renderer.ts      — renders a WebPendingDecisionDTO.rendered as buttons/±-value controls
    card-search.ts            — generic, standalone, tested search widget (see below)
    playtest-view.ts          — setup / live game / end screens, ~300ms polling
```

No React/Vue/Svelte was introduced; the Deck Library screen behaves exactly as before (its own file now, same DOM/behavior, verified by a full frontend build and a live click-through).

### Navigation

Two buttons in the existing header, `Decks` / `Play`, toggle which top-level section (`#decks-group` — library + detail, unchanged — vs `#play-view`, new) is visible. No external router.

### Game screen (textual/structured, not a graphical board)

```
Krenko, Tin Street Kingpin 100-card controller validation vs Ghalta, Primal Hunger 100-card controller validation

Turn 5 — Main 1
You 34     Asphodel 28

ASPHODEL — Asphodel (28 life)
Hand: 4
Battlefield (4)
  Krenko, Tin Street Kingpin [3/4, T]
  Goblin Token [1/1]
  Mountain [T]
  Mountain
Graveyard (0)
Library: 71

YOU — You (34 life)
Hand (4)
  Swords to Plowshares
  Zuran Orb
  Forest
  Crop Rotation
Battlefield (2)
  Uurg, Spawn of Turg [4/4]
  Zuran Orb
Graveyard (2)
  Life from the Loam
  Forest
Library: 68

Asphodel
- Turn 3: Asphodel plays Mountain
- Turn 4: Asphodel casts Goblin Warchief
- Turn 5: Asphodel attacks with Krenko, Tin Street Kingpin

Choose an action
  [1] Play Forest
  [2] Cast Zuran Orb
  [3] Cast Crop Rotation
  [4] Pass priority

                                                      [End playtest]
```

No card images, no rotated CSS for tapped — `[T]` next to the name, same idea as the CLI's `(T)`. `describeCard` reuses tapped/summoning-sick/counters/P-T straight from `AgentCardObservation`, same fields the CLI already reads.

### Zones

Human panel: life, hand (card names — the human's own hand is legitimately visible in their own observation), battlefield, graveyard, exile (when non-empty), command (when non-empty), library count. Asphodel panel: identical except **hand shows a count only, never names** — enforced structurally: `AgentOpponentPlayerObservation` (and the JSON the backend ever sends for Asphodel) has no `hand` field at all, so there is nothing for `board-renderer.ts` to read even if it tried.

Stack renders only when non-empty, using exactly the fields already in the human DTO (`description`/`sourceCardName`, or "hidden spell/ability" when the observation itself reports `hidden`).

### Decision families

Every family the CLI supports renders the same way here, because both consume the identical `describeDecision` output: `priority_action`, `target_selection`, `mode_selection`, `value_selection` (own ±/Confirm control respecting `min`/`max`), `optional_cost_selection`, `cost_object_selection`, `mana_payment`, `attackers_selection`, `blockers_selection`, `combat_order_selection`, `yes_no`, `object_selection`, `ordering_selection`. The user only ever clicks a button; no `objectId`/`decisionId` is ever typed.

### `CardSearch` — preparing the physical mode, not faking it

`frontend/src/playtest/card-search.ts` is generic and fully independent of Forge: `rankCardSearchResults` (pure — case/accent-insensitive substring match, prefix favored, stable for ties) and `createCardSearch` (the DOM widget: ↑/↓ navigation, Enter selects, Escape closes, no query on every keystroke ever reaches a network call — candidates are supplied synchronously by the caller). It is mounted today only as an explicitly labeled **preview** on the setup screen, fed a small static example list, selecting only prints a local message — it is deliberately **not** wired to any Forge zone, draw, mill, tutor, scry or surveil. That connection is exactly the next milestone's job (`PhysicalCardProvider`), and this component is what it will plug into without a frontend rewrite.

## Launcher

```sh
./scripts/dev.sh
```

Runs `backend`'s and `frontend`'s `npm run dev` as two background jobs of one bash script, no external process manager. `trap ... INT TERM EXIT` + `wait -n` mean: Ctrl+C (or either process dying on its own) stops both — the trap kills whichever is still alive. No new package dependency.

## Isolation proof (V2c guarantee preserved)

- `WebPlaytestStateDTO.observation` is always `WebHumanDecisionProvider.current()?.observation` — literally the same object Forge already scoped to the human seat (V2c). It is never Asphodel's.
- `playtest-session-manager.test.ts`'s security test asserts, on a real (mocked-transport) playtest: Asphodel's player entry has `role: "opponent"` and **no `hand` field at all** (checked by direct property access), then serializes the *entire* `WebPlaytestStateDTO` with `JSON.stringify` and asserts Asphodel's hand-card name never appears anywhere in it, while the human's own hand-card name does.
- The `DecisionRecorder` behind the manager is the unmodified V2d recorder — it only ever records `owner === "agent"`, so `decisions.json`/`summary.md` keep V2d's own isolation guarantee unchanged.

## Reports

`POST /playtests/:sessionId/end` and a natural completion both call the exact same `writePlaytestReport` (V2d) the CLI uses — same `backend/playtest-reports/<dir>/{summary.md, decisions.json}` layout, same schema, same `.gitignore` entry. The end screen shows the same fields the CLI prints (`GAME OVER`/`PLAYTEST ENDED`, turn/decision counts, winner-or-"ended by human", never an invented winner) plus the report's file paths.

## Tests

- `backend/src/web-human-decision-provider.test.ts` (6): pending `choose()`, a valid submit resolves it, a stale `decisionId` is refused and resolves nothing, a double submit is refused, `requestEnd()` rejects an in-flight `choose()`, and `requestEnd()` before any decision makes the *next* `choose()` reject immediately.
- `backend/src/playtest-session-manager.test.ts` (4, mocked Forge transport, no JVM): full start → human decision exposed → submit → natural completion → report written; a voluntary end that cancels exactly once and preserves recorded decisions; a second concurrent start refused; and the security test described above.
- `frontend/src/playtest/card-search.test.ts` (8) and `frontend/src/playtest/board-renderer.test.ts` (6): pure-function tests only (`rankCardSearchResults`, `describeCard`, `formatPhase`) — no DOM test harness was introduced, per the deliberately minimal V2e test scope for the frontend. `frontend/package.json` gained one devDependency (`tsx`, already used by the backend) and a `test` script; no UI test framework was added.
- Existing V1–V2d backend/Forge suites: unchanged and green (see Validation below); `run-human-vs-asphodel.ts`'s CLI behavior was smoke-tested again in this milestone as part of confirming `deck-resolver.ts`'s extraction didn't regress it.

## Known limitations

- No WebSocket: the browser polls `GET /playtests/:sessionId` every ~300ms. Fine for a personal tool; a future milestone could push instead of poll.
- Single active playtest, no accounts, no persistence of past sessions beyond their already-written report files — by design (see brief: "outil personnel").
- `CardSearch` is a preview only; it is not yet reachable from the actual gameplay screen and has no effect on the game.
- The board is intentionally plain text/structure — no card images, no visual board, no drag-and-drop, no animation. That is this milestone's explicit scope, not an oversight.
- `combat_damage:assignCombatDamage` remains the one inherited, documented Forge-AI fallback (unchanged since V1l).
- The physical-library milestone is deliberately **not** started here: Forge does not yet externalize draw/mill/tutor/scry/surveil for a physical deck, and faking those in the UI would mean the interface silently lying about what actually happened in the game state. `CardSearch` exists now specifically so that whenever that externalization lands, the frontend does not need to change — only what feeds `getCandidates()` does.

## Validation

```sh
cd backend && npm run build && npm test
./scripts/forge-test.sh   # runs forge-build.sh first
cd ../frontend && npm run build && npm test
cd .. && git diff --check
git -C vendor/forge status --short   # empty
git -C vendor/forge rev-parse HEAD   # 6356c1ad565029c82513c96e42ad5492c1b09c4e
```
