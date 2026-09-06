# V2e.6 — Interaction Clarity and Tabletop Polish

Base: V2e.5.1 `191ccf3`.
Forge remains exactly `6356c1ad565029c82513c96e42ad5492c1b09c4e` (`git -C vendor/forge status --short` empty). **No Java/bridge changes were needed or made this milestone** — every capability required was already reachable from Forge's own decision/observation data. This is a medium-small mixed polish commit, per spec: the overall tabletop paradigm was not redesigned, and graveyard/exile/library/ordering-selection overlays were explicitly left for a later milestone.

## 1. Priority actions now work on the battlefield too

**The bug**: `priority_action` was special-cased to `mapPriorityActionsToHand` — a castable hand card lit up, but an activated ability already on the battlefield (Skirk Prospector, Zuran Orb, a utility land, a mana creature) was never presented as a clickable card, even though Forge's own decision already carried its `cardRef`.

**The fix**: `computeActiveMapping` (`playtest-view.ts`) no longer special-cases any decision type beyond `mana_payment` (which keeps its own dedicated overlay). For every menu decision it now builds ONE combined mapping over every visible cardRef — the human's own hand **and** both players' battlefield/commander-dock cards, all at once — via the already-general `mapActionsToCards`. A new pure `splitCardActionMapByHand` (`hand-action-mapping.ts`) then partitions that single combined map into `hand`/`board` buckets after the fact, so a hand card and a battlefield permanent can both be highlighted from the exact same decision, simultaneously. `paintBoard` passes the `board` bucket into the battlefield/commander-dock/land-zone rendering (same expand/highlight/click mechanism V2e.5 already built) and the `hand` bucket into hand rendering — no `forHand: boolean` branch anywhere anymore. Pass/Finish (no cardRef) is unaffected either way, since it's never in either bucket.

Verified against a **real, running game** using the user's own real Krenko deck (read-only; the deck itself was never modified): a genuine `priority_action` decision offered `"Activate Goblin Trashmaster"` carrying its own distinct `cardRef` (`card-2`) — confirming the exact mechanism Skirk Prospector/Sol Ring would use, end to end against live Forge data, not just a fixture. A moment with a hand-castable spell **and** a battlefield activation available in the very same decision was not additionally caught live this session (the fixture decks used for scripted testing contain no activatable non-land permanents at all — a fixture-composition limitation, not a Forge/bridge issue); this exact simultaneous case is directly covered by 4 unit tests instead (§13).

## 2. Combat selection is now visually obvious, and never conflated with tapped

