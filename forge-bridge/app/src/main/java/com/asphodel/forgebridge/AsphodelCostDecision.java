package com.asphodel.forgebridge;

import forge.ai.AiCostDecision;
import forge.game.Game;
import forge.game.cost.*;
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
            decisions.recordStrategicFallback("cost_object_selection", "visit(" + cost.getClass().getSimpleName() + ")",
                    AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported cost object shape");
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
            decisions.recordStrategicFallback("cost_object_selection", "visit(" + cost.getClass().getSimpleName() + ")",
                    AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported cost object shape");
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

    @Override
    public PaymentDecision visit(CostBehold cost) {
        decisions.recordStrategicFallback("cost", "visit(CostBehold)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostBeholdExile cost) {
        decisions.recordStrategicFallback("cost", "visit(CostBeholdExile)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostChooseColor cost) {
        decisions.recordStrategicFallback("cost", "visit(CostChooseColor)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostChooseCreatureType cost) {
        decisions.recordStrategicFallback("cost", "visit(CostChooseCreatureType)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostCollectEvidence cost) {
        decisions.recordStrategicFallback("cost", "visit(CostCollectEvidence)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostPromiseGift cost) {
        decisions.recordStrategicFallback("cost", "visit(CostPromiseGift)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostExile cost) {
        decisions.recordStrategicFallback("cost", "visit(CostExile)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostExileFromStack cost) {
        decisions.recordStrategicFallback("cost", "visit(CostExileFromStack)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostExiledMoveToGrave cost) {
        decisions.recordStrategicFallback("cost", "visit(CostExiledMoveToGrave)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostExert cost) {
        decisions.recordStrategicFallback("cost", "visit(CostExert)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostEnlist cost) {
        decisions.recordStrategicFallback("cost", "visit(CostEnlist)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostForage cost) {
        decisions.recordStrategicFallback("cost", "visit(CostForage)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostGainControl cost) {
        decisions.recordStrategicFallback("cost", "visit(CostGainControl)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostGainLife cost) {
        decisions.recordStrategicFallback("cost", "visit(CostGainLife)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostPutCardToLib cost) {
        decisions.recordStrategicFallback("cost", "visit(CostPutCardToLib)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostPutCounter cost) {
        decisions.recordStrategicFallback("cost", "visit(CostPutCounter)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostTapType cost) {
        decisions.recordStrategicFallback("cost", "visit(CostTapType)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostReturn cost) {
        decisions.recordStrategicFallback("cost", "visit(CostReturn)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostReveal cost) {
        decisions.recordStrategicFallback("cost", "visit(CostReveal)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostRevealChosen cost) {
        decisions.recordStrategicFallback("cost", "visit(CostRevealChosen)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostRemoveAnyCounter cost) {
        decisions.recordStrategicFallback("cost", "visit(CostRemoveAnyCounter)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostRemoveCounter cost) {
        decisions.recordStrategicFallback("cost", "visit(CostRemoveCounter)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostUntapType cost) {
        decisions.recordStrategicFallback("cost", "visit(CostUntapType)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }

    @Override
    public PaymentDecision visit(CostBlight cost) {
        decisions.recordStrategicFallback("cost", "visit(CostBlight)",
                AgentObservationBuilder.cardRef(ability.getHostCard()), "Unsupported strategic cost selection");
        return super.visit(cost);
    }
}
