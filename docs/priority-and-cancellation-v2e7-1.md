# V2e.7.1 — priority clicks and action cancellation

The transparent hand container shared the decision dock's stacking level and was painted after it. Its empty area could intercept clicks on Pass priority. The dock now sits above that area, while individual hand cards retain pointer interaction. A completed or rejected submission can repaint the same decision, and duplicate in-flight submissions are ignored.

Card action menus now have an explicit Cancel button. Opening clicks no longer immediately bubble into the outside-click closer. Outside clicks are handled in capture phase, and mana color menus sit above the payment overlay.

Payment cancellation is a real Forge choice, supplied as an optional `cancelChoiceId` on the pending mana decision. It is separate from mana-producing options, so the frozen agent policy and mana selection remain unchanged. Both the web provider and human runner validate the exact cancellation ID against the current decision. Old bridges expose no fabricated cancellation button.

The bridge returns `false` through Forge's native payment path when this choice is selected; Forge performs its own rollback/refund. The browser neither untaps cards nor returns them to hand itself. The button is available during external mana payment; it is not an undo after an action resolves. Context-menu Cancel simply dismisses an action/color menu before a choice has been submitted.

A real Complicate cycling test pays one mana source, cancels, and verifies the same cardRef remains in hand, no card is drawn or discarded, sources regain their original tapped states, cycling is available again, and a repeated cancellation is rejected as stale. Browser checks use actual pointer clicks for Pass priority, contextual Cancel, payment color menus, and the exact payment cancellation payload.

A new playtest loads the rebuilt bridge. A match already running in an older JVM cannot acquire the new cancellation capability through a browser refresh alone.

Validation: 112 frontend tests, 160 backend tests and all 57 Forge integration tests passed; frontend/backend/bridge builds and browser interaction checks passed. Final cancellation coverage also verifies that cancellation does not inflate mana-source selection telemetry. `git diff --check` passed. No vendor sources changed.
