# V2e.5.1 — Dedicated Land Zones and Visual Mana Payment

Base: V2e.5 `c574b5c`.
Forge remains exactly `6356c1ad565029c82513c96e42ad5492c1b09c4e` (`git -C vendor/forge status --short` empty). **No Java/bridge changes were needed or made this milestone** — every capability required (per-item `cardRef` for `mana_payment`, land detection via `typeLine`) was already reachable from data Forge already reports. This is a corrective follow-up: V2e.5's stacking, summoning-sickness visuals, transitions, slower playback, and individual-card expansion for selection decisions are all **unchanged**.

## 1. Lands separated from the normal battlefield row

`land-zone.ts`'s pure `isLandCard(card)` checks `typeLine` for the Magic card type `"Land"` as a whole word (`/\bLand\b/`) — matches `"Land"`, `"Basic Land — Forest"`, `"Artifact Land"`, and (confirmed against real Forge data) `"Basic Land - Mountain"` regardless of which dash style Forge happens to use, since the regex only cares about the word "Land" itself. `partitionBattlefield(cards)` splits any zone into `{ lands, nonLands }`, preserving Forge's own order within each side. **Presentation only**: nothing here moves a card between Forge zones, touches `player.battlefield`, or feeds anything back into rules/legality — it is a pure read of already-public data.

`board-renderer.ts`'s `renderBattlefieldHalf` now partitions first and renders only `nonLands`; a new `renderLandZone` renders only `lands`, reusing the exact same grouping/reconciliation machinery (`card-grouping.ts`, `createTableCard`'s element-reuse) as the main row — so a land's tap/untap rotation, summoning-sickness (irrelevant for lands but structurally consistent), and stack-count-change pulse all animate exactly the same way they already do for creatures.

### Layout: right-side dedicated area, symmetric top/bottom

Each `.table-battlefield-half` gained a third flex column — `[commander-dock] [creatures/artifacts] [land-zone]` — so lands sit in their own area on the right side of *both* halves, preserving the top-vs-bottom symmetry the spec explicitly allowed trading off against a literal corner-pinned mockup ("exact positioning can be visually adjusted, but preserve the top-vs-bottom table symmetry"). This was a deliberate simplification over absolutely-positioning a corner pile: it avoids fighting the existing right-side preview panel's own `position: absolute` real estate, needs no new z-index bookkeeping, and reads clearly as "lands live somewhere else, not mixed into the creature row" — the actual requirement — without the added complexity and risk of an overlap-prone absolute-positioned corner box.

## 2. Land pile / fan

Collapsed by default via the same `groupCards` used everywhere else (V2e.5) — `Forest ×4`, `Mountain ×2`, `Command Tower` — never merging Forge identities (`CardGroup.cardRefs` still lists every real cardRef). `.table-land-zone .table-card-slot` uses a small fixed 96px width (a "pile," not scaled by `computeBattlefieldScale`) with a `-54px` overlap by default. Hovering the **whole zone** (`.table-land-zone:hover .table-card-slot`) removes that overlap via a 260ms `margin-left` transition — pure CSS, no click required — spreading every group enough to identify it; tapped lands keep their existing 90° rotation throughout (fanning only ever changes horizontal position). Leaving the zone reverts the overlap automatically (`:hover` state ends).

## 3–6. Mana payment: a dedicated visual overlay

### Backend: `sourceCardRef` was already there, just never relayed

