# V2e.4 — Enlarge Hand and Make Playable Cards Interactive

Base: V2e.3 `c1f5798`.
Forge remains exactly `6356c1ad565029c82513c96e42ad5492c1b09c4e` (`git -C vendor/forge status --short` empty). **No rules logic, decision isolation, Asphodel policy, or vendor Forge changed.** Only the human's own `priority_action` interaction changed; every other decision family (target selection, modes, mana, combat, …) renders exactly as before.

## 1. Hand size

`.table-card--hand` grew from 124px → 158px base width (within the 150–165px target), and the hover transform now scales to 1.55× (~245px, within the 230–260px target) instead of 1.7×/~211px. Overlap grew proportionally (`margin-left: -72px`, up from -56px) so the same relative fan-tightness is preserved at the bigger size — a typical Commander hand (7–10 cards) still fits comfortably in the row (the available width per the existing side padding leaves far more headroom than the overlap actually needs, even for 10 cards). Hover behavior is unchanged in kind (rise, scale, raised z-index, one fast CSS transition) — only the numbers moved.

## 2. Card-directed priority actions

### Backend: relaying Forge's own cardRef

`ForgeExternalAction` (the raw Forge decision) already carries `cardRef` for every non-pass action — this was always there, just never relayed into the rendered menu. `MenuItem` (`human-decision-render.ts`) gained one additive field, `cardRef?: string | null`, populated **only** for `priority_action` items (`null` for "Pass priority", Forge's own `a.cardRef` for everything else); every other decision family's `describeDecision` case is untouched, so their `MenuItem`s simply leave `cardRef` `undefined` — verified with a dedicated test. This is a pure relay of data Forge already computed; nothing about legality is decided or re-derived here.

### Frontend: a pure mapping layer, never guessing legality

`hand-action-mapping.ts`:

```ts
mapPriorityActionsToHand(prompt: DecisionPrompt, hand): { byCardRef: Map<string, MenuItem[]>; unmapped: MenuItem[] }
decidePriorityCardAction(items: MenuItem[]): { kind: "submit"; choice } | { kind: "menu"; items }
```

`mapPriorityActionsToHand` keys **only** by Forge's own `cardRef` — never by card name — so two hand cards sharing a name (two Mountains) map to two independent map entries. Verified against real Forge data mid-session: a hand containing `{cardRef:"card-87","Mountain"}` and `{cardRef:"card-61","Mountain"}` produced two separate `"Play Mountain"` actions with exactly those two distinct cardRefs; submitting the action tied to `card-87` played that specific land, and the OTHER Mountain remained in hand, unaffected. An action whose `cardRef` isn't a card currently in the human's own hand (a battlefield-sourced ability, or simply `null` for "Pass priority") always lands in `unmapped` instead — the sole authority for what counts as "legal" is still Forge's `actions`/`targets` array; this function only ever partitions items that already came from there.

`decidePriorityCardAction` is the click-behavior decision, made pure and independently testable: exactly one legal action for a card → submit it directly; more than one → return the exact list for a contextual menu, in Forge's own order, never collapsed or reordered.

### Rendering

`board-renderer.ts`'s `renderHand` gained an optional `HandActionCallbacks` (`isPlayable`, `onActivate`) — supplied by `playtest-view.ts` only while a `priority_action` menu decision is genuinely showing (never during Asphodel's frame playback, never for any other decision type). A playable card gets `.table-card--playable` (accent border + one soft `box-shadow` ring — no blur/glow) and becomes a real `<button>` (via `createTableCard`'s existing `onActivate` → button-vs-div behavior, reused unchanged); a non-playable card is completely untouched. `createTableCard`'s `onActivate` now also passes the clicked element itself (additive parameter — every existing caller that ignores the second argument keeps working unmodified), so a click can anchor the new contextual menu (`hand-action-menu.ts`, a small floating panel positioned from `getBoundingClientRect()`, closing on Escape/outside-click/selection — the same interaction pattern already used for the "⋮" menu and the card preview) right above the card that was clicked.

## 3. Action dock

`playtest-view.ts`'s `filterDockDecision` builds a shallow-copied `WebPendingDecisionDTO` whose `rendered.items` is replaced with `mapping.unmapped` — **only** for a `priority_action` menu decision; every other decision type is passed through completely unchanged (`decision-renderer.ts` itself was not touched at all). Since "Pass priority" always has `cardRef: null`, it is structurally guaranteed to remain unmapped and therefore always stays in the dock — no special-casing needed. Title and context line are untouched (only the item list is filtered).

## 4. Playable card mapping — duplicates, stability

Directly covered by `hand-action-mapping.test.ts` (9 tests): a card with one legal action is playable and maps to it; a card with none is absent from `byCardRef`; two same-named cards map to two independent entries by cardRef; "Pass priority" and an unmatched-cardRef action both stay in `unmapped`; a `"value"` prompt (X spells) is left untouched, per scope; calling the mapping again with unchanged inputs (simulating a re-poll) yields the identical result — nothing spontaneously loses its playable status.

## 5. Other decisions — untouched

`decision-renderer.ts` was not modified. After clicking a playable card that leads into `target_selection` (e.g. casting Putrefy), the very next decision is no longer type `priority_action`, so `computeHandMapping` returns `null` for it — hand cards immediately stop being highlighted/clickable, and the dock renders the full, unfiltered target-selection menu exactly as before. This falls out of the existing type check with no special-casing.

## 6. Tests

- **Backend** (`human-decision-render.test.ts`, 2 new): `cardRef` correctly relayed for card-backed priority actions and `null` for pass, including two same-named cards keeping distinct refs; a non-`priority_action` decision's items leave `cardRef` `undefined` (proving this patch really didn't touch them).
- **Frontend** (`hand-action-mapping.test.ts`, 9 new): every bullet in the spec's test list — playable/non-playable, one-action-submits, two-actions-opens-menu (via the pure `decidePriorityCardAction`), duplicate-same-name-by-cardRef, Pass stays in dock, an unmapped (no-matching-hand-card) action stays in dock, and the repeat-call-stability test standing in for "polling does not remove a playable highlight incorrectly" (board-renderer/paintBoard are DOM-only and untestable without a browser, per this project's existing convention — see V2e.1–V2e.3 docs — so the underlying pure decision this rendering is driven by is what's tested directly).

