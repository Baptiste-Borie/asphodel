# V2d — Playtest Tooling

Base: V2c `9924eb84c0172ab27a592c3f1d28c3efda41d160`.
Forge remains exactly `6356c1ad565029c82513c96e42ad5492c1b09c4e` (`git -C vendor/forge status --short` empty). **Vendor Forge was not touched, and `BaselineAsphodelAgentV2b`/its scoring policy were not touched.**

V2d does not change how Asphodel plays. It changes how easy a real human-vs-Asphodel playtest is to **start** (a public Archidekt deck instead of only local Deck Library ids), to **stop** on purpose (`end`, not a crash), and to **analyze afterward** (a full, machine-readable record of every Asphodel decision).

## Architecture

```
Archidekt URL ──▶ ArchidektDeckSource ──▶ ForgeDeckSpec ──▶ Forge
                                                              │
Deck Library id ──▶ DeckService + ForgeDeckAdapter ──▶ ForgeDeckSpec
                                                              │
                                                              ▼
                                     runHumanVsAgentMatch (V2c, +endedByHuman)
                                          │ onDecision(owner, obs, decision, choice)
                                          ▼
                                    DecisionRecorder (owner === "agent" only)
                                          │ .all() → RecordedDecision[]
                                          ▼
                                    playtest-report.ts
                                          │ reuses describeDecision (human-cli-render.ts)
                                          ▼
                          backend/playtest-reports/<dir>/{summary.md, decisions.json}
```

Archidekt is a dependency of `backend/src/decks/archidekt-deck-source.ts` only. It never becomes a dependency of Forge, the bridge, or the game engine — its only output is a plain `ForgeDeckSpec`, exactly the same shape the local Deck Library path already produces.

## 1. Archidekt import

```sh
npm run game:human-vs-asphodel -- --human-deck "https://archidekt.com/decks/123456/mon-deck"
npm run game:human-vs-asphodel -- --human-deck "https://archidekt.com/decks/123456/mon-deck" --ai-deck 4
npm run game:human-vs-asphodel -- --human-deck 12 --ai-deck 4   # unchanged local-id behavior
npm run game:human-vs-asphodel                                  # unchanged: both fixtures
```

