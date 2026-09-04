package com.asphodel.forgebridge;

import forge.LobbyPlayer;
import forge.ai.PlayerControllerAi;
import forge.game.Game;
import forge.game.player.Player;
import forge.game.spellability.AbilitySub;
import forge.game.spellability.SpellAbility;

import java.util.ArrayList;
import java.util.List;

public final class PlayerControllerAsphodel extends PlayerControllerAi {
    private final AsphodelDecisionBroker decisions;
    private final ForgeLegalActionEnumerator legalActions = new ForgeLegalActionEnumerator();
    private final ForgeTargetChoiceEnumerator targetChoices = new ForgeTargetChoiceEnumerator();
    private final ForgeModeChoiceEnumerator modeChoices = new ForgeModeChoiceEnumerator();
    private final AgentObservationBuilder observations = new AgentObservationBuilder();

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
        if (ForgeLegalActionEnumerator.requiresTargets(ability)
                && !ability.setupTargets()) {
            decisions.recordPrimaryActionResult(ability, false);
            return false;
        }
        boolean played = super.playChosenSpellAbility(ability);
        decisions.recordPrimaryActionResult(ability, played);
        return played;
    }

    @Override
    public boolean chooseTargetsFor(SpellAbility ability) {
        if (!decisions.isAcceptedPrimaryAbility(ability)) {
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
        if (!decisions.isAcceptedPrimaryAbility(ability)
                || !modeChoices.supports(ability, possible, min, max, allowRepeat)) {
            return super.chooseModeForAbility(ability, possible, min, max, allowRepeat);
        }

        ForgeModeChoiceEnumerator.Candidate chosen = decisions.requestModeDecision(
                getGame(),
                getPlayer(),
                ability,
                modeChoices.enumerate(possible),
                min,
                max,
                observations.build(getGame(), getPlayer())
        );
        AbilitySub mode = chosen.mode();
        mode.setActivatingPlayer(ability.getActivatingPlayer());
        mode.setParent(ability);

        // CharmEffect asks for modes before it chains Forge's copies of the
        // selected AbilitySub objects. Target the retained selected mode now;
        // SpellAbility.copy() preserves those TargetChoices when Forge chains it.
        if (ForgeLegalActionEnumerator.requiresTargets(mode) && !mode.setupTargets()) {
            return new ArrayList<>();
        }
        return new ArrayList<>(List.of(mode));
    }
}
