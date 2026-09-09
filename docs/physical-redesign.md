# Physical Companion redesign

## Audit and checkpoint plan

The frontend is TypeScript DOM rendering (Vite), not React. `playtest-view.ts` owns setup,
resume, polling, frame playback, submissions and completion/reports. The backend session
manager and Forge broker own decisions; `PhysicalCardProvider` supplies physical identities.
Backend-only auto-pass already accepts only an authoritative pass-only priority menu.

Reuse card presentation caching, board zone renderers, card inspection, action mappings,
physical declaration, mana payment/cancellation, frame playback and public-zone inspection.
Replace Physical's scaled two-seat composition with a player-ID keyed scene. Keep Digital's
composition and all engine/lifecycle contracts. Refactor presentation only.

Checkpoints (commit each after appropriate checks):
1. Layout foundation: scene, manual focus, count-aware layout, densities, stack drawer, dock shell.
2. Player boards and zones: complete live boards, hands, separate identity/commanders and piles.
3. Card states and stacking: conservative state equivalence, condensed artwork and exact identities.
4. Contextual interaction: direct Forge choices, safe keyboard pass, input/priority distinction.
5. Combat and movement: observable location/state transitions, existing Forge combat selections.
6. Art direction and polish: replaceable CSS courtyard environment, brass, calm play surface.
7. Regression fixes: unit/build and browser fixtures for both modes, focus, crowding, privacy, actions.

Risks: observation omits poison/energy/roles/commander damage and full combat relationships;
never invent those. Multiplayer presentation can accept multiple observations, but existing game
setup/engine is 1v1. No multiplayer engine changes. Commanders expose casts-from-command,
not a computed tax including arbitrary cost modifiers. Display the provided count accurately.
Unknown library identities cannot support identity-based draw animation; never guess them.

Initial Git worktree clean. No AGENTS.md found in ancestor paths or repository file listing.

## Delivered checkpoints and boundaries

- `physical-scene.ts` mounts one live board per observed player ID. Manual focus changes only
  density/layout. Two-player overview gives the opponent the primary board and the human a
  lower self-view; three gives opponents equal boards; four gives equal overview cells. Focus
  keeps every other seat live in previews. Backend setup remains 1v1.
- Shared board/card renderers supply nonland/land bands, public piles, command zones and hands.
  Physical uses condensed battlefield art and smaller lands. Digital retains its full board
  composition and interactive hand. Both use the overlay stack drawer and live public inspector.
- Commander cards never aggregate; per-card command-cast counts remain visible independently.
  Current legal costs are still the Forge action labels, not a frontend tax calculation.
- Grouping includes all observed state except card identity, canonically sorted. Hidden objects
  stay separate. Selection decisions expand exact identities; modified/tapped subsets split.
- Physical priority menus show exact actions directly. Mapped cards/players accept exact choices;
  ambiguous card actions retain the contextual menu and Cancel. Right-click inspection remains
  available independently of an actionable board card and never submits a choice. Keyboard Space requires the
  backend's new optional `control: 'pass'` hint and an idle live priority decision, with input,
  repeated-key, modifier and modal guards. Optional `playerId` forwards Forge's actual target.
  Existing backend auto-pass, physical declaration and mana-payment cancellation remain intact.
- Motion follows known card identities between observed zones and stack anchors, with a generic
  back when only the origin pile is represented. Tap/count effects, life deltas and Forge combat
  selection emphasis remain state-driven. Reduced motion is respected.
- `physical-courtyard.css` is a replaceable CSS environment separate from gameplay geometry.
  Stone grid, dark perimeter and aged-brass controls use no new image or runtime dependency.

Deliberately bounded: no camera, free placement, additional themes or multiplayer game creation.
No fabricated poison/energy/roles/commander-damage badges or full attacker/blocker relationships:
those fields are absent from the observation. Combat emphasis currently lasts only while Forge
supplies selected refs; a persistent combat graph requires a future authoritative contract.
Unknown library identities do not get guessed draw trajectories. Mana payment retains its
existing dedicated cancellable overlay. The scene is responsive but crowded rows scroll;
small screens and larger multi-seat views are not a substitute for a full desktop table.

Validation: frontend production build and backend typecheck; 149 frontend tests; 208 backend
non-Forge tests. Existing Digital browser checks cover Pass hit-testing, contextual/payment
Cancel, public piles, hidden hand, inspector, refresh resume, known zone move and reduced motion.
`scripts/physical-redesign-check.mjs` covers manual focus through live changes, 2/4-seat fixtures,
stack updates, keyboard pass, exact card/player target submissions, hidden DOM content, live
zone inspection, dual commanders, 32-token subsets, 12 additional lands, 20 other permanents,
1366px layout, refresh resume, reduced motion, combat selection, completion/report and setup.
Physical synthetic card tests stub presentation responses; visual screenshots with real cached
art were also inspected during development. No full real-Forge game or bridge integration suite
was run for this presentation change. Existing engine/setup/persistence code was not rewritten.
