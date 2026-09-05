# V2e.2 — Fullscreen Tabletop, Safe Auto-Pass, Printing-Aware Deck Import

Base: latest hotfix after V2e.1, `d36e1bb`.
Forge remains exactly `6356c1ad565029c82513c96e42ad5492c1b09c4e` (`git -C vendor/forge status --short` empty). **`BaselineAsphodelAgentV2b`, Forge rules, decision isolation, and the Forge protocol DTOs are unmodified.**

Three independent pieces: (A) the game screen is rebuilt as a fullscreen tabletop instead of a dashboard, (B) the orchestrator safely auto-submits a priority decision only when pass is the *sole* legal option, (C) deck import understands `(SET) collector-number` printing syntax and actually resolves it against a real printing index instead of silently discarding it.

## A. Fullscreen tabletop

### Chrome hiding

`playtest-view.ts` toggles `document.body.classList` with `"tabletop-active"` on entering/leaving a live game (`showGameScreen()` adds it, `showSetup()`/`showEndScreen()` remove it). All hiding is pure CSS (`styles/tabletop.css`): `body.tabletop-active .app-header { display: none }`, main/content-area padding and max-width stripped, `#play-view` pinned to `100vh`. No view-routing framework was introduced — same DOM-swap pattern the app already used, just a class flag driving different rules.

### Layout

```
┌───────────────────────────────────────────────────────────────────┬──┐
│ ASPHODEL/40                                                      ⋯│○│ ← menu button
│                    ┌──[cmd]─[permanents]─[lands, tapped @45°]──┐   │  │
│  T5 Asphodel       │            ASPHODEL half (top)            │   │  │
│  plays Mountain     └────────────────────────────────────────────┘   │  │
│  T5 Asphodel                 · · · table centerline · · ·            │  │
│  casts Krenko       ┌────────────────────────────────────────────┐   │  │
│  (fainter)          │             YOUR half (bottom)             │   │  │
│                    └──[permanents]─[lands, tapped @45°]───────────┘   │  │
│ YOU/36                                                              │  │
├───────────────────────────────────────────────────────────────────┤  │
│              [ Cast Zuran Orb ] [ Play Forest ] [ Pass → ]           │  │
│  [card][card][card][card][card][card]  ← hand, fanned/overlapped    │  │
└───────────────────────────────────────────────────────────────────┴──┘
```

- `.table-battlefield` is one flex column split into `.table-battlefield-half--asphodel` (top, `align-content: flex-end` so cards hug the centerline) and `--human` (bottom, `align-content: flex-start`, same reasoning) — the two halves visually face each other across a faint centerline (`::after`), exactly as specified, with no separate panel components.
- `.table-rail-left` is `position: absolute; pointer-events: none` over the battlefield — not a layout column. It holds three pieces spaced with `justify-content: space-between`: `ASPHODEL / 40` pinned to the top (aligned with Asphodel's half), the recent-actions timeline in the middle, `YOU / 36` pinned to the bottom (aligned with the human's half). Life totals are therefore spatially locked to the half they describe.
- The right side is empty by default. `.table-menu-button` is the only permanent right-side element: a 44px circle, upper right, expanding into `.table-menu-panel` (deck names + End Playtest) on click, closing on an outside click. The card preview (`.table-preview`) only occupies the right side while a card is pinned — it is `hidden` (not just visually empty) the rest of the time, so there is never a permanent empty inspector panel.
- `.table-decision-dock` sits immediately above the hand, lower-center — reuses the existing `decision-*` CSS classes from `playtest.css` (same buttons/behaviour as V2e.1), just mounted in a different container.

### Cards, tapped, and battlefield inspection

`card-view.ts` was rewritten around one function, `createTableCard(card, presentation, options)`, producing a `.table-card` with a real `<img>` face (Scryfall `imageUri`, `object-fit: cover`, correct 5:7 aspect ratio) or a text placeholder when no image is resolved yet. Tapped is `transform: rotate(45deg)` on the whole card (`.table-card--tapped`) — never a `[T]` badge as the primary signal; the element's accessible name/title still says "Tapped" for anyone not relying on the rotation. Battlefield halves reserve generous `gap`/padding so a rotated card never visually collides with its neighbours.

