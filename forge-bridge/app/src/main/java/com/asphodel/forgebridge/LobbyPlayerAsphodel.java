package com.asphodel.forgebridge;

import forge.ai.LobbyPlayerAi;
import forge.game.Game;
import forge.game.player.Player;

import java.util.Set;

final class LobbyPlayerAsphodel extends LobbyPlayerAi {
    private final AsphodelDecisionBroker decisions;

    LobbyPlayerAsphodel(String name, AsphodelDecisionBroker decisions) {
        super(name, Set.of());
        this.decisions = decisions;
        setAiProfile("Default");
    }

    @Override
    public Player createIngamePlayer(Game game, int id) {
        Player player = new Player(getName(), game, id);
        player.setFirstController(new PlayerControllerAsphodel(
                game,
                player,
                this,
                decisions
        ));
        return player;
    }
}
