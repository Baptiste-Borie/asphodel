package com.asphodel.forgebridge;

import forge.game.GameEntity;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.combat.Combat;
import forge.game.combat.CombatUtil;
import forge.game.cost.CostExert;
import forge.game.cost.CostEnlist;
import forge.game.keyword.Keyword;
import forge.game.player.Player;

import java.util.ArrayList;
import java.util.List;

/** Native declaration drafts, edited only on the paused Forge game thread. */
final class ForgeCombatDecisions {
    private final AsphodelDecisionBroker broker;
    private final AgentObservationBuilder observations;

    ForgeCombatDecisions(AsphodelDecisionBroker broker, AgentObservationBuilder observations) {
        this.broker = broker;
        this.observations = observations;
    }

    record Choice(String operation, Card card, GameEntity related, String label) {
        String cardRef() { return card == null ? null : AgentObservationBuilder.cardRef(card); }
        String relatedRef() { return ref(related); }
    }

    static String ref(GameEntity entity) {
        if (entity instanceof Card card) return AgentObservationBuilder.cardRef(card);
        if (entity instanceof Player player) return "player-" + (player.getId() + 1);
        return null;
    }

    String unsupported(Player player, Combat combat, boolean attack) {
        if (player.getGame().getPlayers().size() != 2) return "Multiplayer combat";
        if (!(player.getController() instanceof PlayerControllerAsphodel))
            return "Another player declares this combat";
        for (Card card : player.getGame().getCardsIn(forge.game.zone.ZoneType.Battlefield)) {
            if (card.hasKeyword(Keyword.BANDING)) return "Banding";
            for (var keyword : card.getKeywords()) {
                if (keyword.getOriginal().startsWith("Bands with other")) return "Bands with other";
            }
        }
        if (attack) {
            CardCollection possible = new CardCollection();
            for (Card card : player.getCreaturesInPlay()) {
                for (GameEntity defender : combat.getDefenders()) {
                    if (CombatUtil.canAttack(card, defender)) {
                        possible.add(card);
                        if (CombatUtil.getAttackCost(player.getGame(), card, defender) != null)
                            return "Attack costs are not composed with external mana payment";
                    }
                }
            }
            if (!CombatUtil.getOptionalAttackCostCreatures(possible, CostExert.class).isEmpty()
                    || !CombatUtil.getOptionalAttackCostCreatures(possible, CostEnlist.class).isEmpty())
                return "Optional exert/enlist attack costs";
        } else {
            for (Card blocker : player.getCreaturesInPlay()) {
                for (Card attacker : combat.getAttackers()) {
                    if (CombatUtil.canBlock(attacker, blocker, combat)
                            && CombatUtil.getBlockCost(player.getGame(), blocker, attacker) != null)
                        return "Block costs are not composed with external mana payment";
                }
            }
        }
        return null;
    }

    void declare(Player player, Combat combat, boolean attack) {
        for (;;) {
            List<Choice> choices = new ArrayList<>();
            List<AsphodelDecisionBroker.CombatAssignment> selected = new ArrayList<>();
            if (attack) {
                for (Card card : player.getCreaturesInPlay()) {
                    if (combat.isAttacking(card)) {
                        choices.add(new Choice("remove", card, combat.getDefenderByAttacker(card), "Remove attacker"));
                        selected.add(new AsphodelDecisionBroker.CombatAssignment(ref(card), ref(combat.getDefenderByAttacker(card))));
                    } else {
                        for (GameEntity defender : combat.getDefenders()) {
                            if (CombatUtil.canAttack(card, defender))
                                choices.add(new Choice("add", card, defender, "Attack " + ref(defender)));
                        }
                    }
                }
            } else {
                for (Card blocker : player.getCreaturesInPlay()) {
                    for (Card attacker : combat.getAttackers()) {
                        if (combat.isBlocking(blocker, attacker)) {
                            choices.add(new Choice("remove", blocker, attacker, "Remove block"));
                            selected.add(new AsphodelDecisionBroker.CombatAssignment(ref(blocker), ref(attacker)));
                        } else if (CombatUtil.canBlock(attacker, blocker, combat)) {
                            choices.add(new Choice("add", blocker, attacker, "Block " + ref(attacker)));
                        }
                    }
                }
            }
            boolean valid = attack ? CombatUtil.validateAttackers(combat) : CombatUtil.validateBlocks(combat, player) == null;
            if (valid) choices.add(new Choice("finish", null, null, "Confirm declaration"));
            if (choices.isEmpty()) throw new IllegalStateException("Forge declaration has no edit or legal finish");
            Choice chosen = broker.requestCombatDecision(player.getGame(), player,
                    attack ? "attackers_selection" : "blockers_selection", choices, selected,
                    observations.build(player.getGame(), player));
            if (chosen.operation().equals("finish")) return;
            if (attack) {
                if (chosen.operation().equals("add")) combat.addAttacker(chosen.card(), chosen.related());
                else combat.removeFromCombat(chosen.card());
            } else {
                if (chosen.operation().equals("add")) combat.addBlocker((Card) chosen.related(), chosen.card());
                else combat.removeBlockAssignment((Card) chosen.related(), chosen.card());
            }
        }
    }

    CardCollection order(Player player, Card source, CardCollection cards) {
        CardCollection remaining = new CardCollection(cards);
        CardCollection ordered = new CardCollection();
        while (!remaining.isEmpty()) {
            List<Choice> options = remaining.stream().map(card -> new Choice("order", card, source, "Order " + ref(card))).toList();
            List<AsphodelDecisionBroker.CombatAssignment> selected = ordered.stream()
                    .map(card -> new AsphodelDecisionBroker.CombatAssignment(ref(card), ref(source))).toList();
            Choice chosen = broker.requestCombatDecision(player.getGame(), player, "combat_order_selection",
                    options, selected, observations.build(player.getGame(), player));
            remaining.remove(chosen.card());
            ordered.add(chosen.card());
        }
        return ordered;
    }
}
