# V2c — Human vs Asphodel

Base: V2b `9b74d0b77542f9e8aa186c58e07f4e339a3ce0a6`.
Forge remains exactly `6356c1ad565029c82513c96e42ad5492c1b09c4e` (`git -C vendor/forge status --short` empty). **Vendor Forge was not modified.**

This is the first Asphodel milestone where a real human can play a real Commander 1v1 game against the agent, with Forge as the sole rules authority for both seats.

## 0. Audit: was dual-external already supported?

**No — but everything except one hardcoded assumption already was.** Before writing any code, every layer between the wire protocol and the rules engine was read end to end:

| Layer | Finding |
| --- | --- |
| `AsphodelDecisionBroker` | Every request method already takes the actual `Player` and tags the resulting decision snapshot with `playerId(player)` — never a fixed seat index. It holds exactly one `pending` decision and throws `IllegalStateException` if a second request arrives while one is outstanding. |
| `AgentObservationBuilder.build(Game, Player observer)` | Already fully generic: "self" vs "opponent" role is `player.equals(observer)`, and identity visibility uses Forge's own `CardView.canBeShownTo(observer.getView())`. Whoever is passed as `observer` gets a correctly-scoped view; nothing here assumes "the external player is always player-1." |
| `PlayerControllerAsphodel` | Every call into the broker/observation builder uses `getPlayer()` — its own bound player from `PlayerControllerAi`'s constructor — never a global/static player reference. |
| `LobbyPlayerAsphodel` | Takes a broker instance in its constructor and binds a fresh `PlayerControllerAsphodel` to whichever `Player` Forge assigns it in `createIngamePlayer`. Nothing prevents constructing two of these against the same broker. |
| `ForgeGameRunner.runExternal` | Already accepts two arbitrary `LobbyPlayer` instances by position — no assumption that seat 2 is AI. |
| `ExternalMatchSession.runGame()` | **The one hardcoded assumption.** It always built `new LobbyPlayerAsphodel(...)` for seat 0 and `ForgeGameRunner.createAiLobbyPlayer(...)` for seat 1. This is the only place that made a second external seat impossible. |

**Conclusion:** decision ownership, observation scoping and hidden-info sanitization were already fully player-generic and already backed by Forge's own visibility rules — not something this milestone needed to invent. The single generalization needed was in `ExternalMatchSession`, which is exactly the "smallest safe generalization" the brief asked to find before writing anything. No Forge rules were reimplemented, and no vendor file was touched.

## 1–2. Controller model and wire changes

`forge-protocol.ts` adds `ForgeMatchSeatController = "external" | "forge_ai"` and an optional `seats?: [ForgeMatchSeatController, ForgeMatchSeatController]` on `start_external_match`. Omitting `seats` keeps the exact historical shape (`["external", "forge_ai"]`) — every V1/V2 call site is unchanged and untouched.

Java side: `BridgeMain.parseSeats` parses and validates the optional field (defaulting to `ExternalMatchManager.DEFAULT_SEATS`), `ExternalMatchManager.start` and `ExternalMatchSession` thread the two-element seat list through, and `ExternalMatchSession.createSeatPlayer` builds either a `LobbyPlayerAsphodel` (sharing the session's one broker) or a native `LobbyPlayerAi` per seat, in player order. Seat labels are generic (`"External Player 1/2"`) — an "external" seat may be Asphodel or a human, and nothing should call a human seat "Asphodel."

`agent-runner.ts` gains an exported `submitExternalChoice(client, sessionId, decision, choice)`, extracted verbatim from the switch that used to live inline in `runAgentMatch`'s loop. `runAgentMatch`'s behavior is byte-identical (same switch, same order) — it just calls the extracted function. This is the one piece of submission logic shared between V2a/V2b's agent runner and V2c's human-vs-agent orchestrator, so the selector-family routing exists in exactly one place.

## 2. Why one shared broker is safe with two external seats

Forge's game loop is single-threaded: only one controller method is ever executing at a time, on the one game-worker thread. `AsphodelDecisionBroker.ensureCanRequest()`/`requestPriorityDecision`'s pending-not-null check already throws if two requests ever overlapped — with two external seats sharing one broker, this same guard is what proves (not merely assumes) that no two decisions are ever pending at once. Each request/response is still tagged with the real owning `Player`, so there is no seat-routing ambiguity even though the broker itself has no per-seat map.

## 3. Observation security

`AgentObservationBuilder.build(game, observer)` is called with `getPlayer()` — the calling controller's own bound player — at every one of `PlayerControllerAsphodel`'s call sites. This was true before V2c and remains unchanged. What V2c adds is simply a second `PlayerControllerAsphodel` instance (for the human seat, using the identical class — a human's decisions arrive over the exact same protocol as Asphodel's) bound to its own `Player`. The result: whichever seat is currently being asked receives an observation built from its own vantage point, with the other seat's hidden zones sanitized by Forge's native, already-battle-tested `CardView` visibility — not a new/parallel visibility system.

**Proof, both directions**, in the real 100-card integration test (`backend/src/forge/human-vs-asphodel.integration.test.ts`):
- Every observation delivered to the human has `selfPlayerId === "player-1"`, its own player entry has `role: "self"` with a populated `hand`, and Asphodel's player entry has `role: "opponent"` with **no `hand` field at all** (not an empty array — the field is structurally absent, confirmed both via direct property access and via a serialized-JSON substring search for `"hand"` on Asphodel's player entry).
- Symmetrically, every observation delivered to Asphodel has `selfPlayerId === "player-2"`, its own hand populated, and the human's player entry carries no `hand` field.