`ForgeManaPaymentOption` already carried `sourceCardRef` (a real permanent's cardRef) or `null` (floating mana) — `human-decision-render.ts`'s `mana_payment` case now copies it into `MenuItem.cardRef`, exactly the same additive pattern used for every other decision family in V2e.4/V2e.5. No Forge/vendor change was needed for this either; it was Forge's own bridge data all along.

### Frontend: grouping, then a dedicated surface

`mana-payment-mapping.ts`'s `groupManaPaymentOptions(items, cardsByRef)` groups by `sourceCardRef` (never by name — two same-named Mountains always stay two separate groups, confirmed against a real game with four real Mountains, four distinct cardRefs), classifies each group as a **land** or **other source** using the same `isLandCard` check, and separates **floating** mana (`cardRef: null`) out entirely since it has no physical card. A source with more than one currently-legal option (e.g. a multi-color land) keeps every option under its one group — nothing is collapsed or guessed.

`mana-payment-overlay.ts` is the dedicated surface: the tabletop stays visible and **keeps updating** behind a darkened, blurred backdrop (`position: fixed`, `backdrop-filter: blur(6px)`); "Lands"/"Other sources"/"Floating mana" sections each show only when non-empty; every source is a large real card built with the same `createTableCard` used everywhere else (`.table-mana-source-card`, 190px) — the card itself is the control, there is no generic "`[Mountain produces R]`" button anywhere in this path anymore.

`playtest-view.ts`'s `renderDecisionIfChanged` now branches on `state.pendingDecision.type === "mana_payment"`: the generic `decisionDock` is cleared and `manaOverlay.render(...)` is called instead of `renderDecision(...)`. `computeActiveMapping` (the V2e.5 board-expansion mechanism) explicitly excludes `mana_payment` — the dedicated overlay is the sole interaction surface for it; the underlying board never *also* highlights lands as "playable" for this decision, which would be redundant and confusing next to the overlay's own cards.

### Clicking a source (§6/§7) reuses the exact same click-decision logic as everywhere else

Both a card click and a floating-mana chip click funnel through `decideCardAction` (unchanged, from V2e.4) — a single-option source submits its exact `AgentChoice` directly; a multi-option source (e.g. Command Tower producing several colors) opens the same contextual menu component (`hand-action-menu.ts`, already used for hand cards and expanded board selections) anchored to the clicked card, listing exactly Forge's own options. Nothing is invented locally; the overlay only ever reports which card was clicked and with which options — the submit/menu decision and the actual submission are the same code path used by every other card-driven interaction in the app.

Verified against a real multi-step payment: casting a spell costing `{2}{R}` from human's Krenko deck produced `mana_payment` decisions where the remaining cost genuinely dropped step by step (`{2}{R}` → `{3}` was one of the observed sequences), and the SAME Mountain that had just been used to pay disappeared from the next step's options while its board state showed `tapped: true` — exactly the "click → Forge confirms → land taps → remaining cost updates → overlay updates" loop the spec describes, driven entirely by real Forge responses, not a local simulation.

## 8. Non-land sources

`groupManaPaymentOptions` makes no land-vs-other assumption beyond the same `isLandCard` typeLine check used for the battlefield split — a mana rock, a mana creature, or a Treasure (`typeLine` containing "Artifact", "Creature", etc. but not "Land") lands in the "Other sources" section automatically; nothing hardcodes "mana source == land" anywhere in this code.

## 9. Normal tabletop interaction — untouched

Outside `mana_payment`, lands render in their dedicated zone exactly like any other permanent through the shared `renderCardRow`/`createTableCard` pipeline — the same tap/untap animation, summoning-sickness visuals (structurally available though moot for lands), stacking, and V2e.5 individual-card expansion for selection decisions (attackers/blockers/targets/cost-object) all apply to a land exactly as they did before, since `renderLandZone` is just `renderBattlefieldHalf`'s same machinery pointed at the other partition. If a land itself exposes a `priority_action` (e.g. an activated ability), V2e.4's existing hand-card-style interaction architecture is untouched — this milestone did not change how `priority_action` maps onto cards at all.

## 10. Animation

Opening: the overlay's backdrop/surface fade+scale in over ~220ms (a single shared `.table-mana-overlay--hidden-visual` state, added synchronously then removed via a double `requestAnimationFrame` so the browser genuinely paints the "before" frame first — the same established technique as V2e.5's card-entering transition); mana-source cards get their own ~220ms rise/fade/scale-in, but **only on the very first render since opening** — a later step of the same multi-step payment (remaining cost changing, a spent source disappearing) re-renders without re-triggering that entrance, so clicking through a payment never feels like the whole overlay keeps re-animating. Closing reuses the identical shared state for a ~220ms fade, with the element only truly hidden once that transition completes. A source becoming tapped once Forge confirms it still animates via the **existing** real board 0→90° rotation transition (V2e.3/V2e.5) — that continuity comes for free, since the board underneath keeps rendering normally through the whole payment; the overlay never re-implements it. `@media (prefers-reduced-motion: reduce)` collapses all of the overlay's own transition durations to near-zero.

## 11. Tests

