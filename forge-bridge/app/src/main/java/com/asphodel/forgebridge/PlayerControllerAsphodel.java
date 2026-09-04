package com.asphodel.forgebridge;

import forge.LobbyPlayer;
import forge.ai.PlayerControllerAi;
import forge.card.mana.ManaCost;
import forge.game.Game;
import forge.game.cost.CostPartMana;
import forge.game.cost.CostDecisionMakerBase;
import forge.game.mana.ManaConversionMatrix;
import forge.game.mana.ManaCostBeingPaid;
import forge.game.player.Player;
import forge.game.player.PlaySpellAbility;
import forge.game.spellability.AbilityManaPart;
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
    private final ForgeManaPaymentChoiceEnumerator manaPayments =
            new ForgeManaPaymentChoiceEnumerator();
    private final AgentObservationBuilder observations = new AgentObservationBuilder();
    private SpellAbility executingPrimaryAbility;
    private boolean externalManaPaymentActive;

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

    @Override
    public boolean payManaCost(
            ManaCost toPay,
            CostPartMana costPartMana,
            SpellAbility ability,
            String prompt,
            ManaConversionMatrix matrix,
            boolean effect
    ) {
        if (externalManaPaymentActive
                || !isExecutingExternalAction(ability)
                || !manaPayments.supportsPaymentShape(ability, costPartMana, effect)) {
            if (!externalManaPaymentActive && isExecutingExternalAction(ability)) {
                decisions.recordManaFallbackToAi();
            }
            return super.payManaCost(toPay, costPartMana, ability, prompt, matrix, effect);
        }

        externalManaPaymentActive = true;
        try {
            // This is Forge's human/native payment setup. It expands announced X,
            // applies kicker and static cost adjustments, then calls our
            // applyManaToCost override with the authoritative remaining cost.
            return PlaySpellAbility.payManaCost(
                    this,
                    toPay,
                    costPartMana,
                    ability,
                    getPlayer(),
                    prompt,
                    matrix,
                    effect
            );
        } finally {
            externalManaPaymentActive = false;
        }
    }

    @Override
    public boolean applyManaToCost(
            ManaCostBeingPaid toPay,
            SpellAbility ability,
            String prompt,
            ManaConversionMatrix matrix,
            boolean effect
    ) {
        if (!externalManaPaymentActive || !manaPayments.supportsAdjustedCost(toPay)) {
            if (externalManaPaymentActive) {
                decisions.recordManaFallbackToAi();
            }
            return super.applyManaToCost(toPay, ability, prompt, matrix, effect);
        }

        if (matrix != null) {
            getPlayer().getManaPool().applyCardMatrix(matrix);
        }
        getPlayer().pushPaidForSA(ability);
        ability.setManaCostBeingPaid(toPay);
        int externallySelected = 0;
        try {
            while (!toPay.isPaid()) {
                List<ForgeManaPaymentChoiceEnumerator.Candidate> candidates =
                        manaPayments.enumerate(getPlayer(), ability, toPay);
                if (candidates.isEmpty()) {
                    if (externallySelected == 0) {
                        decisions.recordManaFallbackToAi();
                        ability.setManaCostBeingPaid(null);
                        getPlayer().popPaidForSA();
                        return super.applyManaToCost(toPay, ability, prompt, matrix, effect);
                    }
                    return false;
                }

                ForgeManaPaymentChoiceEnumerator.Candidate selected =
                        decisions.requestManaPaymentDecision(
                                getGame(),
                                getPlayer(),
                                ability,
                                sourceActionId(),
                                toPay,
                                candidates,
                                manaPayments,
                                observations.build(getGame(), getPlayer())
                        );
                // The broker revalidates before acknowledging the selector. Do
                // the same on the game thread immediately before mutation.
                if (!manaPayments.isStillLegal(getPlayer(), ability, toPay, selected)) {
                    return false;
                }
                if (!applyManaOption(ability, toPay, selected)) {
                    return false;
                }
                externallySelected++;
            }
            return true;
        } finally {
            if (ability.getManaCostBeingPaid() == toPay) {
                ability.setManaCostBeingPaid(null);
                getPlayer().popPaidForSA();
            }
        }
    }

    private boolean applyManaOption(
            SpellAbility paidFor,
            ManaCostBeingPaid remainingCost,
            ForgeManaPaymentChoiceEnumerator.Candidate selected
    ) {
        if (selected.mana() != null) {
            if (!getPlayer().getManaPool().tryPayCostWithMana(
                    paidFor, remainingCost, selected.mana(), false
            )) {
                return false;
            }
            paidFor.getPayingMana().add(selected.mana());
            return true;
        }

        SpellAbility manaAbility = selected.ability();
        if (manaAbility == null
                || !PlaySpellAbility.playSpellAbility(this, getPlayer(), manaAbility)) {
            return false;
        }
        for (AbilityManaPart part : manaAbility.getAllManaParts()) {
            if (!part.meetsManaRestrictions(paidFor)) {
                return false;
            }
        }
        getPlayer().getManaPool().payManaFromAbility(
                paidFor, remainingCost, manaAbility
        );
        return true;
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
