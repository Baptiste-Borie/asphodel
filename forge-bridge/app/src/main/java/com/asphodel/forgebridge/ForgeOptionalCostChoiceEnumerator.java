package com.asphodel.forgebridge;

import forge.game.spellability.OptionalCostValue;

import java.util.List;
import java.util.Locale;

/** Exposes the exact optional-cost objects supplied by Forge. */
final class ForgeOptionalCostChoiceEnumerator {
    boolean supports(List<OptionalCostValue> costs) {
        // One optional cost has unambiguous zero-or-one semantics. Multiple,
        // repeated, and dependent optional costs remain delegated to Forge AI.
        return costs.size() == 1;
    }

    List<Candidate> enumerate(List<OptionalCostValue> costs) {
        return costs.stream()
                .map(cost -> new Candidate(
                        cost,
                        cost.getType().name().toLowerCase(Locale.ROOT),
                        cost.toString(),
                        cost.getCost().toSimpleString()
                ))
                .toList();
    }

    record Candidate(
            OptionalCostValue cost,
            String type,
            String label,
            String costText
    ) {
    }
}