Mocked-transport unit tests in `backend/src/human-vs-agent.test.ts` additionally exercise this at the DTO level directly (`"human observation ... includes the human hand and no Asphodel hand identity"` and its mirror).

## 4. HumanDecisionProvider architecture

```ts
interface HumanDecisionProvider {
  choose(observation: AgentObservation, decision: ForgePendingExternalDecision): Promise<AgentChoice>;
}
```

Three implementations, cleanly separated by responsibility:

- **`TerminalHumanDecisionProvider`** (`backend/src/human/terminal-human-decision-provider.ts`) — I/O only: owns a `node:readline/promises` interface, prints via `human-cli-render.ts`, reads a line, and either returns a choice or loops. It contains no rendering logic and no decision logic of its own.
- **`human-cli-render.ts`** — pure functions: `describeDecision` turns any pending decision into a `DecisionPrompt` (a numbered menu of already-complete, already-legal `AgentChoice` values, or a bounded numeric prompt for `value_selection`). `renderHeader`/`renderBoard`/`renderEventDelta`/`renderGameEnd`/`describeAgentAction` are all pure, technology-agnostic string builders over `AgentObservation`. A future frontend implementation of `HumanDecisionProvider` can reuse every one of these functions without touching readline, the orchestrator, or the bridge — this is exactly the separation the brief asked for.
- **`ScriptedHumanDecisionProvider`** (`backend/src/human/scripted-human-decision-provider.ts`) — a deterministic, always-legal stand-in for CI/tests. It is explicitly **not** the Asphodel policy: no scoring, no combat/target/mana heuristics — just "take the first forward-progress option the decision itself supplies, otherwise finish/decline." This is enough to reliably develop a board, cast spells and enter combat in a real game without duplicating V2b's agent logic, and every choice it builds comes strictly from the decision's own options.

No readline logic exists in any bridge/session class — Java is untouched by this concern, and the TS orchestrator (`human-vs-agent-runner.ts`) never touches stdin/stdout either.

## 5. Choice validation

Every choice — human or Asphodel — passes through the exact same `validateChoice(decision, choice)` used since V1l/V2a before submission. `describeDecision`/`ScriptedHumanDecisionProvider` only ever construct a `MenuItem`/`AgentChoice` whose `choice` value is one of the decision's own supplied ids (`actionId`/`targetId`/`modeId`/`objectId`/`manaOptionId`/`costId`) or, for `value_selection`, an integer the terminal provider itself bounds to `[minValue, maxValue]` before ever constructing the choice. There is no code path that lets the CLI construct an arbitrary target, card, mana option or attacker.

Invalid terminal input (non-number, out-of-range, empty, or garbage text) is caught in `chooseMenu`/`chooseValue`'s own retry loop — display an error, ask again — **before** any `AgentChoice` is constructed, so nothing invalid ever reaches `runHumanVsAgentMatch`, let alone Forge. This is proven directly in `human-vs-agent.test.ts`'s `TerminalHumanDecisionProvider` test, which feeds `"not-a-number"`, an empty line and an out-of-range index before a valid one, and asserts the final returned choice is still exactly the first legal menu item, with an "Invalid choice" message printed for each rejected attempt.

`quit` throws a local `HumanQuitError`, which propagates through the same generic cancel-and-rethrow path as any other error in `runHumanVsAgentMatch` — the session is cancelled and the bridge is stopped in the CLI's `finally` block either way. Ctrl+C (SIGINT) and SIGTERM are wired to the same `AbortController` used everywhere else in this codebase's CLIs (`run-evaluation.ts`, `run-baseline.ts`): the signal aborts both the orchestrator's loop and any in-flight `readline` `question()` (via Node's native `question(query, { signal })`), which cancels the match and stops the bridge in `finally`. Verified live: a real CLI run answering one decision (`"1"`) and then typing `"quit"` printed a clean `Session ended.` and exited without a stack trace, with the bridge process terminated.

