# V2e.1 — Premium Playtest UI & Card Visuals

Base: V2e `2e62907`.
Forge remains exactly `6356c1ad565029c82513c96e42ad5492c1b09c4e` (`git -C vendor/forge status --short` empty). **No rules logic moved to the frontend; `BaselineAsphodelAgentV2b` and the Forge protocol are unmodified.**

This is a UX/visual pass on top of V2e's working web interface, plus the card metadata plumbing needed to make a game actually legible to someone who doesn't know every card by heart.

## 1. Architecture: presentation metadata, kept separate from Forge

`AgentCardObservation` (the Forge-protocol DTO) is untouched — it still carries only rules-relevant fields (`name`, `typeLine`, `power`/`toughness`, `tapped`, `counters`, …). A brand-new, parallel layer supplies pure presentation data:

```
backend/src/cards/card-presentation-service.ts   (CardPresentation: manaCost, manaValue, typeLine, oracleText, imageUri)
        │ reuses CardProvider.findByExactName (already an in-memory Scryfall index after first load)
POST /cards/presentation   (backend/src/app.ts)
        │ batch, deduplicated, capped at MAX_CARD_PRESENTATION_NAMES (75), one card's failure never fails the batch
frontend/src/playtest/card-presentation-store.ts   (CardPresentationStore, one Map<name, CardPresentation|null>)
        │ ensure(names) only ever fetches names never seen before; concurrent calls share one in-flight request per name
frontend/src/playtest/card-view.ts / card-preview.ts   (render only — no new data source)
```

Nothing in this layer is a rules input. It never reaches `runHumanVsAgentMatch`, `validateChoice`, or Forge itself — it exists purely so the browser can show a name, mana cost, oracle text and artwork next to the exact same `AgentCardObservation` it already had.

### Backend cache

`CardPresentationService` caches by normalized name, including a cached `null` for a name that did not resolve (never retried every poll). Requesting the same name across many polls or many playtests costs exactly one `CardProvider` lookup, ever, for the lifetime of the backend process. Individual failures (a thrown error from the provider) are caught per-card and simply excluded from the response — one bad name cannot take down the batch.

### Frontend cache

`CardPresentationStore.ensure(names)` (backend/src/playtest/card-presentation-store.ts) is the **only** place the frontend ever calls `POST /cards/presentation`. `selectMissingNames` (pure, tested) filters to names genuinely never seen; `ensure` further dedupes concurrent overlapping calls so two polls in flight for the same name share one request. Combined with `collectVisibleCardNames` (board-renderer.ts, pure, tested) collecting every publicly-named card in the current observation, the actual request pattern per poll is:

```
poll game state → collect visible names → ask the store to ensure them → (network call only for genuinely new names) → targeted re-render
```

Never "poll → fetch every card → rerender everything." Images then load through the browser's own HTTP cache like any other `<img src>`.

## 2. New visual layout

Same identity (very dark ground, violet accent, quiet borders, faintly raised surfaces), pushed on hierarchy/spacing/contrast:

```
┌─────────────────────────────────────────────────────────┬──────────────┐
│ Turn 5   Main 1                      YOU 34  ASPHODEL 28│  card preview │
├───────────────────────────────────────────────────────── │   (hover or   │
│ ASPHODEL                                                 │  click a card │
│   Command        Permanents            Lands             │   to pin it)  │
│   [Krenko]        [Goblin Token]       [Mountain][T]     │              │
│   Graveyard·3   Hand·5   Library·81                      ├──────────────┤
├───────────────────────────────────────────────────────── │  Activity     │
│ STACK — Putrefy → Krenko                                 │  T5 Asphodel  │
├───────────────────────────────────────────────────────── │  plays Mtn    │
│ YOU                                                       │  T5 Asphodel  │
│   Permanents          Lands                               │  casts Krenko │
│   [Uurg][Zuran Orb]   [Forest][T] [Swamp]                 │  …(fainter)   │
│   Hand · 4                                                │              │
│   [Crop Rotation][Forest][Putrefy][Life from the Loam]    │              │
│   Graveyard·7 (click to expand)   Library·76              │              │
├───────────────────────────────────────────────────────── ┴──────────────┤
│ PRIORITY · Turn 5 · main1 · Stack: empty                                │
│ Choose an action                                                        │
│ [ Cast Zuran Orb ] [ Play Forest ] [ Activate ability ] [ Pass priority →]│
│                                                        [ End Playtest ]  │
└───────────────────────────────────────────────────────────────────────┘
```

`board-renderer.ts` was rewritten (not patched): a `<section>` per player, a `Permanents`/`Lands` split computed purely from the printed `typeLine` (`categorizeCard` — no rules engine, same technique `improved-agent.ts` already uses for its own heuristics), a compact expandable Graveyard/Exile, and a right-hand sidebar holding the card preview panel and the activity log. The decision panel is a **sticky dock** (`position: sticky`, not `fixed` — the board scrolls, the dock never leaves the viewport and never breaks the layout) so the current decision is always one glance away no matter how far the board has scrolled.

## 3. Card presentation, everywhere a card appears

`card-view.ts`'s `createCardView` is the one component behind every card in every zone (hand, battlefield, command, an expanded graveyard/exile): a small art thumbnail (`object-fit: cover`, cropped, or a plain placeholder swatch when no `imageUri` is available) plus name / type line / P-T / a badge row (`T` for tapped, `SS` for summoning sick, counters) built only from fields already in `AgentCardObservation`. Tapped is never a CSS rotation — a bold `T` badge plus a dimmed card, exactly per spec.

## 4. Full card preview — hover and click both work

