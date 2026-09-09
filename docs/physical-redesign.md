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