## 6. Game routing (`human-vs-agent-runner.ts`)

`runHumanVsAgentMatch(client, human, agent, decks, humanPlayerId, agentPlayerId, options)` starts the match with `seats: ["external", "external"]`, then loops: poll → if the pending decision's `playerId` equals `humanPlayerId`, await `human.choose(...)`; if it equals `agentPlayerId`, call `agent.choose(...)`; **any other `playerId` throws `human_vs_agent_unknown_decision_owner` immediately** — there is no silent default. The same `seen` decisionId set used by V2a/V2b's `runAgentMatch` prevents re-processing a decision the loop has already answered if a stale/duplicate poll returns it again. Submission always goes through the shared `submitExternalChoice`.

Since deck order and seat order are passed together (`decks[0]`/seat 0 = human, `decks[1]`/seat 1 = Asphodel), the human/Asphodel `playerId` mapping (`"player-1"`/`"player-2"`) is known by construction — the orchestrator never needs to discover it dynamically or guess from early traffic.

## 7. CLI

```sh
cd backend
npm run game:human-vs-asphodel
# optional: load two Deck Library decks instead of the default fixtures
npm run game:human-vs-asphodel -- --human-deck 12 --ai-deck 4
```

With no flags, both decks are the same `forge/testing/commander-fixtures.ts` fixtures V2a/V2b already validate against (human: **Krenko, Tin Street Kingpin**; Asphodel: **Ghalta, Primal Hunger**) — no new deck risk on a first game. `--human-deck`/`--ai-deck` load real `DeckService` entries from the local sqlite Deck Library (`DeckService.getDeck(id)` → `ForgeDeckAdapter.toForgeDeckSpec`); this needed no new plumbing since `createDatabase()`/`ScryfallCardProvider`/`DeckService` are already three lightweight, side-effect-free constructor calls with no server, network or extra setup — `buildApp()`'s own wiring was reused. Archidekt sync was not touched.

## 8. Decision rendering

Every currently externalized decision family renders as a numbered menu built from the decision's own fields — nothing hardcodes a card name:

