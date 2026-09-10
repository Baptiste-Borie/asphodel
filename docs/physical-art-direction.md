# Physical Companion — material art direction

Base: `9ae1f73` (Phyrexian commander legality regression coverage). Main was pulled
with `--ff-only`; the initial worktree was clean. No previous commit was amended.
`git diff 9ae1f73 -- backend forge-bridge` is empty: engine, contracts and preceding
legal-action fix remain intact. No push is part of this pass.

## Audit and resulting visual system

The existing architecture already separated Physical from Digital, maintained manual
Overview/Focus, rendered state-aware groups and used exact Forge choice references.
The weaknesses were visual: a flat green surface, inline life text, tiny public piles,
fixed main card sizes, a wide action footer and text-only declaration slots.

The new scene uses neutral slate, aged bronze, contact shadows and an original stone
courtyard perimeter. The center remains calm; card artwork provides the strong colors.
The environment still reads as a place when the battlefield is empty. Material rules
are split between scene geometry, seat objects, card frames, controls and declaration.
Superseded Physical control and zone overrides were removed from `physical-scene.css`.
Shared Digital styling was retained.

- **Seats:** `player-seat.ts` owns a life dial and name plaque. Active turn accents the
  dial; priority has a separate small marker; human input is signaled by the decision
  tray. Raw `External Player N` placeholders get readable names; custom names survive.
  Focus remains manual. Life remains attached to its player, not a commander.
- **Density:** primary cards grow responsively from 164 to 230 px; at 1366 they measure
  177.6 × 149.2 px. Lands measure 73.8 × 67 px there. Preview cards remain condensed
  at 66 px, with 40 px life dials. Four-seat overview retains independent quadrants;
  focus keeps the other three seats mounted and live below the main board.
- **Cards:** material frames, compact captions, raised P/T, layered group edges and
  upright count/counter badges. Group quantity and P/T have separate positions,
  including when tapped. Existing grouping keys and 90-degree rotation are unchanged.
  Dense nonland bands scroll horizontally rather than hiding or merging distinct states.
- **Zones:** stronger overlapping hand backs, deliberate hover expansion for the known
  human hand, 62 px commander cards and larger layered public piles. Partner cast
  counts remain independent. Unknown hands still expose only card backs and a count.
- **Controls:** an engraved central turn/phase HUD, stack drawer, quiet Recent Actions,
  lighter focus controls and a content-sized action tray. At 1366 the simple tray is
  68 px high, with 16 px clearance below the self preview. The inspector is constrained
  to the viewport; opening it never submits an action.
- **Declaration:** a lower-middle hand tray with seven tilted slots, the next slot
  highlighted, compact search, selected card images, individual removal and local
  Clear selection. Confirm only enables at the required count and sends the same
  `physical_identity` payload. Art is requested only for the user's selected names;
  failed image requests retain the text fallback. Search now exposes listbox/option
  semantics and its active descendant for keyboard assistive technology.
- **Motion:** existing observed zone movement, tap, group/counter changes and combat
  selection remain. Added restrained 180–200 ms drawer/slot transitions respect
  reduced motion. There is no ambient animation, fabricated trajectory or new combat
  relationship model.

## Main implementation files

- `frontend/src/playtest/player-seat.ts`, `physical-scene.ts`
- `frontend/src/playtest/physical-declare.ts`, `card-search.ts`, `playtest-view.ts`
- `frontend/src/styles/physical-courtyard.css`, `physical-scene.css`, `physical-seat.css`,
  `physical-cards.css`, `physical-controls.css`, `physical-flows.css`
- `scripts/physical-art-check.mjs`, `scripts/physical-conformance-check.mjs`

## Original environment asset

Generated with the built-in imagegen tool, not extracted from a commercial game.
The project asset is
[`courtyard-slate.png`](../frontend/src/assets/environments/courtyard-slate.png)
(1672 × 941, 2.6 MB PNG). The [exact generation prompt](physical-environment-prompt.txt)
is saved separately. Vite fingerprints the asset for caching. No runtime dependency
was added. Magic artwork still comes through the unchanged presentation pipeline.

## Visual evidence

All screenshots below are actual Chromium renders of the application. Game routes
use deterministic browser fixtures; the art pass uses the real local backend card
presentation endpoint and card images. These are not screenshots of a live Forge match.