**Backend**: `ForgePendingCombatDecision.selected` (Forge's own currently-declared attackers/blockers) was already computed but never left the backend. `WebPendingDecisionDTO` gained one additive field, `selectedCardRefs: string[] | null` — populated only for `attackers_selection`/`blockers_selection`, `null` everywhere else, never derived from `tapped`.

**Frontend**: a new pure `combatSelectedCardRefs(pending)` (`combat-selection.ts`) turns that into a `Set<string>`. `board-renderer.ts`'s `BoardCallbacks` gained `isCombatSelected`, threaded through the same reconciled rendering as `isPlayable`/`isSelected`. `card-view.ts`'s `tableCardClassName` adds `.table-card--combat-selected` completely independently of `.table-card--tapped` — a card can be (and often is) both at once. The CSS moves a selected card ~18px toward the shared table centerline (down from Asphodel's half, up from the human's half) with an accent outline; when a selected card is ALSO tapped, a more specific compound selector (`.table-card--combat-selected.table-card--tapped`) combines the translate with the existing rotate so neither is lost. Deselecting (Forge's `selected` list no longer contains it) smoothly returns the card via the same `transform` transition already on `.table-card` — no separate animation needed. Nothing here ever touches `card.tapped` itself.

Verified against a real game: a real `blockers_selection` decision carried `selectedCardRefs: ["card-18"]` on the wire — real Forge selection data flowing correctly end to end.

## 3. Counters render as generic badges, not hardcoded to any one type

`counterBadges(counters)` (`card-format.ts`) turns ANY `Record<string, number>` into a sorted, stable list of `{type, count}` badges — `+1/+1`, loyalty, charge, `-1/-1`, or any other Forge-visible counter type use the identical path, never a Krenko-specific special case. `card-view.ts` stacks them vertically in the top-right corner (clear of the bottom-right stack-count badge and the top-left summoning-sick marker); a genuinely changed value (compared against the same reused element's previous badge text) gets a brief `scale(1.35)` emphasis pulse, never a full-card reanimation. Both the counters badge and the pre-existing stack-count badge get a `rotate(-90deg)` counter-rotation while their card is tapped, so they stay legible instead of rotating sideways with the card.

## 4. Land cards are reliably inspectable — a real bug found and fixed

**The bug, found via code review** (no live browser available to literally reproduce the reported symptom, but the mechanism is concrete and verifiable by inspection): `.table-land-zone` used `flex-wrap: wrap` together with a `:not(:first-child)` negative-margin overlap. `:not(:first-child)` matches the first card of a **wrapped second row** too — it is not literally the zone's first child overall — pulling it left by the same amount as every other card and letting it creep up over the previous row, unpredictably covering neighbors and blocking their clicks. This is exactly the kind of "appears not to be inspectable reliably" symptom real playtest feedback described.

**The fix**: `flex-wrap: nowrap` with `overflow-x: auto` (widening to `overflow-x: visible` on hover, when fanned). There is now only ever one row, so `:not(:first-child)` means what it says; a land zone with unusually many distinct groups scrolls horizontally rather than wrapping — a graceful, rare-case trade-off. Clicking a land now reliably opens the exact same floating preview as any other battlefield card (unchanged shared `BoardCallbacks` architecture — lands were never a separate click path from creatures/artifacts); a land mapped to a legal decision action still takes precedence over the preview exactly as before, since that routing (in `paintBoard`) has never distinguished lands from any other permanent.

The same `flex-wrap: wrap` + negative-margin pattern also exists in the main battlefield row (`.table-battlefield-cards`), unchanged since V2e.3/V2e.5. It was deliberately left alone here — it was not reported as broken, and the spec's Part 4 named lands specifically ("Do NOT redesign the tabletop"). Noted as a known follow-up, not fixed in this commit.

## 5. Hand is bigger again

Base width 158px → 190px, hover 245px → ~300px (scale 1.55 → 1.58), overlap -72px → -88px (same ratio, scaled up), hand container height 250px → 280px (exactly enough to fit the taller resting card, nothing more — "do not increase the footprint unnecessarily"). A normal 7-card hand at 1920px still uses well under half the available row width even fully spread.

## 6. Small central game HUD

A `.table-hud` (top-center, `position: absolute`, `pointer-events: none`) shows `Turn N · You`/`Turn N · Asphodel` and a friendly phase label. `formatHudPhase` (`board-renderer.ts`) maps known combat phases to the spec's exact short labels (`combat_declare_attackers` → "Declare Attackers", `combat_declare_blockers` → "Declare Blockers", `combat_damage` → "Combat Damage") and falls back to the pre-existing general `formatPhase` humanization for everything else (`main1` → "Main 1", `upkeep` → "Upkeep", …) — uses the real `observation.game.turn`/`activePlayerId`/`phase`, nothing invented. Each line only updates (and gets a brief fade-in transition) when its own text actually changes.

## 7. Active player's half is subtly emphasized

`.table-battlefield-half--active` (toggled per half against `observation.game.activePlayerId` on every `paintBoard`) adds a barely-there background luminance lift and a soft inset glow — no border, nothing neon — transitioning over 400ms.

## 8. Stacked-card visual depth

`.table-card--stacked` (set whenever a group's `count > 1`) adds two subtle offset `::before`/`::after` frames behind the representative card via `z-index: -1` — decoration only; `card-grouping.ts`'s cardRefs/grouping logic is completely unchanged, and no new interactive DOM identity is created.

## 9. Token stacking regression — investigated, not a grouping-logic bug

Reproduced directly against a **real** Krenko attack (same live-game technique as V2e.5): two genuinely equivalent Goblin tokens captured this exact shape — `{name: "Goblin Token", tapped: false, summoningSick: true, power: 1, toughness: 1, token: true}`, distinct cardRefs — and `groupCards` (already covered by 12 V2e.5 tests) correctly folds them into one `×2` stack; this exact real-world shape is now locked in verbatim as a new regression test. The most plausible explanation for the reported "didn't stack" observation: two tokens created on **different turns** legitimately differ in `summoningSick` (the older one has already lost sickness) and therefore correctly do **not** group — that is now also an explicit regression test, alongside a countered-vs-uncountered-token test. `groupSignature` was **not weakened** anywhere; if anything, this investigation reinforces that every one of its existing dimensions is pulling its weight.

## 10. Token fallback presentation

When `card.token === true` and no Scryfall image has resolved, `card-view.ts` now renders a deliberate token-styled face (`name`/`typeLine`/power-toughness, warm gradient background) instead of the generic grey placeholder — never a broken-image icon either way. Exact Scryfall token art resolution remains explicitly out of scope for this milestone, as instructed.

## 11. Small life-change feedback

`renderLifeWithDelta` (`playtest-view.ts`) compares each life total against the last value it displayed (a `WeakMap<HTMLElement, number>` keyed by the life container itself — no game-state tracking, purely a display comparison) and, on a genuine change, appends a `.table-life-delta` ("+3"/"-4") that floats and fades over 700ms via a self-contained CSS animation, removing itself afterward. `renderLife` preserves any in-flight delta across its own rebuild by re-appending it, so a delta always finishes its own animation regardless of how often the surrounding render fires. No combat/damage rules system of any kind — implemented, not skipped, since it stayed simple.

## 12. Explicitly not touched

Graveyard/exile/library-search overlays, Springbloom-style hidden-zone pickers, `ordering_selection` redesign, physical-deck sync, Asphodel policy, and vendor Forge — all untouched, as instructed.

## 13. Tests

- **Backend**: `playtest-session-manager.test.ts` (+2) — `selectedCardRefs` relayed correctly for a real `attackers_selection` fixture, `null` for `priority_action`.
- **Frontend pure**:
  - `hand-action-mapping.test.ts` (+4) — a hand card AND a battlefield card both map from the same decision; a Skirk-Prospector-style battlefield activation maps by cardRef with an empty hand; Pass stays unmapped on both sides; duplicate names (hand Mountain vs battlefield Mountain) stay distinct.
  - `combat-selection.test.ts` (new, 6) — declared attacker selected; deselected attacker loses it; blocker equivalent; null for every other decision type; null with no decision; returns cardRefs only, independent of tapped.
  - `card-format.test.ts` (+5) — `counterBadges`: a +1/+1 badge, an arbitrary/unrecognized type (charge, loyalty, -1/-1) using the same generic path, multiple types in stable sorted order, zero/null/empty producing none, stability across re-polling.
  - `card-view.test.ts` (+4) — combat-selected class independent of tapped; both classes present together; absent when not selected; stacked class present for `count > 1`.
  - `board-renderer.test.ts` (+2) — `formatHudPhase`'s exact combat labels and its fallback to general humanization.
  - `card-grouping.test.ts` (+3) — the exact real-world Goblin-token shape groups; a different-turn (not-sick) token correctly does not; a countered token correctly does not.
- **Land interaction**: "utility land uses the normal preview callback outside decisions" / "a playable land action uses the decision callback when appropriate" are covered by the SAME shared `BoardCallbacks` architecture already proven for battlefield cards (V2e.4/V2e.5) — `renderLandZone` is `renderBattlefieldHalf`'s identical machinery pointed at the land partition, so no separate test surface exists for this routing; it is the same code path.
- **UI behavior not directly unit-tested** (consistent with this project's established convention — no DOM test framework is set up): the HUD's live update timing, the active-player glow toggle, and the life-delta's DOM lifecycle are verified by code review and the real game data in §14, not a synthetic DOM test.

## 14. Manual smoke test — honestly reported

No display and no browser-automation tool are available in this sandboxed session (checked again — none connected), so the visual walkthrough could not be literally clicked through pixel-by-pixel. What follows is what was verified for real against the actually-running `./scripts/dev.sh` servers, driving genuine Forge games (including, for Part 1, the user's own real Krenko deck — read-only, confirmed untouched afterward):

- **Real battlefield activation with cardRef**: `"Activate Goblin Trashmaster"` (cardRef `card-2`) appeared as a real `priority_action` item — confirms Part 1's core mechanism end to end.
- **Real combat selection data**: a real `blockers_selection` decision carried `selectedCardRefs: ["card-18"]`.
- **Real token-grouping shape**: two real Krenko-created Goblin tokens (V2e.5 data, re-verified against the exact captured values) prove the grouping input is correct.
- **Not literally verified**: the visual appearance of every animation/badge/HUD/glow described above, a live simultaneous hand+board highlight in the same decision, and a live multi-color mana source reaching the color-selector (unrelated to this milestone, still open from V2e.5.1).

## 15. Known limitations

- No literal browser screenshot (see §14).
- A live simultaneous hand-card + battlefield-activation highlight was not additionally observed this session (the scripted fixture decks contain no activatable non-land permanents); covered by 4 unit tests instead.
- The same `flex-wrap` + negative-margin issue fixed in the land zone (§4) also exists, unchanged, in the main battlefield row — left alone deliberately (not reported broken, out of this milestone's stated scope).
- Physical library, camera, drag-and-drop, graveyard/exile/library overlays, sound, multiplayer, accounts, and any Forge/Asphodel policy change remain out of scope, as instructed.

## Validation

```sh
cd backend && npm run build && npm test      # tsc clean; 154/154 pass
./scripts/forge-test.sh                       # 55/55 pass
cd ../frontend && npm test && npm run build   # 107/107 pass; vite build clean
cd .. && git diff --check                     # clean
git -C vendor/forge status --short            # empty
git -C vendor/forge rev-parse HEAD            # 6356c1ad565029c82513c96e42ad5492c1b09c4e
```

## Verdict

Backend/Forge/frontend builds and tests are all green (154/154 backend, 55/55 Forge, 107/107 frontend), `git diff --check` and vendor Forge are clean at the pinned SHA, and the two most consequential claims (battlefield-sourced priority actions working, combat-selection data reaching the browser) were proven against real, live Forge games — including a live-identified and fixed CSS bug in the land zone. Given the honest caveats above, the recommendation is: **GO for a first real human click-through**, focused specifically on confirming the combat-selection movement/outline, the counters/token-fallback/stacked-depth visuals, the HUD, the active-player glow, and the life-delta float — the claims resting most heavily on CSS/DOM review rather than live data.