`--human-deck`/`--ai-deck` each independently accept a positive integer Deck Library id **or** an `archidekt.com` deck URL (`isArchidektDeckUrl` in `archidekt-deck-source.ts` decides which). Omitting one flag no longer requires the other — each unspecified seat keeps its existing fixture deck (V2a/V2b's Krenko/Ghalta). This is a strict widening of `run-human-vs-asphodel.ts`'s existing `resolveDeckArg`; no existing call shape stopped working.

**Security**: the user's string is never fetched directly. `extractArchidektDeckId` parses it as a URL, rejects anything whose host isn't exactly `archidekt.com`/`www.archidekt.com`, extracts only the numeric id from `/decks/<id>`, and `ArchidektDeckSource` always calls the fixed host `https://archidekt.com/api/decks/<id>/` — never the user-supplied path/slug. No authentication is implemented: a private deck (API responds 401/403) fails with a clear `PRIVATE_DECK` error, never a silent retry or a credential prompt. This is one-directional (`Archidekt -> Asphodel`, at match start only) — no writes, no sync, no Archidekt account interaction of any kind.

**Parsing** (`parseArchidektDeck`, pure — no network): reads a card's name from `card.oracleCard.name` / `card.oracle_card.name` / `card.displayName` / `card.name` (first present), quantity from `quantity` (falls back to 1 if missing/invalid), and its category from either an array field `categories: string[]` or a scalar `category: string`. A card is `commander` iff one of its categories is exactly `"Commander"`; everything else included becomes `mainboard`. `Sideboard` and `Maybeboard` are always excluded, and any category the payload itself marks `includedInDeck: false` is excluded too. Duplicate name+section entries are merged (quantities summed). Before returning a `ForgeDeckSpec`, it validates **exactly 100 total cards** and **1 or 2 commander cards** (deliberately more permissive than the local `ForgeDeckAdapter`, which still caps at exactly one — partner commanders are a real, Forge-native Commander configuration and Archidekt decks may legitimately use them); anything else raises a specific, readable `ArchidektDeckSourceError` (`INVALID_URL`, `INVALID_HOST`, `PRIVATE_DECK`, `FETCH_FAILED`, `INVALID_PAYLOAD`, `INVALID_DECK_SIZE`, `INVALID_COMMANDER_COUNT`). No Commander legality beyond size/commander-count is reimplemented — Forge remains the rules authority for everything else, exactly as for local decks.

At launch the CLI always prints, regardless of source:

```
Human deck: Uurg, Spawn of Turg — 100 cards
Asphodel deck: Krenko, Tin Street Kingpin — 100 cards
```

## 2. Ending a playtest on purpose

`end` (alias `quit`) is now a first-class, non-error outcome, not an exceptional "session failed" path:

- `HumanEndMatchError` is defined in `human-decision-provider.ts` (not in the terminal implementation), so any current or future `HumanDecisionProvider` can raise the same signal.
- `TerminalHumanDecisionProvider` throws it for `end`/`quit` **before constructing any choice** — nothing invalid, and nothing at all, is ever submitted to Forge for that prompt.
- `runHumanVsAgentMatch` now distinguishes three outcomes explicitly: **completed naturally** (`endedByHuman: false`, a real Forge terminal result), **ended by human** (`endedByHuman: true`, caught specifically — not folded into the generic error path), and **actual failure** (still throws `AgentRunError`, unchanged). On a human end it cancels the Forge session (best-effort — a secondary cancellation problem cannot turn a deliberate end into a reported error), keeps the **last polled snapshot** (so turn/telemetry/fallback data survives), and keeps the full `trace` — every Asphodel decision the CLI already recorded via `onDecision` up to that point is untouched, since recording happens synchronously inside the same loop iteration that decision was answered in, strictly before the human could ever be asked (and possibly end) on a later one.
- Ctrl+C remains a separate, simpler "emergency abort" via the existing `AbortController`/`AgentRunError` path — unchanged from V2c.

Help text now reads: `end / quit — end the playtest and generate a report`.

## 3. Decision recorder

`DecisionRecorder` (`backend/src/human/decision-recorder.ts`) is driven from the exact `onDecision(owner, observation, decision, choice)` hook V2c already exposed — no second game state, no re-derivation from telemetry. It only ever records `owner === "agent"`. Each record is `{ reportId: "A0001", "A0002", ...; timestamp; observation; decision; choice }`, `structuredClone`d at record time so nothing later in the loop can mutate a stored copy. `reportId` is the human-referenceable id ("look at A0042") the brief asked for; the original Forge `decisionId` is preserved unchanged inside `decision.decisionId`.

**Isolation**: the recorder stores exactly the `AgentObservation` Forge already scoped to Asphodel — the same object `agent.choose()` itself received. It is never merged with, or enriched by, anything from the human seat. `playtest-report.test.ts` proves this with a direct round-trip equality between what was recorded and what `decisions.json` contains, plus an explicit check that the human player's entry in that observation carries no `hand` field — the same structural-absence guarantee V2c's own isolation tests already established, now proven to survive the recording/report pipeline too.

## 4–7. Reports

Every playtest — natural completion or `end`/`quit` — writes exactly one report directory under `backend/playtest-reports/` (added to `.gitignore`; nothing under it is ever committed):

```
backend/playtest-reports/2026-09-05_22-30_uurg-spawn-of-turg-vs-krenko-tin-street-kingpin/
  summary.md
  decisions.json
```

`reportDirectoryName` builds this from the playtest's start time (`YYYY-MM-DD_HH-MM`, sortable) and both deck names slugified to `[a-z0-9-]` (filesystem-safe, deck-identifiable).

**`summary.md`** — meant to be pasted straight into a chat: generation time, session id, seed, both deck names, `Status` (`completed` or `ended_by_human`), turn reached, total Asphodel decisions, a `Match summary` with each side's attacks/damage/spells (from Forge's real per-player public telemetry), a `Result` section that shows winner/turns/terminal reason **only** for a natural completion and otherwise the literal line `Result: playtest ended by human` (never an invented winner), an `Engine delegated decisions` count for the documented `combat_damage:assignCombatDamage` fallback (and any unexpected one, clearly marked), and a `Decision timeline` with one `### A000N — Turn T / Phase` entry per recorded decision: its Forge decision type and id, the chosen option's label, `choice.reason` (always present), and its full legal-options list (capped at 15 lines in Markdown, with a pointer to `decisions.json` for the rest — the JSON always keeps every option via the raw decision DTO).

The timeline reuses `describeDecision` from `human-cli-render.ts` directly — there is no second decision-rendering system. `describeRecordedDecision` (`playtest-report.ts`) just asks it for the same menu a human would have seen and looks up which item matches the recorded choice.