Clicking a battlefield or command-zone card calls `onCardActivate`, which routes into `card-preview.ts`'s `togglePin`: first click pins the large preview on the right and subtly outlines the card (`.table-card--selected`); clicking the *same* card again, clicking a different card (replaces), the preview's own close button, or Escape all close/replace it correctly — there is never a stuck or empty preview.

### Hand

`renderHand()` (`board-renderer.ts`) renders the human's hand as real full-size cards (`.table-card--hand`) along the bottom edge, overlapping via a negative `margin-left` (fanned, not rotated). All hover behaviour (`translateY(-42px) scale(1.16)`, `z-index: 20`) is **pure CSS** (`:hover` + a 140ms transition already on `.table-card`) — no JS hover state, so it is inherently smooth, fast, and always resets cleanly on mouse-leave with no possible desync. Hand cards are built with no `onActivate` handler at all, so clicking one is structurally incapable of pinning it into the right-hand preview — the only way to read a hand card is the hover, exactly as specified. The game's actual choice controls (casting a spell, playing a land, etc.) remain in the decision dock, unrelated to hovering.

### Recent actions / stack

The left rail's middle section (`renderActions()` in `playtest-view.ts`) shows the most recent entries from the existing event log (`MAX_VISIBLE_ACTIONS = 6`), newest first, with the oldest `RECENT_ACTION_COUNT` of those visually faded (`.table-action-item--faded`) — a compact Hearthstone-style timeline, not a boxed log panel. No permanent "Stack" panel exists; stack contents (when non-empty) are surfaced through the decision dock's existing context line (`Stack: …`, unchanged from V2e.1's `decision-context`), so stack data is still fully present in the protocol and still shown contextually, just never as its own standing panel.

## B. Safe priority auto-pass

`backend/src/human/priority-auto-pass.ts`:

```ts
export function autoPassChoice(decision: Decision): AgentChoice | null {
  if (decision.type !== "priority_action") return null;
  if (decision.actions.length !== 1) return null;
  const [only] = decision.actions;
  if (only!.type !== "pass") return null;
  return { decisionId: decision.decisionId, kind: "action", choice: only!.actionId, reason: "auto_pass_no_other_legal_action" };
}
```

Pure function, no I/O. It only fires for `priority_action` decisions whose Forge-provided legal-actions list contains *exactly one* entry and that entry *is* the pass action — i.e. the human has no other legal action at all, not "Forge would recommend pass" or "the only useful action is pass." Any second legal action (even a trivial one) makes it return `null` and the human is asked as normal. There is no heuristic judgement of *usefulness* anywhere in this function — that was an explicit constraint.

Wired into the orchestrator, not either `HumanDecisionProvider`:

```ts
// human-vs-agent-runner.ts
const forcedPass = owner === "human" ? autoPassChoice(d) : null;
const choice = forcedPass ?? (owner === "human" ? await human.choose(observation, d) : agent.choose(observation, d));
```

This makes the behaviour identical for the CLI (`TerminalHumanDecisionProvider`) and the web UI (`WebHumanDecisionProvider`) with no duplicated logic in either, and it is unambiguously backend-side — the frontend never sees, let alone simulates, the click. Only `priority_action` is ever touched; every other decision family (attackers, blockers, targets, choose-mode, X-value, mulligan, …) is completely untouched and always still stops for the human.

Regression note: wiring this in initially broke 3 pre-existing tests because the shared `priorityDecision()` fixtures in `human-vs-agent.test.ts` and `playtest-session-manager.test.ts` had been built with pass as the *only* action — exactly the shape auto-pass now intercepts — so tests asserting the human provider gets called (including the "human requests end mid-decision" tests) were silently short-circuited into an infinite auto-pass loop instead. Fixed by giving both fixtures a second real action (`cast-1` / `cast_spell`) so they genuinely exercise human routing; confirmed `web-human-decision-provider.test.ts`'s own separate fixture was unaffected (that suite calls the provider directly, never through the orchestrator, so auto-pass never applies there).

## C. Printing-aware deck import

### Parser

`deck-parser.ts`'s card-line pattern changed from requiring `NxCARD` to `/^(\d+)\s*x?\s+(.+)$/i` — the `x` is now optional and whitespace around it is tolerant, so `1 Sol Ring`, `1x Sol Ring`, and `1 x Sol Ring` all parse identically; the pre-existing `1x Sol Ring` form is unchanged. A second pattern, `/^(.+)\(([A-Za-z0-9]+)\)\s*(\S+)$/`, strips an optional trailing `(SET) collector` suffix off the card name once quantity has already been extracted:

```
1x Uurg, Spawn of Turg (DMU) 225   → { quantity: 1, name: "Uurg, Spawn of Turg", setCode: "dmu", collectorNumber: "225" }
1 Uurg, Spawn of Turg (DMU) 225    → same (x-optional form)
1 Uurg, Spawn of Turg              → { quantity: 1, name: "Uurg, Spawn of Turg" }  (unchanged, no printing)
```

Set codes are lower-cased on extraction (Scryfall's own convention); collector numbers are captured as `\S+` and kept as a plain `string` field end-to-end — never coerced through `Number(...)` anywhere in the pipeline — so `"225"`, `"123a"`, and `"★12"` all survive intact. A malformed/ambiguous suffix (e.g. empty name before the parenthesis) is simply not matched, and the line falls back to the plain name — no exception, no dropped card. Commander/Mainboard section headers are untouched. 7 new tests cover: x-optional, printing suffix with/without `x`, comma- and apostrophe-containing names, alphanumeric and starred collector numbers, set-code case normalization, malformed-suffix fallback, and extra whitespace tolerance.

### Why a second bulk source was necessary

`ScryfallCardProvider` (since V2a) is built entirely around Scryfall's **`oracle_cards`** bulk export, which contains exactly one Scryfall-chosen "representative" printing per oracle card — it has no reliable way to answer "give me the exact `DMU`/`225` printing," because that specific printing may not even be the one `oracle_cards` happened to pick. Rather than fake printing support on top of an index that structurally cannot provide it, a second, independent index was added using Scryfall's **`default_cards`** bulk export (every real printing, each with its own `set`/`collector_number`).

`ensureBulkFile`/`downloadBulkFile` were generalized to take a `(path, bulkType)` pair instead of being hardcoded to one file, so both bulk types share identical download/cache/gzip-parse machinery. The printing index (`loadPrintingIndex()` → `printingIndexPromise`, a lazily-memoized `Promise<Map<string, ResolvedCard>>` keyed by `` `${setCode.toLowerCase()}/${collectorNumber.trim()}` ``) is only ever triggered by the first call to the new `CardProvider.findBySetAndCollector(setCode, collectorNumber)` method — a plain-name deck import never downloads, parses, or holds the `default_cards` file in memory at all. This was proven with a dedicated test asserting the printing index is never loaded for name-only lookups.

Resolution order in `deck-service.ts#createDeck()`, per card:

1. If the parsed line carried a `{setCode, collectorNumber}`, try `findBySetAndCollector` — exact printing.
2. If that printing wasn't provided or wasn't found, fall back to `findByExactName` on the normalized name (the pre-existing V2a behaviour, completely unchanged for plain-name lines).
3. If neither resolves, the existing `CardsNotFoundError` import-failure path fires exactly as before.

No per-card network requests are introduced anywhere — both bulk files are downloaded once (cached to disk, `SCRYFALL_BULK_PATH`/`SCRYFALL_PRINTING_BULK_PATH`) and held as in-memory maps for the life of the process, same offline/cache-friendly shape as the existing name index.

### Tests

- `scryfall-provider.test.ts`: exact printing hit from a separate local `default_cards` fixture, case-insensitive set code, unfound printing → `null` (not a thrown error), and the laziness proof (printing index never loaded for a name-only call).
- `deck-service.test.ts` (new): exact-printing success, case-insensitive set code, unchanged name-only fallback for plain lines, printing-not-found-but-name-resolves fallback, and a genuinely-unresolvable card (neither printing nor name found) still produces `CardsNotFoundError`.
- `card-provider.ts`'s `CardProvider` interface gained `findBySetAndCollector`; all existing fakes/stubs (`FakeCardProvider`, the two local `FlakyProvider` test doubles) were updated to implement it.

## D. Explicitly preserved

Asphodel policy, Forge rules, decision isolation (`observation` still `null` off-turn), report generation, the Archidekt import path, and the (not-yet-built) physical library are all untouched. Asphodel's hidden hand is never exposed — `collectVisibleCardNames`/battlefield rendering only ever reads `player.hand` for `role: "self"`, same guard as V2e.1. The no-flicker polling architecture (`lastObservationKey`/`lastEventsKey`/`lastDecisionKey`/`lastPresentationVersion` change-detection, persistent last-good-observation retained locally while Asphodel is thinking) is carried over unchanged into the new tabletop containers — the battlefield/rail/hand DOM nodes are built once per game and only their contents are refreshed when the underlying JSON actually changed.

## E. Validation

```sh
cd backend && npm run build && npm test      # tsc clean; 137/137 pass
./scripts/forge-test.sh                       # 55/55 pass
cd ../frontend && npm test && npm run build   # 21/21 pass; vite build clean
cd .. && git diff --check                     # clean
git -C vendor/forge status --short            # empty
git -C vendor/forge rev-parse HEAD            # 6356c1ad565029c82513c96e42ad5492c1b09c4e
```

## F. Manual smoke test — honestly reported

As in every prior milestone, this sandboxed session has no display and no browser-automation tool connected (checked again this session — none available). The 17-step visual walkthrough in the original spec could therefore not be literally clicked through pixel-by-pixel; what follows is what *was* verified for real, against the actually-running `./scripts/dev.sh` backend+frontend, plus code review of the shipped CSS/DOM for the rest.

**Deck import smoke test (real, via `curl` against the running backend):**
- Imported a deck containing the line `1 Uurg, Spawn of Turg (DMU) 225` (no leading `x`, real printing suffix).
- The card resolved to Scryfall id `dd3fc36c-682b-4352-a66f-eddd2baf0bf6` with the correct oracle text and mana cost for the `DMU` printing specifically (confirmed via `/cards/presentation`), not merely *a* printing of Uurg.
- Re-imported with a lower-cased set code to confirm case-insensitivity resolved to the same printing.
- Confirmed via a fresh, cold call that the `default_cards` printing bulk downloads once (~78 MB) and subsequent lookups are served from the in-memory index with no further network activity.
- Cleaned up: deleted only the two decks created by this test (ids 3–4) via the API; verified via `GET /decks` before and after that the pre-existing decks (ids 1–2, the user's own real decks) were completely untouched.

**Full game / auto-pass smoke test (real, via scripted `curl` calls driving an actual game to completion):**
- Ran a complete human-vs-Asphodel game end to end.
- `sole_pass_count = 0` — the human was never once shown a priority decision whose only legal action was pass; every such decision was auto-submitted by the backend, per Part B's contract.
- `real_decision_count = 20` — every decision that had a real alternative to pass still stopped for the human as normal; auto-pass never over-reached.
- `tapped_seen = True` — real tapped-card data was present in the observation stream during the game, confirming the new `.table-card--tapped` 45°-rotation CSS has real data to apply to (verified structurally; not a pixel screenshot).
- The game completed naturally and a report was generated; both servers remained healthy throughout.

**What was not literally verified:** pixel-level rendering of the fullscreen layout, hover-driven hand-card rise/scale, click-to-pin preview swapping, and the menu button's open/close animation. These are grounded in code review of the exact shipped CSS/DOM (readable from the diff) plus the real data flow above, not a screenshot — a human should do the first real click-through before fully trusting the layout blindly, exactly as flagged in every prior milestone's doc.

## G. Known limitations

- No literal browser screenshot was taken (no automation tool connected this session; see §F).
- Printing resolution depends on Scryfall's `default_cards` bulk being reasonably current at download time — a printing added to Scryfall after the last bulk refresh would fall through to the name-only fallback until the cache is refreshed, not silently fail.
- The optional "click a public-card-linked recent action to inspect that card" behaviour was left unimplemented (the spec explicitly marked it "may", not required) — the action timeline is display-only text for now.
- Physical library, camera, drag-and-drop, animations, sound, WebSocket/multiplayer, accounts, and any Asphodel policy/Forge rules change remain explicitly out of scope, as instructed.

## H. Verdict

Backend/Forge/frontend builds and tests are all green (137/137 backend, 55/55 Forge, 21/21 frontend), `git diff --check` and vendor Forge are clean at the pinned SHA, and both new behavioural claims (auto-pass firing only on a sole legal pass, printing-aware resolution to the exact requested printing) were proven against a real running game and a real import, not mocks. Given the honest caveat in §F (no literal pixel screenshot of the new tabletop layout), the recommendation is: **GO for a first real human click-through of the fullscreen tabletop**, treated as the final visual confirmation pass before calling it the definitive replacement for the previous dashboard layout.
