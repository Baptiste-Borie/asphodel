# Physical Companion visual V2

## Final art direction

The user's supplied **Ruines anciennes sous les eaux turquoise.png** is used unchanged as
`frontend/src/assets/environments/turquoise-ruins.png`. The CSS preserves its bright water and
illustrated ruins, with only a light peripheral shade. No image generation or retouching was
used on this asset. This supersedes the generated cloister drafts and the earlier literal table.
The source image is unchanged in Downloads. The old committed courtyard asset is retained but
no longer loaded by the runtime.

## Presentation

- Dark teal player plaques, ivory labels and brass edges provide contrast locally rather than
  darkening the entire image. The human digital twin has a solid framed surface and compact zones.
- Connection labels report successful polling, playback or a caught connection failure, never
  an inferred physical synchronization status.
- Physical hover opens a temporary right rail; right-click or the rail's Pin control pins it.
  Moving off a transient card restores any pinned selection. Escape/Close dismisses it.
  Pinned inspection reserves space; transient inspection overlays without moving the source.
  Current state refreshes from the displayed observation. Existing direct legal board clicks remain.
- Stats, quantity, counters and keyword glyphs have different shapes and treatments. Three glyphs
  remain visible with `+N` overflow; immediate viewport-clamped tooltips and the full inspector list
  explain statuses. Existing SVG vocabulary is retained. Keyword explanation reference:
  https://magic.wizards.com/en/keyword-glossary
- `basePower`/`baseToughness` are optional display fields from the bridge's current card face.
  Numeric printed values are compared independently against Forge's net values. Variable printed
  values (`*`, `1+*`) have no invented numeric reference and remain neutral. No layers are evaluated
  in the frontend. Concealment clears the additional fields.
- Physical frame playback awaits major phase presentation (2.1 seconds), visible stack-card
  reveals (3.5 seconds, including instants), and arrival settlement (650 ms). Click or Escape skips
  a reveal. Minor frames retain the existing short pacing. Human decisions remain hidden while
  playback is active; Digital retains its normal queue timing and printed-card inspector.

## Verification and limits

Frontend/backend builds, 186 frontend tests, the four physical redaction tests and two focused
Forge printed-stat tests pass. The bridge package build completed with its existing 19 Java tests.
Browser art checks cover normal, inspection, dense boards, partners, 3/4-seat focus and declarations
at 1366×768 and 1920×1080. Digital browser checks pass. These are deterministic browser fixtures;
the real-art run uses actual presentation images, not a live complete Forge match.
The updated Physical polish browser checks also pass: mixed P/T colors, glyph overflow,
tooltips, hover/pin/restore, live state refresh, pinned rail/twin separation and a queued instant
whose reveal delays subsequent frames and the human decision until skipped or complete.

The inspector scrolls when all state explanations cannot fit vertically. A transient inspector can
cover content underneath it; pinning makes room. Variable printed P/T remains deliberately neutral.
Motion uses only observed identities and locations, so unobserved stack events cannot be reconstructed.
The image is 2.49 MB; no slow-network benchmark was performed.

Screenshots: [normal, real art](visuals/physical-v2/normal-1920.png),
[inspection, real art](visuals/physical-v2/inspection-1366.png),
[dense board](visuals/physical-v2/stress-1366.png).

Reproduction: Vite on 127.0.0.1:5173; backend on 3000 for real card art. Use
`scripts/physical-art-check.mjs` with `CONFORMANCE_REAL_ART=1` and
`scripts/physical-polish-check.mjs` for state and playback checks. Set `PLAYWRIGHT_MODULE`
to the installed Playwright module path when it is not installed in this workspace.
