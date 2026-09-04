package com.asphodel.forgebridge;

import forge.game.Game;
import forge.game.card.Card;
import forge.game.card.CardCollectionView;
import forge.game.card.CardLists;
import forge.game.card.CardPredicates;
import forge.game.cost.CostDiscard;
import forge.game.cost.CostSacrifice;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.zone.Zone;
import forge.game.zone.ZoneType;

import java.util.List;
import java.util.Locale;

/** Builds safe fixed-one cost choices while retaining Forge Card identity. */
final class ForgeCostObjectChoiceEnumerator {
    List<Candidate> sacrifice(
            Game game,
            Player player,
            SpellAbility ability,
            CostSacrifice cost,
            boolean effect
    ) {
        if (cost.payCostFromSource()
                || "OriginalHost".equals(cost.getType())
                || "All".equalsIgnoreCase(cost.getAmount())
                || "X".equals(cost.getAmount())
                || cost.getType().contains("+WithDifferentNames")
                || cost.getAbilityAmount(ability) != 1) {
            return List.of();
        }

        CardCollectionView candidates = CardLists.filter(
                player.getCardsIn(ZoneType.Battlefield),
                CardPredicates.canBeSacrificedBy(ability, effect)
        );
        candidates = CardLists.getValidCards(
                candidates,
                cost.getType().split(";"),
                player,
                ability.getHostCard(),
                ability
        );
        return candidates.stream().map(card -> candidate(game, player, card)).toList();
    }

    List<Candidate> discard(
            Game game,
            Player player,
            SpellAbility ability,
            CostDiscard cost,
            boolean effect
    ) {
        String type = cost.getType();
        if (cost.payCostFromSource()
                || "Hand".equals(type)
                || "LastDrawn".equals(type)
                || "Random".equals(type)
                || type.contains("+WithDifferentNames")
                || type.contains("+WithSameName")
                || type.contains("X")
                || cost.getAbilityAmount(ability) != 1
                || !player.canDiscardBy(ability, effect)) {
            return List.of();
        }

        CardCollectionView candidates = CardLists.getValidCards(
                player.getCardsIn(ZoneType.Hand),
                type.split(";"),
                player,
                ability.getHostCard(),
                ability
        );
        return candidates.stream().map(card -> candidate(game, player, card)).toList();
    }

    private static Candidate candidate(Game game, Player observer, Card card) {
        boolean visible = AgentObservationBuilder.identityVisible(card, observer);
        Zone zone = game.getZoneOf(card);
        return new Candidate(
                card,
                AgentObservationBuilder.cardRef(card),
                visible ? card.getName() : null,
                zone == null ? "other" : zone.getZoneType().name().toLowerCase(Locale.ROOT),
                AgentObservationBuilder.playerId(card.getController()),
                card.isFaceDown(),
                !visible
        );
    }

    record Candidate(
            Card card,
            String cardRef,
            String name,
            String zone,
            String controllerId,
            boolean faceDown,
            boolean hidden
    ) {
    }
}
