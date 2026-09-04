package com.asphodel.forgebridge;

import forge.game.spellability.AbilitySub;
import forge.game.spellability.SpellAbility;

import java.util.List;

/** Converts Forge-filtered, fixed single-mode choices into wire-safe candidates. */
final class ForgeModeChoiceEnumerator {
    boolean supports(
            SpellAbility ability,
            List<AbilitySub> possible,
            int min,
            int max,
            boolean allowRepeat
    ) {
        if (min != 1 || max != 1 || allowRepeat
                || !"1".equals(ability.getParamOrDefault("CharmNum", "1"))
                || (ability.hasParam("MinCharmNum")
                && !"1".equals(ability.getParam("MinCharmNum")))
                || ability.hasParam("Random")
                || ability.hasParam("Optional")
                || ability.hasParam("Pawprint")) {
            return false;
        }
        return !possible.isEmpty() && possible.stream().allMatch(this::isStaticPrintedMode);
    }

    List<Candidate> enumerate(List<AbilitySub> possible) {
        return possible.stream()
                .map(mode -> {
                    String description = AgentObservationBuilder.shortText(
                            mode.getParam("SpellDescription")
                    );
                    return new Candidate(mode, description, description);
                })
                .toList();
    }

    private boolean isStaticPrintedMode(AbilitySub mode) {
        return mode.hasParam("SpellDescription")
                && !mode.getParam("SpellDescription").isBlank()
                && !mode.hasParam("ModeCost");
    }

    record Candidate(AbilitySub mode, String label, String description) {
    }
}
