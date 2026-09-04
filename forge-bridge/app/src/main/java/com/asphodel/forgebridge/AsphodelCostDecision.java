package com.asphodel.forgebridge;

import forge.ai.AiCostDecision;
import forge.game.Game;
import forge.game.cost.CostDiscard;
import forge.game.cost.CostSacrifice;
import forge.game.cost.PaymentDecision;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;

import java.util.List;

/** Delegates costs to Forge AI except for explicitly supported object choices. */
final class AsphodelCostDecision extends AiCostDecision {
    private final Game game;
    private final Player player;
    private final SpellAbility ability;
    private final AsphodelDecisionBroker decisions;
    private final String sourceActionId;
    private final AgentObservationBuilder observations;
    private final ForgeCostObjectChoiceEnumerator objects =
            new ForgeCostObjectChoiceEnumerator();

    AsphodelCostDecision(
            Game game,
            Player player,
            SpellAbility ability,
            boolean effect,
            AsphodelDecisionBroker decisions,
            String sourceActionId,
            AgentObservationBuilder observations
    ) {
        super(player, ability, effect);
        this.game = game;
        this.player = player;
        this.ability = ability;
        this.decisions = decisions;
        this.sourceActionId = sourceActionId;
        this.observations = observations;
    }

    @Override
    public PaymentDecision visit(CostSacrifice cost) {
        List<ForgeCostObjectChoiceEnumerator.Candidate> candidates = objects.sacrifice(
                game, player, ability, cost, isEffect()
        );
        if (candidates.isEmpty()) {
            return super.visit(cost);
        }
        ForgeCostObjectChoiceEnumerator.Candidate selected =
                decisions.requestCostObjectDecision(
                        game,
                        player,
                        ability,
                        sourceActionId,
                        "sacrifice",
                        cost.toString(),
                        candidates,
                        observations.build(game, player)
                );
        return PaymentDecision.card(selected.card());
    }

    @Override
    public PaymentDecision visit(CostDiscard cost) {
        List<ForgeCostObjectChoiceEnumerator.Candidate> candidates = objects.discard(
                game, player, ability, cost, isEffect()
        );
        if (candidates.isEmpty()) {
            return super.visit(cost);
        }
        ForgeCostObjectChoiceEnumerator.Candidate selected =
                decisions.requestCostObjectDecision(
                        game,
                        player,
                        ability,
                        sourceActionId,
                        "discard",
                        cost.toString(),
                        candidates,
                        observations.build(game, player)
                );
        return PaymentDecision.card(selected.card());
    }
}
