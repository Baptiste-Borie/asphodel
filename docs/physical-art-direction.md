# Physical Companion — material art direction

Base: `9ae1f73` (Phyrexian commander legality regression coverage). Main pulled with
`--ff-only`; worktree initially clean. Engine, backend and previous commits remain intact.

Audit: structurally correct Physical renderer and manual densities, but flat green material,
plain inline life, undersized public piles, fixed 164px main cards on both resolutions, and a
142px full-width action footer. Declaration uses text slots and a full-width Confirm.

Plan/checkpoints: material scene; player seats/zones; battlefield density; global controls;
physical declaration; visual stress/regression. Keep gameplay choices and hidden-information
boundaries unchanged. Reuse existing renderers, inspector, action mappings and search widget.

Environment: original image generated with the built-in imagegen tool, not a commercial game
asset. `frontend/src/assets/environments/courtyard-slate.png` is the project copy (1672×941,
2.5 MB PNG, cached with the frontend build). Generation prompt is recorded alongside this document.
No new runtime dependency. Existing Magic art pipeline remains unchanged.
