package com.asphodel.forgebridge;

import forge.LobbyPlayer;
import forge.ai.PlayerControllerAi;
import forge.game.Game;
import forge.game.cost.CostDecisionMakerBase;
import forge.game.player.Player;
import forge.game.player.PlaySpellAbility;
import forge.game.spellability.AbilitySub;
import forge.game.spellability.OptionalCostValue;
import forge.game.spellability.SpellAbility;

import java.util.ArrayList;
import java.util.List;

public final class PlayerControllerAsphodel extends PlayerControllerAi {
    private final AsphodelDecisionBroker decisions;
    private final ForgeLegalActionEnumerator legalActions = new ForgeLegalActionEnumerator();
    private final ForgeTargetChoiceEnumerator targetChoices = new ForgeTargetChoiceEnumerator();
    private final ForgeModeChoiceEnumerator modeChoices = new ForgeModeChoiceEnumerator();
    private final ForgeValueDecisionBuilder valueDecisions = new ForgeValueDecisionBuilder();
    private final ForgeOptionalCostChoiceEnumerator optionalCosts =
            new ForgeOptionalCostChoiceEnumerator();
    private final AgentObservationBuilder observations = new AgentObservationBuilder();
    private SpellAbility executingPrimaryAbility;

    PlayerControllerAsphodel(
            Game game,
            Player player,
            LobbyPlayer lobbyPlayer,
            AsphodelDecisionBroker decisions
    ) {
        super(game, player, lobbyPlayer);
        this.decisions = decisions;
    }

    @Override
    public List<SpellAbility> chooseSpellAbilityToPlay() {
        List<ForgeLegalActionEnumerator.Candidate> candidates = legalActions.enumerate(
                getGame(),
                getPlayer()
        );
        return decisions.requestPriorityDecision(
                getGame(),
                getPlayer(),
                candidates,
                observations.build(getGame(), getPlayer())
        );
    }

    @Override
    public boolean playChosenSpellAbility(SpellAbility ability) {
        executingPrimaryAbility = ability;
        boolean played;
        try {
            // Use Forge's full player execution path so optional costs, X,
            // modes, targets, and cost parts occur in native rules order.
            played = PlaySpellAbility.playSpellAbility(this, getPlayer(), ability);
        } finally {
            executingPrimaryAbility = null;
        }
        decisions.recordPrimaryActionResult(ability, played);
        return played;
    }

    @Override
    public boolean chooseTargetsFor(SpellAbility ability) {
        if (!isExecutingExternalAction(ability)) {
            return super.chooseTargetsFor(ability);
        }
        // Random target selection and divided allocations are separate kinds
        // of choices. Keep Forge authoritative for those until their wire
        // contracts are externalized explicitly.
        if (ability.getTargetRestrictions().isRandomTarget()
                || ability.isDividedAsYouChoose()) {
            return super.chooseTargetsFor(ability);
        }

        int maxTargets = ability.getMaxTargets();
        List<String> selectedTargetIds = new ArrayList<>();
        while (ability.getTargets().size() < maxTargets) {
            List<ForgeTargetChoiceEnumerator.Candidate> candidates = targetChoices.enumerate(
                    getGame(),
                    getPlayer(),
                    ability
            );
            boolean canFinish = ability.isMinTargetChosen();
            if (candidates.isEmpty()) {
                return canFinish;
            }

            AsphodelDecisionBroker.TargetAnswer answer = decisions.requestTargetDecision(
                    getGame(),
                    getPlayer(),
                    ability,
                    sourceActionId(),
                    candidates,
                    selectedTargetIds,
                    canFinish,
                    observations.build(getGame(), getPlayer())
            );
            if (answer.finish()) {
                return ability.isTargetNumberValid();
            }
            if (answer.target() == null || !ability.canTarget(answer.target())) {
                return false;
            }
            ability.getTargets().add(answer.target());
            selectedTargetIds.add(answer.targetId());
        }
        return ability.isTargetNumberValid();
    }

    @Override
    public List<AbilitySub> chooseModeForAbility(
            SpellAbility ability,
            List<AbilitySub> possible,
            int min,
            int max,
            boolean allowRepeat
    ) {
        if (!isExecutingExternalAction(ability)
                || !modeChoices.supports(ability, possible, min, max, allowRepeat)) {
            return super.chooseModeForAbility(ability, possible, min, max, allowRepeat);
        }

        ForgeModeChoiceEnumerator.Candidate chosen = decisions.requestModeDecision(
                getGame(),
                getPlayer(),
                ability,
                sourceActionId(),
                modeChoices.enumerate(possible),
                min,
                max,
                observations.build(getGame(), getPlayer())
        );
        AbilitySub mode = chosen.mode();
        mode.setActivatingPlayer(ability.getActivatingPlayer());
        mode.setParent(ability);
        return new ArrayList<>(List.of(mode));
    }

    @Override
    public Integer announceRequirements(
            SpellAbility ability,
            int min,
            int max,
            String announce
    ) {
        if (!isExecutingExternalAction(ability) || !"X".equalsIgnoreCase(announce)) {
            return super.announceRequirements(ability, min, max, announce);
        }
        ForgeValueDecisionBuilder.Decision decision = valueDecisions.buildX(
                ability, getPlayer(), min, max
        );
        if (decision == null) {
            return super.announceRequirements(ability, min, max, announce);
        }
        return decisions.requestValueDecision(
                getGame(),
                getPlayer(),
                ability,
                sourceActionId(),
                decision,
                observations.build(getGame(), getPlayer())
        );
    }

    @Override
    public List<OptionalCostValue> chooseOptionalCosts(
            SpellAbility ability,
            List<OptionalCostValue> costs
    ) {
        if (!isExecutingExternalAction(ability) || !optionalCosts.supports(costs)) {
            return super.chooseOptionalCosts(ability, costs);
        }
        return decisions.requestOptionalCostDecision(
                getGame(),
                getPlayer(),
                ability,
                sourceActionId(),
                optionalCosts.enumerate(costs),
                observations.build(getGame(), getPlayer())
        );
    }

    @Override
    public CostDecisionMakerBase getCostDecisionMaker(
            Player player,
            SpellAbility ability,
            boolean effect,
            String prompt
    ) {
        String actionId = sourceActionId();
        if (actionId == null) {
            return super.getCostDecisionMaker(player, ability, effect, prompt);
        }
        return new AsphodelCostDecision(
                getGame(),
                player,
                ability,
                effect,
                decisions,
                actionId,
                observations
        );
    }

    private boolean isExecutingExternalAction(SpellAbility ability) {
        return executingPrimaryAbility != null
                && decisions.isAcceptedPrimaryAbility(executingPrimaryAbility)
                && (ability == executingPrimaryAbility
                || ability.getHostCard().equals(executingPrimaryAbility.getHostCard()));
    }

    private String sourceActionId() {
        return executingPrimaryAbility == null
                ? null
                : decisions.acceptedActionId(executingPrimaryAbility);
    }
}