- `priority_action`: verb + card name + mana cost (`"Cast Krenko, Tin Street Kingpin [2 R]"`), Pass always listed as option 1 (Forge's own broker always puts it first) and clearly labeled.
- `target_selection` / `mode_selection` / `optional_cost_selection` / `cost_object_selection`: option label (card name via a same-observation card lookup, or the DTO's own inline label/description), plus a Finish/Decline item when the decision allows it.
- `mana_payment`: floating mana vs. named source + what it produces.
- `attackers_selection` / `blockers_selection`: `"Add <attacker> attacking <defender>"` / `"Add <blocker> blocking <attacker>"`, resolving `cardRef`/`relatedRef` against a per-observation card/player lookup (combat options carry only refs, not inline names).
- `combat_order_selection`, `yes_no`, `object_selection`, `ordering_selection`: card/label per option, Finish where offered.
- `value_selection`: rendered as a bounded numeric prompt (`min`–`max` shown), not a menu.

Card display (`describeCard`) shows name, P/T, tapped/summoning-sick/counters and is a plain "hidden card"/"face-down card" placeholder whenever the DTO itself reports `hidden`/no name — it never guesses an identity Forge did not reveal. A compact event delta (life/battlefield-size/hand-size/stack-length changes since the player's own last decision) prints before each new decision, derived only from consecutive `AgentObservation`s — no parallel rules log.

## 9. Asphodel side

Asphodel uses `BaselineAsphodelAgentV2b` from V2b, unmodified (its file is not touched by this commit). When a decision's `playerId` is Asphodel's, the orchestrator calls `agent.choose(observation, decision)` exactly as `runAgentMatch` already does, validates and submits through the same `submitExternalChoice`. `describeAgentAction` prints a short public line ("Asphodel plays Mountain", "Asphodel casts...", "Asphodel attacks with...") from the *decision and choice* only — never Asphodel's hand or its internal `reason` string — matching the brief's "no private hand or internal reason unless debug mode."

## 10. Test coverage

- **`backend/src/human-vs-agent.test.ts`** (mocked transport, no JVM): routing to the human exactly once and to Asphodel exactly once; hard failure on an unrecognized `playerId` (with the broker's `cancel` still invoked); a stale re-poll of the same `decisionId` not re-invoking either chooser; cancellation on a mid-flight abort invoking `client.cancel`; human/Asphodel observation hand-isolation in both directions at the DTO level; `TerminalHumanDecisionProvider`'s local-retry behavior on invalid input.
- **`backend/src/forge/human-vs-asphodel.integration.test.ts`** (real Forge, skipped without `FORGE_BRIDGE_JAR`): a `ScriptedHumanDecisionProvider` vs `BaselineAsphodelAgentV2b`, both `external`, real 100-card decks, seed 7. Asserts a natural terminal result, decisions delivered to both seats, at least one spell cast (from real per-player public telemetry), at least one `attackers_selection` decision, **zero unexpected strategic fallback** (only the pre-existing, documented `combat_damage:assignCombatDamage` is tolerated), and full two-directional observation isolation (structural hand-field absence, checked both by property access and by a serialized-JSON substring search) across every decision either seat received during the game.

## 11. Manual smoke test (section 28)

The CLI was actually launched against the real built bridge, three times, with scripted stdin at different paces:

1. Default fixtures, no input yet: confirmed the renderer reaches a real human decision and displays a usable, non-JSON board (turn/phase/priority/life, numbered hand, both battlefields, stack, a clearly-numbered "Pass priority" option).
2. Naturally-paced input (`h`, wait, `board`, wait, `quit`, each on its own tick): `h` printed the help text, `board` re-rendered the current decision, `quit` printed a clean `Session ended.` with no stack trace and a cleanly stopped bridge process.
3. A real move: submitting `1` (Pass priority) visibly advanced the game from Turn 1 Untap to Turn 1 Upkeep with a freshly rendered decision, then `quit` ended the session cleanly.

**Known, honestly-reported limitation:** this environment has no real interactive TTY, so the smoke test drives stdin through a pipe. When three commands were written to that pipe **in a single instantaneous burst** (before the process had even printed its first prompt), the third command was silently dropped by Node's `readline` line-buffering — a batching artifact of piped, non-interactive input arriving faster than the process can attach its per-prompt listener. With realistic per-line pacing (matching how a human actually types, one line then Enter), all commands were processed correctly every time, including `quit`. This is exactly the situation the brief anticipated ("if CI/non-interactive environment prevents real stdin: test renderer + scripted provider and document that limitation honestly") — the renderer and interactive command handling are confirmed working; the deterministic, CI-safe verification path is `ScriptedHumanDecisionProvider` plus the real Forge integration test above, not a piped keystroke burst.

## 12. Fallback visibility

`renderGameEnd` reports `combat_damage:assignCombatDamage` explicitly by count under "Engine delegated decisions" — the same pre-existing, documented gap from [V1l](external-controller-readiness-v1l.md)/V2a/V2b, unchanged in scope. Any other fallback family would print under "other (unexpected)"; none occurred in the integration test's real game.

## 13. Known limitations

- No frontend — this is a terminal-only milestone, exactly as scoped.
- The scripted/default human uses simple "first legal, always advance" logic for CI; it is not meant to represent skilled human play, only to drive a real game to completion deterministically.
- `combat_damage:assignCombatDamage` remains an inherited Forge-AI fallback (unchanged scope from V1l); eliminating it was out of scope here as it was for V2b.
- Opponent display name for the Asphodel seat is the generic Forge lobby-player label ("External Player 2"), not a branded "Asphodel" string — cosmetic only, does not affect legality, isolation or routing.
- The piped-stdin batching limitation described in §11 only affects non-interactive scripted bursts, never a real human typing at a keyboard.
- Deck Library loading (`--human-deck`/`--ai-deck`) requires the local sqlite database migrations to have been applied (`npm run db:migrate`); the default fixture path needs no database at all.

## 14. Next milestone (V2d)

V2c proves the dual-external contract, the routing, and the observation isolation with a real game. The natural next step is a browser-based frontend implementation of `HumanDecisionProvider` reusing `human-cli-render.ts`'s pure describe/render functions (swapping the terminal I/O for HTTP/WebSocket + a UI), not a new decision or observation contract. No ML/RL/MCTS/self-play/training is proposed for V2d either.

## Validation

```sh
./scripts/forge-build.sh
./scripts/forge-test.sh
cd backend
npm test
npm run build
npm run test:forge-bridge
cd ../frontend
npm run build
cd ..
git diff --check
git -C vendor/forge status --short   # empty
git -C vendor/forge rev-parse HEAD   # 6356c1ad565029c82513c96e42ad5492c1b09c4e
```
