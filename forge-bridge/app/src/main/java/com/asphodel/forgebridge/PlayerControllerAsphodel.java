package com.asphodel.forgebridge;

import forge.LobbyPlayer;
import forge.ai.PlayerControllerAi;
import forge.game.Game;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;

import java.util.List;

public final class PlayerControllerAsphodel extends PlayerControllerAi {
    private final AsphodelDecisionBroker decisions;
    private final ForgeLegalActionEnumerator legalActions = new ForgeLegalActionEnumerator();
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
        // Primary selection is already complete. Target selection remains an
        // explicitly secondary Forge AI decision in V1d.
        if (ForgeLegalActionEnumerator.requiresTargets(ability)
                && !super.chooseTargetsFor(ability)) {
            decisions.recordPrimaryActionResult(ability, false);
            return false;
        }
        boolean played = super.playChosenSpellAbility(ability);
        decisions.recordPrimaryActionResult(ability, played);
        return played;
    }
}