`card-preview.ts`'s single preview panel lives in the sidebar. Hovering any card shows it there; **clicking pins it** (title/name/type/oracle text/P-T/counters/tapped, and the real Scryfall image when available) so it can be read calmly without chasing the mouse — a pinned card is not interrupted by hovering something else, and Escape (or the panel's own close button) unpins it. When no `imageUri` is available (a card the local Scryfall bulk index has not resolved), the full text block still fully explains the card — reading a card is never gated on the image alone.

## 5. "External Player" is gone from the UI, without touching Forge

`board-renderer.ts` never reads `player.name` for its section headings — it always shows `YOU`/`ASPHODEL`, derived purely from `role: "self" | "opponent"`. Forge's own internal lobby-player labels (`"External Player 1/2"`, unchanged since V2c) are simply never displayed; nothing in `forge-bridge` was touched for what is a display-only concern.

## 6. Stable polling — no flicker, no lost hover/pin, no scroll jump

The game screen's containers (board, sidebar/preview, event log, decision dock) are built **once** per game start and never torn down by a poll. Each poll (`playtest-view.ts`):

1. Updates `lastObservation` only when the backend actually sent one — since V2c's isolation means `observation` is `null` whenever it is not the human's turn, the frontend keeps showing the last board it legitimately saw instead of going blank while Asphodel plays (this is purely local browser state; it changes nothing about what the backend ever sends or the isolation guarantee itself).
2. Calls `cardStore.ensure(...)` for the currently visible names (a no-op fetch once everything is cached).
3. Independently re-renders **only** the sections whose underlying JSON actually changed since the last poll (board / activity log / decision), via three separate change-detection keys — a `presentationVersion` counter also forces one board re-render exactly when new art/text just arrived.

The result: during the common case (nothing changed, or only Asphodel "thinking"), no DOM is torn down at all — a pinned preview, scroll position, and hover state all survive. Loading states (`Starting Forge…`, `Asphodel is thinking…`, `Waiting for you`, `Submitting choice…`) are a single status line updated in place, never a layout-shifting placeholder swap.

## 7. Decision hierarchy and combat

`decision-renderer.ts` now shows a small-caps context line (`describeDecisionFamily(type)` · Turn · Phase · Stack) above the human-phrased title the backend already built (`describeDecision`, unchanged) — no raw Forge type string or decision id is ever shown. Buttons are real buttons (44px min height, clear hover/active/focus-visible states); Pass is visually distinct (muted, trailing `→`) so it is never mistaken for a real option. Combat decisions (attackers/blockers/order) keep Forge's own per-option add/remove/finish model — no batched checkbox multi-select was invented, since the DTO does not expose that shape and inventing one would mean fabricating a relationship Forge never sent.

## 8. Setup screen

Redesigned as two columns (`YOU` / `ASPHODEL`), each a local-deck `<select>` with the Archidekt URL tucked behind a `<details>` disclosure ("Use an Archidekt URL instead") — clearly secondary to the local picker, exactly as asked. The static `CardSearch` demo is no longer mounted on the setup screen; `card-search.ts` and its 8 tests are untouched and still exercised, ready for the physical-library milestone, but no longer visually implying an active feature.

## 9. Tests

- Backend (`card-presentation-service.test.ts`, 7; `app.test.ts`, +3): resolves real fields, deduplicates before ever calling the provider, caches across separate calls (including a cached failure), an unknown/individual-failure name is absent rather than breaking the batch, the `MAX_CARD_PRESENTATION_NAMES` cap, blank-entry filtering, and the HTTP route itself (dedup, unknown name, oversized-batch rejection).
- Frontend, pure functions only (no UI test framework added): `card-format.test.ts` (`cardDisplayName`, `categorizeCard`, `formatCounters`), `card-presentation-store.test.ts` (`selectMissingNames`, fetch-once-per-name, cached-null, concurrent-call sharing), `decision-renderer.test.ts` (`describeDecisionFamily`), `board-renderer.test.ts` (`formatPhase`, `collectVisibleCardNames`). All pre-existing frontend/backend/Forge tests remain green.

## 10. Validation

```sh
cd backend && npm run build && npm test
./scripts/forge-test.sh
cd ../frontend && npm test && npm run build
cd .. && git diff --check
git -C vendor/forge status --short   # empty
```

## 11. Manual smoke test — honestly reported

This sandboxed environment has no display and no browser-automation tool available this session (checked; none connected). As in V2c/V2d/V2e, the CLI/API-level path was therefore exercised for real against the actually-running `./scripts/dev.sh` servers: starting a real playtest, polling `GET /playtests/:id`, confirming `POST /cards/presentation` returns real Scryfall `imageUri`/`oracleText`/`manaCost` for cards actually drawn in that live game (not a fixture), and confirming the backend stays healthy afterward. What was **not** literally verified is pixel-level rendering in a browser window. Every visual claim in this document is instead grounded in the exact CSS/DOM this commit ships (readable from the diff), not a guess — but a human should still do the first real click-through before trusting the layout blindly.

## 12. Known limitations

- No literal browser screenshot was taken (see above).
- Card art is only as complete as the local Scryfall bulk index (`ScryfallCardProvider`) already was in V2a — no new data source was added.
- Physical library, camera, drag-and-drop, animations, sound, WebSocket, multiplayer, accounts and any Asphodel policy change remain explicitly out of scope, as instructed.
- Combat UI still exposes Forge's native per-option add/remove/finish flow rather than a fabricated batch-select — a deliberate choice, not an oversight.

## 13. Verdict

Backend/Forge/frontend builds and tests are all green, the card-presentation pipeline was proven end-to-end against a real running game, and the new layout/preview/dock/log are implemented exactly as specified against real DTOs with no invented data. Given the honest caveat in §11 (no literal pixel screenshot), the recommendation is: **GO for a first real human click-through**, with that first session treated as the final visual confirmation pass before calling the browser the definitive replacement for the CLI.
