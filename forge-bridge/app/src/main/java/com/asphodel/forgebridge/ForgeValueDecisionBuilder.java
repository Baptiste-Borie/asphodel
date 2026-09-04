package com.asphodel.forgebridge;

import forge.ai.ComputerUtilMana;
import forge.game.ability.AbilityUtils;
import forge.game.cost.Cost;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import org.apache.commons.lang3.Range;

/** Derives externally selectable value bounds from Forge's own mechanics. */
final class ForgeValueDecisionBuilder {
    Decision buildX(SpellAbility ability, Player player, int requestedMin, int requestedMax) {
        Cost cost = ability.getPayCosts();
        if (cost == null
                || !cost.hasXInAnyCostPart()
                || !"Count$xPaid".equals(ability.getSVar("X"))) {
            return null;
        }

        Range<Integer> bounds = AbilityUtils.getAnnouncementBounds(ability, "X");
        int min = Math.max(requestedMin, bounds.getMinimum());
        int max = Math.min(requestedMax, bounds.getMaximum());
        boolean bounded = max != Integer.MAX_VALUE;

        if (ability.costHasManaX()) {
            max = Math.min(max, ComputerUtilMana.determineLeftoverMana(ability, player, false));
            bounded = true;
        }

        Integer nonManaMax = cost.getMaxForNonManaX(ability, player, false);
        if (nonManaMax != null) {
            max = Math.min(max, nonManaMax);
            bounded = true;
        }

        return bounded && min <= max
                ? new Decision("x", min, max, "Choose X.")
                : null;
    }

    boolean supportsPrimaryAction(SpellAbility ability, Player player) {
        if (ForgeLegalActionEnumerator.requiresTargets(ability)) {
            // Target counts can themselves depend on X. That composition needs
            // a dedicated contract before it can be exposed safely.
            return false;
        }
        Decision decision = buildX(ability, player, 0, Integer.MAX_VALUE);
        return decision != null;
    }

    record Decision(String valueKind, int minValue, int maxValue, String prompt) {
    }
}