## 7. A pre-existing test-runner gap, found and fixed

While validating this milestone, `backend/package.json`'s `"test"` script (`tsx --test src/*.test.ts`) turned out to be **non-recursive** — it silently never ran anything under `src/human/`, `src/cards/`, `src/decks/`, `src/agent/`, etc. This meant V2e.3's `public-game-frame.test.ts` (created under `src/human/`) was never actually exercised by the documented `npm test` command, only by ad hoc direct invocations during that session — the tests themselves were correct and passing, but the "138/138" figure reported in V2e.3's doc did not include them. Fixed here: `"test": "tsx --test $(find src -name '*.test.ts' -not -path 'src/forge/*')"` — recursively finds every unit test file while still excluding the slow Forge/Java integration tests (`src/forge/*.integration.test.ts`, which keep their own dedicated `test:forge-bridge` script / `forge-test.sh`). Backend now genuinely runs 145 tests (138 + the 2 V2e.3 tests that were silently skipped + this milestone's own new tests), all passing.

## 8. Preserved

Fullscreen tabletop paradigm, commander dock, battlefield scale, tapped rotation, floating preview, opponent action playback, safe priority auto-pass, reports, Forge rules, Asphodel policy, Archidekt/import work, and every hidden-information guarantee are all unchanged.

## 9. Validation

```sh
cd backend && npm run build && npm test      # tsc clean; 145/145 pass
./scripts/forge-test.sh                       # 55/55 pass
cd ../frontend && npm test && npm run build   # 52/52 pass; vite build clean
cd .. && git diff --check                     # clean
git -C vendor/forge status --short            # empty
git -C vendor/forge rev-parse HEAD            # 6356c1ad565029c82513c96e42ad5492c1b09c4e
```

## 10. Manual smoke test — honestly reported

No display and no browser-automation tool are available in this sandboxed session (checked again — none connected), so the visual walkthrough (hand size, border highlight, hover enlargement) could not be literally clicked through pixel-by-pixel. What follows is what was verified for real against the actually-running `./scripts/dev.sh` servers, driving a genuine Forge game via scripted `fetch` calls:

- A real hand containing **two actual Mountains** (`card-87`, `card-61`) produced exactly the scenario the spec describes: two `"Play Mountain"` menu items with distinct `cardRef`s, `"Pass priority"` with `cardRef: null`.
- Submitting the exact `AgentChoice` tied to `card-87` played that specific land (confirmed via the resulting battlefield); `card-61` remained in hand, structurally distinct and unaffected — proving cardRef-based (not name-based) identity works against real Forge data, not just fabricated fixtures.
- On the next turn, `card-61` correctly became playable again (a fresh land drop) — its own new, distinct `"Play Mountain"` action, correctly re-mapped.
- **Not literally verified**: the visual hand size increase, the border/box-shadow highlight, and the contextual menu's on-screen appearance/position — these are grounded in the shipped CSS/DOM (readable from the diff) and the real cardRef data confirmed above, not a screenshot.

## 11. Known limitations

- No literal browser screenshot (see §10).
- The contextual multi-action menu's exact on-screen anchoring was not visually confirmed this session (DOM/CSS reviewed, `getBoundingClientRect()`-based positioning is straightforward but untested pixel-for-pixel).
- Only the first card-based priority-action interaction was replaced, exactly as scoped; target/mode/mana/combat decisions are unchanged.
- Physical library, camera, drag-and-drop, animations, sound, multiplayer, accounts, and any Forge/Asphodel policy change remain out of scope, as instructed.

## 12. Verdict

Backend/Forge/frontend builds and tests are all green (145/145 backend — now genuinely including every unit test file after fixing the test-runner glob gap — 55/55 Forge, 52/52 frontend), `git diff --check` and vendor Forge are clean at the pinned SHA, and the core cardRef-based duplicate-card claim was proven against real Forge data (two real Mountains, correctly and independently playable). Given the honest caveat in §10 (no literal pixel screenshot), the recommendation is: **GO for a first real human click-through**, focused specifically on confirming the hand's new size/hover feel and the contextual menu's on-screen placement — the two claims resting on CSS/DOM review rather than live data.
