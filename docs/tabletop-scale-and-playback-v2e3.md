# V2e.3 — Tabletop Scale, Command Zones, and Opponent Action Playback

Base: V2e.2 `f4bddb8`.
Forge remains exactly `6356c1ad565029c82513c96e42ad5492c1b09c4e` (`git -C vendor/forge status --short` empty). **No rules logic, decision isolation, Asphodel policy, or vendor Forge changed.** This is a focused visual/game-feel iteration on top of V2e.2's validated fullscreen tabletop — the overall layout paradigm (fullscreen battlefield, life positions, round menu button, human hand interaction, safe priority auto-pass, reports, Archidekt/import) is unchanged.

## 1. Commander placement

Command-zone cards were previously merged straight into the battlefield row (`[...player.command, ...player.battlefield]`). They now render in a separate `.table-commander-dock` — a slim column pinned at the very left edge of each half, immediately next to that half's life total, with the battlefield's own cards starting only after it (`board-renderer.ts`'s `renderCommanderDock` vs. `renderBattlefieldHalf`, which now reads only `player.battlefield`).

Real Forge data confirms exactly why this needed its own filter: a fresh game's `command` zone contains **both** the real commander *and* a Forge-internal bookkeeping object literally named `"Commander Effect"` (`DetachedCardEffect`, `forge-game/.../Player.java:3209` — tracks the commander tax, not a physical card). Verified directly against a live game:

```
command zone cards: ["Krenko, Tin Street Kingpin","Commander Effect"]
```

`commandZoneCards(player)` (`board-renderer.ts`) filters this by name (`ENGINE_PSEUDO_CARD_NAMES`) — a frontend-only, display-layer filter. Nothing upstream changes: `AgentObservation`/`player.command` still carries the pseudo-object exactly as Forge reports it; it is only ever excluded from the *physical tabletop representation*, per spec. No Java bridge change was needed or made. The dock uses `player.command`'s actual current zone state — never `player.commanders`/a decklist — so casting a commander empties the dock immediately (it then simply appears via the normal battlefield array) and returning it to command zone refills the dock automatically; multiple real commanders (partners) are supported since the filter has no arity assumption. Tested with fabricated fixtures (`board-renderer.test.ts`): pseudo-object excluded, real commander(s) kept, dock genuinely empty once cast, no pseudo-name ever reaches `collectVisibleCardNames` (so Scryfall is never even asked about `"Commander Effect"`).

## 2. Battlefield card size

Cards roughly doubled (92px → 160px battlefield base, 116px → 124px hand base, hand-hover scale raised to 1.7× ≈ 211px) — all within the spec's visual targets. `battlefield-scale.ts`'s pure `computeBattlefieldScale(cardCount)` implements "use the available space before shrinking": 1–6 permanents stay full-size with zero overlap; 7–10 introduce mild, linearly-growing overlap at the *same* size; overlap keeps growing (capped at 64px) well before width ever shrinks, and width only shrinks past that cap, down to a 96px floor. `renderBattlefieldHalf` sets the result as CSS custom properties (`--bf-card-width`, `--bf-card-overlap`) on the container; `tabletop.css` consumes them (`.table-battlefield-cards .table-card-slot { width: var(--bf-card-width) }`, negative margin for overlap). Monotonicity (more cards never means a bigger card or less overlap) is directly tested (`battlefield-scale.test.ts`, 5 tests). Commander-dock cards are deliberately exempt from this scale (fixed 150px) — there are only ever one or two, no crowding concern.

## 3. Tapped state: 90°, reserved slot

`.table-card--tapped` now rotates a full 90° (was 45°) — a real Magic tap, not a stylized lean. No `[T]` badge existed as the primary signal already (confirmed by inspection; nothing to remove), and the accessible title still reads "… (Tapped)". A 90°-rotated 5:7 card has a 7:5 *visual* footprint, so a naive rotation would clip into neighbors or force ugly, unpredictable row reflow. `createTableCard`'s new `useSlot` option wraps battlefield/commander cards (never the hand, which never taps) in a `.table-card-slot` — a fixed-aspect box that swaps to the rotated footprint's own aspect ratio (`.table-card-slot--tapped { aspect-ratio: 7/5; width: calc(var(--bf-card-width) * 7/5) }`) while the inner `.table-card` keeps its normal size and simply rotates inside it. Neighbors get correctly-sized spacing from the slot itself — deterministic (a fixed formula, not per-row JS measurement), never "unpredictable." `card-view.test.ts` extracts and tests the pure `tableCardClassName` (tapped class present/absent correctly) without needing a DOM.

Verified against a real game: `sawTapped: true` — real tapped-card data flowed through a live match onto this new representation.

## 4. Card inspection: no right panel

The previous `.table-preview` was a full sidebar band (fixed width, border-left, background blur, close button, name/type/oracle-text block). It is now nothing but the selected card itself, large (300px), floating on the right — "brought closer to the player," per spec. No panel background, no border, no text block, no persistent empty state (`hidden` until a card is selected). It renders upright regardless of the real card's tapped state (`{ ...card, tapped: false }` — inspection is for reading, not re-representing board state the battlefield card already shows). `pointer-events: none` on the floating wrapper means it never intercepts a click meant for anything behind or around it. Selection logic was extracted into a plain, DOM-free `PreviewSelection` class (`preview-selection.ts`) — click-same-card-closes, click-different-card-replaces, `close()` — directly unit tested (4 tests) for "survives polling" (repeated `isSelected`/`current` reads never perturb it; only an explicit toggle/close does). `card-preview.ts` now only wires that pure state machine to the DOM. Escape still closes; there is no separate close button (dropped along with the rest of the panel chrome).

The hand is unaffected: hover-only, never wired with `onActivate`, so a hand card structurally cannot reach this inspector.

## 5. Public action playback

### The problem this fixes

Previously the browser only ever saw the human's own observation, refreshed to whatever the board looked like once it was their turn again — Asphodel's whole turn (land, mana tap, cast, attack, …) landed as one invisible jump.

### Backend: `PublicGameFrame`

`backend/src/human/public-game-frame.ts` defines `HumanSafePublicBoardObservation` (a type-level alias for `AgentObservation`, documenting the invariant it is always built to satisfy) and `PublicGameFrame { id, event: PublicGameEvent | null, observation }`, plus the one function that makes the invariant real:

```ts
sanitizeAgentObservation(agentObservation, humanPlayerId, lastKnownHumanHand): HumanSafePublicBoardObservation
```

Forge's `AgentObservation` for Asphodel's own turn has `self = Asphodel` (genuinely secret hand fully visible to itself) and `opponent = human` (structurally *no* `hand` field at all — `AgentOpponentPlayerObservation` has no such property). `sanitizeAgentObservation` never re-derives anything: every public zone (battlefield/graveyard/exile/command/commanders/life) is identical from either perspective — Forge already computed it once — so this function only relabels roles (`selfPlayerId` becomes the human's), drops Asphodel's `hand` entirely, and restores the human's own hand from `lastKnownHumanHand`, a copy that only ever came from a real, already-isolated human-perspective observation (`PlaytestSessionManager`'s own `lastHumanHand` cache, updated every time it genuinely is the human's turn). This is a pure redaction transform — no network round-trip, no new Forge query.

### When a frame is captured

`runHumanVsAgentMatch`'s existing `onDecision(owner, observation, decision, choice)` hook already fires once per accepted decision, with `observation` being **the state that led to** that decision (i.e. whatever the *previous* action produced). `PlaytestSessionManager` tracks `pendingFrameOwner` (who owned the *previous* decision) and captures a frame **only when both the previous and the current decision belong to Asphodel** — using the current decision's incoming observation, sanitized. This deliberately skips two moments that need no frame at all:
- The first Asphodel decision right after the human's own turn — that board was already visible to the human live.
- The final Asphodel→human transition — Magic's own priority rules mean Asphodel always gets one more decision (typically "pass") after its last real action before priority genuinely reaches the human, so that last real action is already captured one step earlier; the fully-settled board the human is about to act on is simply the live, already-isolated `observation`/`pendingDecision` fields the moment it is genuinely their turn — no second, redundant frame.

A frame still gets pushed even with no narratable text (e.g. a mana ability tapping a land has no `describeAgentAction` text) — content-key deduplication (`JSON.stringify` comparison) only skips a frame when *both* there is no new text *and* the sanitized board is byte-identical to the last captured one, so purely cosmetic re-polls of an unchanged board never spam the queue, but every real change still gets its own frame.

`WebPlaytestStateDTO.frames: PublicGameFrame[]` exposes the full ordered list every poll — same "always-authoritative, browser-dedupes-itself" shape as the pre-existing `publicEvents`.

### Frontend: `FramePlaybackQueue`

`frame-playback.ts`'s `FramePlaybackQueue` is a small, fully DOM-free FIFO: `enqueue()` silently ignores any frame id already seen (queued, mid-playback, or already played), `pump()` plays whatever is queued one at a time with `computePlaybackDelayMs()` between them (base `DEFAULT_FRAME_PLAYBACK_DELAY_MS = 450`ms — the one place this constant lives — shrinking, floor 80ms, as the backlog grows, so a big catch-up never becomes unbearable while still preserving order), and only calls `onIdle()` once the queue has genuinely drained. `isIdle()` is false for the entire stretch from the first queued frame to that `onIdle` call.

`playtest-view.ts` wires this in: every poll enqueues `state.frames` and calls `pumpFrames()` (a no-op re-entry if already mid-playback — the same shared queue just keeps draining as new frames arrive). `onFrame` paints the board from that frame's observation and, if it carries an `event`, appends it to a locally-tracked, capped `playedEvents` list that drives the recent-actions timeline — so **the timeline advances exactly in step with what is being shown**, never ahead of it. `onIdle` is the **only** place that reveals the live `pendingDecision`/`observation` (`revealLiveState`) — the human decision genuinely cannot appear before the queue is empty, and because JS is single-threaded there is no window in which a poll's `enqueue` can race past that "queue-just-emptied → reveal" transition. The pre-existing no-flicker architecture (persistent containers, only-what-changed re-rendering) is preserved: `paintBoard(observation)` is the one function both the live path and every played frame call.

Game-over is likewise gated: the terminal-status→end-screen transition only fires once `frameQueue.isIdle()`, so the human still gets to watch Asphodel's final turn play out rather than jumping straight to "GAME OVER."

### Real end-to-end verification (not mocked)

Driving an actual live game through this exact pipeline:

```
framesSeenTotal: 25, sawTapped: true, sawCommanderInDock: true, leakCheckFailures: []
```

Every frame's `event` text matched the pre-existing `publicEvents` log 1:1 where one existed (e.g. `"Asphodel casts Centaur Courser"`), confirming the two logs stay in sync; frames with no narratable action (mana taps) correctly carried `event: null`; and a structural check of every single frame (`opponent.hasOwnProperty("hand")`) never once found a hand field on Asphodel's side.

## 6. Recent actions

Unchanged concept, improved readability: `.table-action-item` now allows two lines (`-webkit-line-clamp: 2`) instead of a hard `white-space: nowrap` truncation, so a long real card name is never cut into a meaningless "For…" — verified directly against real event text above (full names throughout, e.g. `"Asphodel attacks with Centaur Courser (3/3)"`). Still lightweight/unboxed, 5–6 most recent, older entries faded.

## 7. Preserved

Fullscreen battlefield paradigm, life positions, round menu button, human hand hover-only interaction, safe priority auto-pass (untouched — `priority-auto-pass.ts` was not modified), reports, Forge rules, Asphodel policy, Archidekt/import work, and every hidden-information guarantee are all unchanged. Physical-library work was not started, as instructed.

## 8. Tests

- **Backend**: `public-game-frame.test.ts` (5) — relabeling/redaction correctness, human hand restoration, Asphodel hand field structurally absent, `JSON.stringify` never contains Asphodel's real hand card name, throws on malformed input rather than silently producing an incomplete frame. `playtest-session-manager.test.ts` (+1) — a full scripted sequence proving: a frame is captured after an accepted Asphodel action; frame ids are strictly ordered; both captured frames are sanitized and leak-free; polling twice never consumes/reorders/duplicates frames; the narrated event text travels with the frame it belongs to.
- **Frontend**: `frame-playback.test.ts` (4) — FIFO order, duplicate frame id ignored, decision-hidden-until-idle (using an injectable, manually-resolved delay to directly observe the mid-playback state), pacing shrinks-but-floors as backlog grows. `preview-selection.test.ts` (4) — selection survives repeated reads, same-card-closes, different-card-replaces, `close()` always clears. `card-view.test.ts` (5) — tapped/untapped/null-tapped class presence, selected + tapped combine independently, base class always present. `battlefield-scale.test.ts` (5) — the size/overlap tiers plus full monotonicity across 1–80 cards. `board-renderer.test.ts` (+4) — pseudo-object excluded, multiple real commanders kept, dock genuinely empty once cast, pseudo-name never reaches the presentation-fetch name list (this last test also stands in for "command cards excluded from battlefield grouping," since `renderBattlefieldHalf` structurally reads only `player.battlefield`).

## 9. Validation

```sh
cd backend && npm run build && npm test      # tsc clean; 138/138 pass
./scripts/forge-test.sh                       # 55/55 pass
cd ../frontend && npm test && npm run build   # 43/43 pass; vite build clean
cd .. && git diff --check                     # clean
git -C vendor/forge status --short            # empty
git -C vendor/forge rev-parse HEAD            # 6356c1ad565029c82513c96e42ad5492c1b09c4e
```

## 10. Manual smoke test — honestly reported

No display and no browser-automation tool are available in this sandboxed session (checked again — none connected), so the 15-step visual walkthrough could not be literally clicked through pixel-by-pixel. What follows is what was verified for real against the actually-running `./scripts/dev.sh` servers, driving a genuine Forge game via scripted `fetch` calls (not fixtures/mocks) — plus code review for the remaining purely-visual claims:

- **Commander placement / pseudo-object filtering**: confirmed directly against a live game's very first state — `command` zone contains both `"Krenko, Tin Street Kingpin"` and `"Commander Effect"`; the frontend's `commandZoneCards` filter (unit-tested) keeps only the former.
- **Tapped data real**: `sawTapped: true` during live play.
- **Frame architecture**: 25 real frames captured across turns 1–8 of a live game, ordering intact, zero leak-check failures, event text matching the existing (already-trusted) `publicEvents` log exactly where narratable.
- **Not literally verified**: pixel rendering of the 90° rotation, the commander dock's on-screen position, the floating preview's exact placement/lack-of-panel, and the hand's hover scale. These are grounded in the shipped CSS/DOM (readable from the diff) and the real data confirmed above, not a screenshot.
- A commander actually being cast mid-game (dock → battlefield transition) was not additionally captured live within this session's time budget — real Commander games don't reliably cast a specific commander on demand — but this exact transition is directly unit-tested with fabricated Forge-shaped fixtures (`board-renderer.test.ts`), and the underlying mechanism (`player.command`'s real, current zone state) is the same one just proven correct against the live game's actual data above.

## 11. Known limitations

- No literal browser screenshot (see §10).
- The commander-cast dock→battlefield transition was verified via unit tests with fabricated fixtures, not an additional live-game observation this session.
- Battlefield overlap uses a simple negative-margin approach that is exact within one wrapped row; a card that wraps to a new row can show a small, cosmetic left-shift rather than perfect per-row centering — acceptable per spec ("visual targets, not hardcoded mandates"), and it never affects card size legibility or the reserved-slot correctness for tapped cards.
- The optional "click a recent-action entry to inspect its card" behavior remains unimplemented, as in V2e.2 (still explicitly optional).
- Physical library, camera, drag-and-drop, animations, sound, multiplayer, accounts, and any Forge/Asphodel policy change remain out of scope, as instructed.

## 12. Verdict

Backend/Forge/frontend builds and tests are all green (138/138 backend, 55/55 Forge, 43/43 frontend), `git diff --check` and vendor Forge are clean at the pinned SHA, and every behavioral claim with real data behind it (commander/pseudo-object zone contents, tapped data, frame ordering, zero hand leakage) was proven against an actual live game, not a mock. Given the honest caveats in §10 (no literal pixel screenshot; no live commander-cast observation this session), the recommendation is: **GO for a first real human click-through**, focused specifically on confirming the 90° tap rotation, the commander dock's position, and the floating preview's appearance match intent — the three claims resting most heavily on CSS review rather than live data.