| State | 1366 × 768 | 1920 × 1080 |
| --- | --- | --- |
| Baseline | [Before](visuals/art-direction/before-1366.png) | [Before](visuals/art-direction/before-1920.png) |
| Normal table / action / hidden hand | [After](visuals/art-direction/normal-1366.png) | [After](visuals/art-direction/normal-1920.png) |
| Printed inspection | [Inspection](visuals/art-direction/inspection-1366.png) | [Inspection](visuals/art-direction/inspection-1920.png) |
| Commander stress | [Stress](visuals/art-direction/stress-1366.png) | [Stress](visuals/art-direction/stress-1920.png) |
| Declaration partly filled | [Hand](visuals/art-direction/opening-picked-1366.png) | [Hand](visuals/art-direction/opening-picked-1920.png) |
| Declaration ready / empty | [Ready](visuals/art-direction/opening-ready-1366.png) | [Empty](visuals/art-direction/opening-empty-1920.png) |

Additional captures: [stack](visuals/art-direction/stack-1920.png),
[three-seat overview](visuals/art-direction/three-overview-1920.png),
[four-seat overview](visuals/art-direction/four-overview-1920.png),
[four-seat focus](visuals/art-direction/four-focus-1920.png).

Stress fixtures contain 16 lands, 32 Goblins split by tap/counter state, 12 other
nonland permanents with distinct counters, two commanders with separate cast counts,
17 hidden hand cards, 20 graveyard cards and nonempty exile.

## Validation actually run

- `npm run build --prefix frontend`: TypeScript and Vite pass. Final bundle: 65 KB JS,
  64.3 KB CSS before compression, plus the separate original environment asset.
- `npm test --prefix frontend`: **151 passed, 0 failed**. Includes exact grouping,
  action mapping, declaration multiplicity, hidden/face-down art and observed motion.
- `scripts/physical-conformance-check.mjs`: passes setup/resume, real-art condensed
  rendering, life/commander/pile geometry, card/land proportions, manual focus and
  Digital isolation. The former fixed footer clearance check now compares the actual
  preview bottom with the actual dock top; it still rejects collisions.
- `scripts/physical-redesign-check.mjs`: passes live preview, manual focus/overview,
  stack updates, keyboard pass, exact card/player targets, four seats, hidden info,
  public-zone inspector, crowded groups, dual commanders, resume, reduced motion,
  combat selection, completion/report and setup.
- `scripts/tabletop-visual-check.mjs`: Digital passes pass-button hit testing,
  contextual and Forge payment cancellation, piles, hidden-hand count, inspector/
  Escape, keyboard hand focus, F5 resume, confirmed land movement, reduced motion and
  1366 px overflow checks.
- `scripts/physical-art-check.mjs`: captures the matrix above and asserts compact dock,
  full inspection card on screen at both resolutions, stack quantity/P-T separation,
  partners, seats, search/edit/reselect and exact seven-card declaration submission.
  No browser page errors.

Reproduce with Vite on `127.0.0.1:5173`, backend on its configured local port and an
installed Playwright Chromium. Set `PLAYWRIGHT_MODULE` to the local Playwright module;
set `TABLETOP_URL=http://127.0.0.1:5173` for the older browser scripts. Set
`CONFORMANCE_REAL_ART=1` for conformance/art captures with real presentation art.
The art script writes `/tmp/asphodel-art` by default, or `ART_OUTPUT_DIR` if supplied.

Backend/Forge suites were not rerun because neither backend, bridge nor shared
contracts changed. The preceding gameplay regression commit is preserved.

## Known limits

Desktop is the validated target; mobile is not a newly supported layout. Dense bands
require horizontal scrolling, and preview metadata is intentionally smaller: focus
or card inspection provides detail. The environment adds a 2.6 MB first-load image;
no slow-network performance benchmark was run. Card art requires the existing network
pipeline and can fall back to text. The observation does not expose player resource
summaries or a complete attacker/blocker relationship graph, so no poison/energy or
commander-damage totals and no invented combat links were added. Browser validation
covers fixture-driven UI behavior, not an end-to-end live Forge game.

## Checkpoints

- `de79333` — `Physical art: slate courtyard and material tokens`
- `db672eb` — `Physical art: player seats, cards and contextual trays`
- The final evidence checkpoint is `Physical art: visual regression coverage and review`;
  its hash is reported in the delivery message (this document belongs to that commit).
