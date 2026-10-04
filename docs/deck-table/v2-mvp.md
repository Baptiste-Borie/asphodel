# Deck Table V2 — experimental MVP

## Audit

The app uses view switching, not a URL router. `frontend/src/main.ts` mounts Deck Lab; its Search and Builder tabs live in `deck-lab-view.ts`. V2 adds a third, separate Table view. Open a saved/imported/sample deck in Builder, then select **Table V2**. **Builder V1** returns to the existing interface.

The previous builder combines DOM rendering, sheet commands, search, persistence and statistics in one closure. Its sheet contains groups of `{card, quantity}`, a commander group, optional maybeboard groups, and session-only cuts. It supports search, manual categories, drag between categories, selection transfer, triage, import, rename and deletion. A category is a single structured grouping, not a multi-valued functional tag system.

Card search already uses `POST /cards/search` and shared `LabCard` / `LabSearchQuery` contracts. Its local catalog supports name/Oracle text and advanced syntax. Decks use `GET /decks`, `GET /decks/:id`, `POST /decks`, and `PUT /decks/:id/cards`. The backend stores category, quantity and commander/mainboard/maybeboard sections; the game and card count exclude maybeboard. Existing stats compute type totals, nonland mana curve and average mana value.

The frontend uses TypeScript and native DOM, with no framework or pan/zoom dependency. No existing canvas gesture convention was found. The implementation adds no dependency and changes no backend schema or game-engine payload.

## Architecture and implementation stages

1. `deck-model.ts`: shared Sheet/Group types and pure statistics, used by V1 and V2.
2. `deck-workspace.ts`: versioned UI-only camera, placements, named zones, row reconciliation, explicit membership commands and coordinate transforms.
3. `deck-table-view.ts` / `deck-table.css`: independent DOM view, gestures, selection, zones, search and on-demand analysis. The host injects save, inspect and return-to-V1 callbacks.

The existing active sheet is shared across the two views. Workspace data is separate localStorage under `asphodel.deck-table.v1.<backendId>`. It records card row identity, position, z-order, original role for restoration, zone rectangles and viewport. Exact category/section/name matching precedes fallback matching when V1 edits a category. Movement never modifies structured categories or membership.

Per-deck save timers capture the edited sheet rather than a later active sheet; writes are serialized per deck. The prototype retains existing server save/error behavior. Layout saves are immediate after gestures, and browser-storage errors are displayed separately from deck-save status.

## Focused navigation

In Table V2 the canvas fills the viewport below a 48px toolbar, with a 22px status strip. The former headings and tab bar are hidden in this view. The Asphodel menu keeps Deck Lab, Play, Voice Mic Test and import accessible. Search, Analyse and zone creation remain in the toolbar; the table menu contains the library, V1, Selection, center-deck and pan controls. Zoom controls float at the bottom, and selection actions appear only when needed. Other views keep their existing shell.

## Delivered interactions

- Free card movement, overlapping cards, Shift multi-selection, selection movement, basic rectangle selection.
- Pointer-anchored wheel zoom, Ctrl/Space/middle-button drag or Pan tool, Show all (F), Center deck.
- Named free zones: Commandant and À trier are initialized once. New tables get an initial arrangement and fit-to-view; existing layouts keep their coordinates and camera. Rename inline, move a zone with its spatial members by dragging its header/count, or delete it while leaving cards in place. Empty zones start at 250 × 314 world units. Bounds fit their members with a small title/padding allowance after each drop; there is no manual resize handle. A spatial zoneId is independent of categories and deck membership. Counters sum the quantities of spatial members. Dropping outside detaches a card; overlapping zones choose the smallest hovered target, then the newest on ties. Highlighting uses stable bounds during a drag, avoiding a target that moves under the pointer.
- Set aside / Add to deck applies to selected entries and preserves quantity, original category and commander role. Excluded cards stay visible, with a Cut/Candidate badge. Membership is explicit, never inferred from zone geometry.
- Search the existing catalog, including advanced syntax and pagination; click or drag a result to place it as a candidate. A duplicate result selects its existing table entry.
- Analyse opens over the table, retaining its camera/selection: total, types/lands, nonland curve/average, overlapping color identities and existing category counts.
- Double-click opens existing card inspection; initial far-zoom labels establish a simple semantic detail threshold.

## Scope and technical limits

Layout is device/browser-local, not synced or backed up on the server. A draft without a server deck ID keeps its layout in memory until its first successful deck save. Closing a page before the existing debounced deck save completes can still lose the latest content edit; the UI distinguishes deck save status from layout save status. Concurrent tabs and server-side layout synchronization are future work.

One visual card represents one existing deck entry, with a quantity badge. Individual basic-land copies cannot yet be arranged independently. Initial placement separates the commander from the remaining cards in two zones on fresh workspaces; existing placements are never automatically packed. Zone membership and initialization are stored alongside the existing version-1 layout, with a one-time migration of old geometric zones. Deleted zones are not recreated on reload. Piles may be formed by overlap, but named piles, spread/collapse, notes, undo, snapshots and advanced semantic zoom are deferred.

Existing categories are reused as role counts. There is no invented automatic draw/ramp/removal classification, new multi-tag model or mana-source analysis. Color identity totals are not presented as mana production. Historical V1 session-only cuts retain their existing V1 behavior; new V2 exclusions use persisted maybeboard rows.

Basic touch pointer dragging is available; multi-touch pinch and mobile ergonomics require a later pass. The DOM approach suits Commander deck sizes; substantially larger workspaces may need culling. Reconciliation preserves row positions across typical V1 edits, but merging duplicate name/category rows on the backend can collapse separate entries.

## Validation

- `npm test --prefix frontend`: 273 tests passed, including workspace round-trip, category reconciliation, commander/quantity restoration, stats separation, anchored zoom and invalid storage.
- `npm run build --prefix frontend`: passed.
- `scripts/deck-table-check.mjs`: Chromium scenario with an intercepted API fixture, leaving the real deck database untouched. Covers gestures (including Ctrl pan), membership, default zones, highlight before drop, bounds growth/shrink, free cards outside zones, analysis/search, V1/V2 switching, reload persistence, compact menu navigation and desktop/mobile viewport overflow. Desktop table height exceeds 90% of the viewport. Use `PLAYWRIGHT_MODULE` for an existing Playwright installation and `TABLETOP_URL` for the running frontend (default port 5186).

No commit was created. Browser fixtures validate frontend API integration; they do not replace a manual review with real decks and the live catalog.