- **Backend** (`human-decision-render.test.ts`, +4): a source option carries its exact `sourceCardRef`; floating mana's `cardRef` is `null`; two same-named Mountains keep two distinct refs; a multi-color source (Command Tower) preserves both of its exact options under the same `cardRef` rather than collapsing them.
- **Frontend pure** (`land-zone.test.ts`, 6; `mana-payment-mapping.test.ts`, 8): land-typeLine detection (including the exact real-Forge hyphen style, confirmed live); battlefield partition preserves order and every cardRef; grouping by `sourceCardRef` (never by name); multi-option-source detection; floating-mana separation; land-vs-other classification (including a mana rock/Treasure landing in "other"); ordering stability; and two tests combining grouping with the existing `decideCardAction` to directly demonstrate "one option submits" / "several options open the selector" for a mana source specifically.
- **UI behavior** (mana_payment choosing the overlay path; overlay updating between steps; overlay closing once the decision is no longer `mana_payment`): these are DOM-state-transition behaviors of `mana-payment-overlay.ts`/`playtest-view.ts`, and — consistent with this project's established testing convention (no DOM test framework is set up; `hand-action-menu.ts`/`card-preview.ts` were likewise never unit-tested directly) — are verified instead by code review plus the real, live-game data flow captured in §12, not a synthetic DOM test.

## 12. Manual smoke test — honestly reported

No display and no browser-automation tool are available in this sandboxed session (checked again — none connected), so the 17-step visual walkthrough could not be literally clicked through pixel-by-pixel. What follows is what was verified for real against the actually-running `./scripts/dev.sh` servers, driving genuine Forge games via scripted `fetch` calls:

- **Land/non-land split, real data**: a real human battlefield showed four Mountains (`typeLine: "Basic Land - Mountain"`) and one non-land creature (`typeLine: "Creature - Goblin"`) — `partitionBattlefield` on this exact array correctly separates all four lands from the one creature.
- **Land grouping, real data**: of those four real Mountains, two were tapped and two were not (distinct cardRefs throughout) — feeding this through the existing, already-tested `groupCards` produces exactly the `Mountain ×2` / `Mountain ×2 (tapped)` split the spec's example describes (with Forests in the example, Mountains in this actual game — structurally identical).
- **Real multi-step mana payment**: casting a spell produced real `mana_payment` decisions with the remaining cost genuinely decreasing step by step, four distinct real Mountain cardRefs offered as sources, and a spent Mountain both disappearing from the next step's options and showing `tapped: true` on the board — the exact click → Forge-confirms → land-taps → cost-updates loop the spec describes.
- **Not literally verified**: the visual appearance of the land-zone layout/fan-on-hover, the overlay's backdrop blur/darken and card entrance animations, and the color-selector's on-screen placement for a multi-option source — these are grounded in the shipped CSS/DOM (readable from the diff) and the real data confirmed above, not a screenshot.
- A live multi-color source (e.g. an actual Command Tower reaching the mana_payment stage with 2+ legal colors) was not additionally observed this session — covered instead by the pure unit tests using realistic fixtures (§11).

## Preserved

Stacking, summoning-sickness visuals, transitions, slower Asphodel playback, individual-card expansion for selection decisions (V2e.5), Asphodel policy, physical-library work (still not started), and vendor Forge are all unchanged.

## Validation

```sh
cd backend && npm run build && npm test      # tsc clean; 152/152 pass
./scripts/forge-test.sh                       # 55/55 pass
cd ../frontend && npm test && npm run build   # 83/83 pass; vite build clean
cd .. && git diff --check                     # clean
git -C vendor/forge status --short            # empty
git -C vendor/forge rev-parse HEAD            # 6356c1ad565029c82513c96e42ad5492c1b09c4e
```

## Known limitations

- No literal browser screenshot (see §12).
- A live multi-color mana source reaching the color-selector step was not observed this session; covered by unit tests only.
- The land zone's exact position (right side of each half, not literally corner-pinned) is a deliberate, documented simplification — see §1.
- Physical library, camera, drag-and-drop, particle effects, sound, multiplayer, accounts, and any Forge/Asphodel policy change remain out of scope, as instructed.

## Verdict

Backend/Forge/frontend builds and tests are all green (152/152 backend, 55/55 Forge, 83/83 frontend), `git diff --check` and vendor Forge are clean at the pinned SHA, and every core data-plumbing claim (land detection against real typeLine strings, land grouping with a real tapped/untapped split, multi-step mana payment with real cost changes and real per-source cardRefs) was proven against actual live Forge games — not mocks. Given the honest caveats above (no literal pixel screenshot; no live multi-color-source observation this session), the recommendation is: **GO for a first real human click-through**, focused specifically on confirming the land zone's on-screen position/hover-fan and the mana overlay's backdrop/card-entrance animation and color-selector placement — the claims resting most heavily on CSS/DOM review rather than live data.
