package com.asphodel.forgebridge;

import forge.game.Game;
import forge.game.GameObject;
import forge.game.card.Card;
import forge.game.card.CardUtil;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.spellability.SpellAbilityStackInstance;
import forge.game.staticability.StaticAbilityMustTarget;
import forge.game.zone.Zone;
import forge.game.zone.ZoneType;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/** Enumerates current target candidates while retaining their real Forge objects. */
final class ForgeTargetChoiceEnumerator {
    List<Candidate> enumerate(Game game, Player observer, SpellAbility ability) {
        List<Card> cards = new ArrayList<>(CardUtil.getValidCardsToTarget(ability));
        boolean mustTargetFiltered = canFilterMustTarget(ability)
                && StaticAbilityMustTarget.filterMustTargetCards(observer, cards, ability);

        List<Candidate> candidates = new ArrayList<>();
        if (!mustTargetFiltered) {
            for (Player player : game.getPlayers()) {
                if (!ability.getTargets().contains(player) && ability.canTarget(player)) {
                    candidates.add(player(player));
                }
            }
        }

        for (Card card : cards) {
            candidates.add(card(game, observer, card));
        }

        if (!mustTargetFiltered
                && ability.getTargetRestrictions().getZone().contains(ZoneType.Stack)) {
            for (SpellAbilityStackInstance instance : game.getStack()) {
                SpellAbility target = instance.getSpellAbility();
                if (target != null
                        && !ability.getTargets().contains(target)
                        && ability.canTargetSpellAbility(target)) {
                    candidates.add(stack(observer, instance, target));
                }
            }
        }
        return List.copyOf(candidates);
    }

    private static boolean canFilterMustTarget(SpellAbility ability) {
        SpellAbility related = ability.getParent();
        while (related != null) {
            if (related.usesTargeting()) {
                return false;
            }
            related = related.getParent();
        }
        related = ability.getSubAbility();
        while (related != null) {
            if (related.usesTargeting()) {
                return false;
            }
            related = related.getSubAbility();
        }
        return true;
    }

    private static Candidate player(Player player) {
        String playerId = AgentObservationBuilder.playerId(player);
        return new Candidate(
                player,
                "player",
                player.getName() + " — " + playerId,
                playerId,
                null,
                null,
                player.getName(),
                null,
                playerId,
                false,
                false
        );
    }

    private static Candidate card(Game game, Player observer, Card card) {
        boolean visible = AgentObservationBuilder.identityVisible(card, observer);
        String cardRef = AgentObservationBuilder.cardRef(card);
        String name = visible ? card.getName() : null;
        return new Candidate(
                card,
                "card",
                (visible ? card.getName() : "Hidden card") + " — " + cardRef,
                null,
                cardRef,
                null,
                name,
                zone(game.getZoneOf(card)),
                AgentObservationBuilder.playerId(card.getController()),
                card.isFaceDown(),
                !visible
        );
    }

    private static Candidate stack(
            Player observer,
            SpellAbilityStackInstance instance,
            SpellAbility target
    ) {
        Card source = instance.getSourceCard();
        boolean visible = AgentObservationBuilder.identityVisible(source, observer);
        String stackRef = "stack-" + instance.getId();
        String name = visible ? source.getName() : null;
        return new Candidate(
                target,
                "spell",
                (visible ? source.getName() : "Hidden spell") + " — " + stackRef,
                null,
                AgentObservationBuilder.cardRef(source),
                stackRef,
                name,
                "stack",
                AgentObservationBuilder.playerId(instance.getActivatingPlayer()),
                source.isFaceDown(),
                !visible
        );
    }

    private static String zone(Zone zone) {
        if (zone == null) {
            return "other";
        }
        return zone.getZoneType().name().toLowerCase(Locale.ROOT);
    }

    record Candidate(
            GameObject target,
            String targetType,
            String label,
            String playerId,
            String cardRef,
            String stackRef,
            String name,
            String zone,
            String controllerId,
            boolean faceDown,
            boolean hidden
    ) {
    }
}
