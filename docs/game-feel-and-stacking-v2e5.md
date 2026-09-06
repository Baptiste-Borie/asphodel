# V2e.5 — Summoning Sickness, Transitions, Slower Playback, and Card Stacking

Base: V2e.4 `f3236f1`.
Forge remains exactly `6356c1ad565029c82513c96e42ad5492c1b09c4e` (`git -C vendor/forge status --short` empty). **No rules logic, decision isolation, or Asphodel policy changed anywhere.** One small, deliberate addition was made to `forge-bridge/` (our own adapter code, never vendor Forge) — see §0.

## 0. One protocol addition: `token`

Section 17 requires "token/non-token status" as part of the stacking signature, and nothing in the existing protocol could answer that reliably (a token's `typeLine`/name looks identical to a real card of the same creature type). Forge itself already exposes exactly this via `Card.isToken()` (`vendor/forge/.../Card.java:1050`, untouched). `AgentObservationBuilder.java`'s `card()` method (our own bridge code) now also calls it: `AgentCardObservation` gained one additive field, `token?: boolean` (optional in TypeScript so no existing test fixture needed updating, matching the precedent set by `combatKeywords`/`selfAttackTriggers`). Presentation-only — never a rules input, never touched by anything Forge-side. Verified against a real game: a real Mountain now reports `"token":false` on the wire, and two Goblin tokens Krenko actually created reported `"token":true` with their own distinct cardRefs (`card-204`, `card-205`) — see §10.

## 14. Summoning sickness — visual, not just a badge

`tableCardClassName` (`card-view.ts`) now also sets `.table-card--summoning-sick` whenever `card.summoningSick === true` — independent of tapped/selected. The CSS treatment (`styles/tabletop.css`) is restrained: `filter: saturate(0.7) brightness(0.93)` (slight desaturation), a soft amber `box-shadow` ring, a slow (2.6s) low-intensity pulse via `@keyframes table-card-sick-pulse`, and one small supplementary corner dot (`::after`) — never the primary signal, never neon, never flashing. When sickness clears, the class is simply removed from the same, reused DOM element (see §15's reconciler), and the `filter`/`box-shadow` transition (420ms) already declared on `.table-card` fades it back smoothly — no separate "clearing" animation needed. `@media (prefers-reduced-motion: reduce)` disables only the `animation` (the pulse); the static desaturation/ring/dot stay, exactly as specified. Presentation only — Forge's own `summoningSick` field (unchanged, already existed) remains the sole legality authority; nothing here can make an illegal attack look legal or vice versa.

## 15. Card movement / state transitions

### The DOM-reconciliation problem

Every previous milestone's battlefield rendering called `container.replaceChildren()` and rebuilt every card element from scratch on every render. A CSS `transition` can only animate a property change on an element that **already existed** in its "before" state — a brand-new element has nothing to interpolate from. So V2e.5 introduces keyed DOM reuse:

- `createTableCard` (`card-view.ts`) gained an optional 4th parameter, `existingCardElement`. When supplied and shape-compatible (same button-vs-div tag, already a `.table-card`), the function updates and returns that **same** element instead of creating a new one. A stable, single click listener (wired once, ever, per element) reads its target `card`/`onActivate` from a small per-element state map that every render call refreshes — so a reused element never calls a stale closure.
- `board-renderer.ts`'s `renderCardRow` (used by both `renderBattlefieldHalf` and `renderCommanderDock`) reconciles by key: it looks up each incoming card/group's existing inner `.table-card` element (by a `data-key` attribute) before calling `createTableCard`, so an unchanged permanent's element persists across polls untouched in identity — only its class list (tapped, summoning-sick, selected, playable) and content change, which is exactly what makes the CSS transitions on those class changes actually animate.

### Enter / tap / untap

- **Card enters** (a new permanent, a new token): the reconciler has no existing element for that key, so it adds `.table-card--entering` (opacity 0, `scale(0.82) translateY(10px)`) to the freshly-created slot **before** inserting it, then removes the class on the next two animation frames (so the browser genuinely paints the "before" state first) — a ~220ms fade/scale/settle, "placed onto the table," no bounce.
- **Tap/untap**: `.table-card-slot--tapped .table-card { transform: rotate(90deg) }` was already the resting-state rule (V2e.3); the only change needed was bumping its `transition` duration from 140ms to 240ms (within the 200–300ms target) and reusing the element, so toggling the class now genuinely animates the rotation both ways, automatically, via the same CSS the browser already had.

No bouncing, no particle effects, no long animations — every duration above is a plain, restrained CSS `transition`/two-frame class toggle.

## 16. Slower Asphodel playback

`frame-playback.ts` now names the pacing explicitly:

```ts
export const OPPONENT_ACTION_DELAY_MS = 900; // a meaningful, narratable action (frame.event !== null)
export const OPPONENT_MINOR_DELAY_MS = 600;  // an intermediate visual-only step (frame.event === null, e.g. a mana tap)
```

`computePlaybackDelayMs(frame, remainingAfterThisFrame)` picks the base from whether the frame carries a narratable `event`, then still shrinks (with a 150ms floor) once the backlog grows past a handful of frames — preserved from V2e.3, since "the user must be able to follow" doesn't mean a 40-action backlog should take 40×900ms to catch up. This is **presentation-only**: `runHumanVsAgentMatch`, `BaselineAsphodelAgentV2b`, and Forge itself are completely untouched — the backend still executes and records decisions at full speed; only the frontend's frame-by-frame reveal is paced.

## 17 & 19. Identical permanent / token / land stacking

`card-grouping.ts`'s pure `groupCards(cards)` partitions a zone's cards by signature — `[name, tapped, summoningSick, power, toughness, sorted-counters, token-status]` — and returns `CardGroup { key, representative, cardRefs, count }`. **Every** underlying `cardRef` is retained in `cardRefs`; nothing is ever collapsed into a fake merged game object — the group is a display convenience only. This applies uniformly to creatures, tokens, and lands (there is no separate "land stacking" module — a land is just a card, and the exact same function groups `4 Forest` into one entry the same way it groups `4 Goblin Token`). `board-renderer.ts`'s `renderBattlefieldHalf`/`renderCommanderDock` call `groupCards` by default and pass each group's `count` into `createTableCard`, which renders a small "×N" badge (`.table-card-count`) only when `count > 1` — a single card never shows a redundant "×1".

Verified against a real game (not a fixture): Krenko's attack trigger created two real, distinct Goblin tokens (`card-204`, `card-205`), both `token: true`, `tapped: false`, `summoningSick: true`, `power/toughness: 1/1` — an identical signature that `groupCards` (12 passing unit tests, including this exact "two tapped/untapped split" and "token vs non-token" scenario) is proven to fold into one `Goblin Token ×2` stack.

Mana payment (§19's explicit exception) needed no change at all: `mana_payment` decisions were never something `describeDecision` gave a per-item `cardRef` to group by (see §18), and its decision-dock rendering (`decision-renderer.ts`, untouched since V2c) already lists each individual legal mana source as its own button — so "the underlying individual legal mana sources, not only a grouped count" was already true before this milestone and remains true now, regardless of how the battlefield itself groups lands visually.

## 18. Stack expansion for decisions

`hand-action-mapping.ts`'s V2e.4 hand-only helper was generalized (not duplicated): `mapActionsToCards(prompt, visibleCardRefs)` maps a menu decision's items to **any** supplied set of cardRefs, keyed by Forge's own `cardRef` — never merging by name, so two Goblin tokens or two Mountains always resolve to two independent map entries even mid-decision. `mapPriorityActionsToHand` is now a thin wrapper over it (hand-only, unchanged behavior). `describeDecision` (`human-decision-render.ts`) was extended to populate `MenuItem.cardRef` for every remaining card-object decision family it hadn't already covered in V2e.4: `target_selection` (a card target's own cardRef; `null` for a player target), `cost_object_selection`, `attackers_selection`/`blockers_selection` (`null` only for the "finish" option), `combat_order_selection`, and the generic `yes_no`/`object_selection`/`ordering_selection` (used for e.g. sacrifice/discard selections) — `mode_selection`/`value_selection`/`optional_cost_selection`/`mana_payment` still have no per-item card at all and correctly stay `undefined`.

`playtest-view.ts`'s `computeActiveMapping(state)` is the single place deciding, per decision: `priority_action` → map onto the human's own hand (unchanged V2e.4 behavior); any other menu decision → map onto **every currently visible cardRef on either player's battlefield or commander dock**. Whenever that mapping finds at least one match, `renderBattlefieldHalf`/`renderCommanderDock` are called with `expand = true`: every real card renders individually (one row per cardRef, `count` forced to 1) instead of grouped, so a stack is never accidentally submitted as one fake object. Each expanded card gets the same `.table-card--playable` highlight already used for hand cards, and clicking it submits its own exact mapped `AgentChoice` directly (one legal action) or opens the same contextual menu component used for multi-action hand cards (more than one). The moment the decision resolves into a different (or no) decision, `computeActiveMapping` naturally returns a fresh result on the next render — the board collapses back to grouped display with no extra state to track or reset. The action dock is filtered the same way as V2e.4 (`filterDockDecision`, unchanged logic, now fed whichever mapping is active): "Finish"/"Pass" and any action with no matching visible card stay in the dock; everything else moves to the board.

Verified against a real game: an actual `attackers_selection` decision arrived with `cardRef` populated on its "Add" options (confirmed via the running backend, not a fixture) — proving the whole chain (Forge → `describeDecision` → `mapActionsToCards` → expand-mode rendering) is wired against real decision data, not just unit tests.

## 20. Token count transition

`renderCardRow`'s reconciler (`board-renderer.ts`) reads the *previous* count-badge text off the reused element before re-rendering it; if a group's `count` changed since the last render, the badge (and only the badge — never the whole battlefield) gets a `.table-card-count--changed` class (`transform: scale(1.4)`, 260ms) removed again ~320ms later. A brand-new stack (first token of its kind) instead gets the normal card-entering transition (§15) rather than a count pulse, since there is no previous badge to compare against.

## Preserved

Fullscreen tabletop paradigm, commander dock, battlefield scale, hand size/hover, contextual hand-card menu, safe priority auto-pass, reports, Forge rules, Asphodel policy, Archidekt/import work, and every hidden-information guarantee are all unchanged.

## Tests

- **Backend**: no new test file — `human-decision-render.test.ts`'s existing cases were extended with `target_selection`/`attackers_selection`/`cost_object_selection` cardRef-propagation assertions (5 tests total now, was 2).
- **Frontend**: `card-grouping.test.ts` (new, 12 tests) — identical-tokens-group, identities never merged, tapped-state split, counter-differentiates, summoning-sickness-differentiates, power/toughness-differentiates, token-status-differentiates, land grouping (multiple names + a tapped split), group-order stability, re-grouping stability (stands in for "polling doesn't disturb it"), empty-zone. `card-view.test.ts` (+3) — summoning-sick class present/absent/null-treated-as-not-sick. `frame-playback.test.ts` (+1) — the two named constants and which frames get which delay. `hand-action-mapping.test.ts` (+1) — `mapActionsToCards` generalized beyond the hand, proven with a battlefield-shaped example.

## Validation

```sh
cd backend && npm run build && npm test                          # tsc clean; 148/148 pass
./scripts/forge-build.sh                                          # rebuilds the bridge jar with the new `token` field
./scripts/forge-test.sh                                           # 55/55 pass
cd ../frontend && npm test && npm run build                       # 69/69 pass; vite build clean
cd .. && git diff --check                                         # clean
git -C vendor/forge status --short                                # empty
git -C vendor/forge rev-parse HEAD                                # 6356c1ad565029c82513c96e42ad5492c1b09c4e
```

## Manual smoke test — honestly reported

No display and no browser-automation tool are available in this sandboxed session (checked again — none connected), so the 13-step visual walkthrough could not be literally clicked through pixel-by-pixel. What follows is what was verified for real against the actually-running `./scripts/dev.sh` servers (with the freshly rebuilt bridge jar), driving genuine Forge games via scripted `fetch` calls:

- **`token` field genuinely on the wire**: a real Mountain reported `"token": false`; two real Goblin tokens Krenko's attack trigger created reported `"token": true`.
- **Summoning sickness real data**: `summoningSick: true` observed on freshly-cast/created creatures in a live game.
- **Tapped lands real data**: real tapped lands observed in a live game (same underlying data the 90°-rotation CSS already had proven access to since V2e.3).
- **Identical-token stacking data**: two real Goblin tokens with an identical signature (name, tapped, summoningSick, power/toughness, token-status) and distinct cardRefs — exactly the input `groupCards` (12 passing tests) is proven to fold into `Goblin Token ×2`.
- **Stack-expansion decision data**: a real `attackers_selection` decision carrying `cardRef` on its options, confirming the expand-mode chain is wired against genuine Forge decisions.
- **Not literally verified**: the visual appearance of the summoning-sickness pulse/desaturation, the enter/tap/untap animations, the count-badge pulse, and the contextual menu's on-board appearance during a selection decision — these are grounded in the shipped CSS/DOM (readable from the diff) and the real data confirmed above, not a screenshot.
- A live `target_selection`/`cost_object_selection` decision carrying `cardRef` was not additionally observed this session (removal spells/sacrifice effects didn't come up in the games played) — covered instead by the backend's own unit tests using realistic fixtures (§18).

## Known limitations

- No literal browser screenshot (see above).
- Live `target_selection`/`cost_object_selection` expand-mode was verified via unit tests with realistic fixtures, not an additional live-game observation this session (only `attackers_selection` was directly observed live).
- The battlefield-overlap approximation noted in V2e.3 (a card that wraps to a new row can show a small cosmetic left-shift) is unchanged and still applies to grouped/expanded rendering alike.
- Expanded (ungrouped) cards during a selection decision do not show a distinct "already selected" indicator for combat objects Forge already has provisionally added (e.g. an attacker already declared) — clicking again would submit whatever "remove" option Forge offers for it, which is correct, but there is no separate visual cue distinguishing "already declared" from "not yet declared" beyond that. A deliberate scope trim, not an oversight.
- Physical library, camera, drag-and-drop, particle effects, sound, multiplayer, accounts, and any Forge/Asphodel policy change remain out of scope, as instructed.

## Verdict

Backend/Forge/frontend builds and tests are all green (148/148 backend, 55/55 Forge, 69/69 frontend), `git diff --check` and vendor Forge are clean at the pinned SHA, and every core data-plumbing claim (the new `token` field, summoning sickness, tapped lands, duplicate-token stacking inputs, cardRef-bearing combat decisions) was proven against real, live Forge games — not mocks. Given the honest caveats above (no literal pixel screenshot; target/cost-object expand-mode verified via unit tests rather than an additional live observation), the recommendation is: **GO for a first real human click-through**, focused specifically on confirming the summoning-sickness pulse, the enter/tap/untap animations, the token count badge, and the contextual stack-expansion menu's on-screen behavior — the claims resting most heavily on CSS/DOM review rather than live data.