**`decisions.json`** — machine-readable, matching the brief's schema exactly:

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-09-05T22:30:00.000Z",
  "match": { "sessionId": "match-1", "seed": 42, "status": "ended_by_human", "humanDeck": "...", "asphodelDeck": "..." },
  "decisions": [ { "reportId": "A0001", "timestamp": "...", "observation": { /* raw AgentObservation */ }, "decision": { /* raw ForgePendingExternalDecision */ }, "choice": { /* raw AgentChoice */ } } ]
}
```

Every DTO is the raw object, not a lossy text summary — this is the corpus a future comparison/regression pass or a from-scratch V2e analysis tool reads back.

## 8. CLI output

Natural end:

```
GAME OVER
Winner: ...
...
Playtest report written:
  .../summary.md
  .../decisions.json
```

`end`/`quit`:

```
PLAYTEST ENDED

Turn reached: 7
Asphodel decisions recorded: 142

Playtest report written:
  .../summary.md
  .../decisions.json
```

Neither is printed through the error path; only a genuine failure (timeout, transport error, Forge crash) still prints `Human vs Asphodel session failed:` and sets a non-zero exit code.

## 9. Tests

- `backend/src/archidekt-deck-source.test.ts` (13 tests): commander/mainboard/Sideboard/Maybeboard/`includedInDeck:false` handling, duplicate merging, the scalar-`category` and all four name-field fallbacks, 1- and 2-commander (partner) support, and every error case (deck size ≠ 100, no commander, >2 commanders, malformed payload, unresolvable card name, invalid URL, wrong host, private deck via a mocked 403, a generic fetch failure) — all against local fixture payloads and an injected fetcher, no real network.
- `backend/src/human-vs-agent.test.ts` (+3 tests): a human-requested end returns `endedByHuman: true` (not `AgentRunError`) with `client.cancel` called exactly once, the last snapshot preserved, and every already-`onDecision`-recorded Asphodel decision intact; the ending prompt itself is never submitted to Forge; and `TerminalHumanDecisionProvider` throws `HumanEndMatchError` for `"end"` before returning any choice.
- `backend/src/playtest-report.test.ts` (3 tests): generates into a real temporary directory and reads the files back — `A0001..A000N` ids, `choice.reason` present on every decision, the raw `observation`/`decision` DTOs present and round-trip-equal to what was recorded, the human seat's `hand` field structurally absent from the recorded observation, a natural-completion report showing winner/turns/terminal reason, an ended-by-human report never inventing a winner, and directory-name format (sortable/filesystem-safe/deck-identifying).
- `backend/src/forge/human-vs-asphodel.integration.test.ts` (unchanged from V2c, still exercised by `forge-test.sh`): proves the underlying dual-external match itself is unaffected.

## 10. Non-regressions

`BaselineAsphodelAgentV2b`, its scoring/policy, `vendor/forge`, and Forge's own decision behavior are all untouched — confirmed by `git -C vendor/forge status --short` (empty) and by the unchanged V2b freeze-hash test still passing. No frontend, no Archidekt authentication, no bidirectional Archidekt sync, no write to Archidekt, and no AI/ML improvement were added — this milestone is tooling only.

## Known limitations

- Archidekt's real response schema was not directly observed from a live API call in this environment; the parser targets the field shapes and behavior literally specified in the brief (`oracleCard`/`oracle_card`/`displayName`/`name`, `categories`/`category`, `includedInDeck`) and is unit-tested exhaustively against that shape. If Archidekt's real public API differs in some untested corner, `parseArchidektDeck`'s explicit `INVALID_PAYLOAD` error will surface clearly rather than silently importing a wrong deck — but a live-network smoke test against a real public Archidekt URL was not run in this sandboxed environment (no outbound network access), consistent with "ne pas dépendre du réseau Archidekt dans la suite de tests automatisés."
- Two-commander (partner) Archidekt decks are accepted at the import/validation layer; whether Forge itself fully supports every partner-commander interaction is unchanged and untouched by this milestone (Forge remains the authority, as always).
- `combat_damage:assignCombatDamage` remains the one inherited, documented Forge-AI fallback (unchanged scope since V1l).
- Report generation only runs on the two paths the brief specifies (natural completion, `end`/`quit`); a genuine crash/timeout still only prints the existing error message, with no partial report — this was a deliberate scope decision, not an oversight.

## Manual smoke test

Run for real against the built bridge (scripted stdin, since this environment has no interactive TTY — see V2c's doc for that same honestly-reported limitation):

```sh
cd backend
npm run game:human-vs-asphodel
# … answer one decision, then:
end
```

Both `playtest-reports/.../summary.md` and `decisions.json` were confirmed to appear and be readable (see the session's own tool output for the actual run and file contents). A real Archidekt URL was not reachable from this sandboxed environment; the Archidekt path is instead proven end-to-end against local fixtures (`archidekt-deck-source.test.ts`) plus a `--human-deck https://archidekt.com/...` argument-parsing path exercised by the same code the fixtures test.
