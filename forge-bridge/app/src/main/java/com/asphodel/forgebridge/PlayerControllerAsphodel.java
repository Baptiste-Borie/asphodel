package com.asphodel.forgebridge;

import forge.LobbyPlayer;
import forge.ai.PlayerControllerAi;
import forge.game.Game;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;

import java.util.List;

public final class PlayerControllerAsphodel extends PlayerControllerAi {
    private final AsphodelDecisionBroker decisions;

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
        List<SpellAbility> forgeSuggestion = super.chooseSpellAbilityToPlay();
        return decisions.requestPriorityDecision(getGame(), getPlayer(), forgeSuggestion);
    }

    @Override
    public boolean playChosenSpellAbility(SpellAbility ability) {
        boolean played = super.playChosenSpellAbility(ability);
        if (played) {
            decisions.recordSuggestionAbilityPlayed(ability);
        }
        return played;
    }
}
