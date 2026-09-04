package com.asphodel.forgebridge;

import forge.game.Game;
import forge.game.card.Card;
import forge.game.card.CardView;
import forge.game.card.CounterType;
import forge.game.phase.PhaseHandler;
import forge.game.player.Player;
import forge.game.spellability.SpellAbilityStackInstance;
import forge.game.zone.ZoneType;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/** Builds an immutable, player-specific and visibility-sanitized game snapshot. */
final class AgentObservationBuilder {
    AgentObservation build(Game game, Player observer) {
        PhaseHandler phase = game.getPhaseHandler();
        List<AgentObservation.PlayerObservation> players = new ArrayList<>();
        for (Player player : game.getRegisteredPlayers()) {
            players.add(buildPlayer(game, observer, player));
        }

        return new AgentObservation(
                "forge-game-" + game.getId(),
                new AgentObservation.GameContext(
                        phase.getTurn(),
                        phase.getPhase().name().toLowerCase(Locale.ROOT),
                        playerId(phase.getPlayerTurn()),
                        playerId(phase.getPriorityPlayer())
                ),
                playerId(observer),
                List.copyOf(players),
                buildStack(game, observer)
        );
    }

    private static AgentObservation.PlayerObservation buildPlayer(
            Game game,
            Player observer,
            Player player
    ) {
        List<AgentObservation.CardObservation> battlefield = cards(
                player, ZoneType.Battlefield, observer
        );
        List<AgentObservation.CardObservation> graveyard = cards(
                player, ZoneType.Graveyard, observer
        );
        List<AgentObservation.CardObservation> exile = cards(
                player, ZoneType.Exile, observer
        );
        List<AgentObservation.CardObservation> command = cards(
                player, ZoneType.Command, observer
        );
        List<AgentObservation.CommanderObservation> commanders = commanders(game, player);
        boolean external = player.getController() instanceof PlayerControllerAsphodel;

        if (player.equals(observer)) {
            return new AgentObservation.SelfPlayer(
                    "self",
                    playerId(player),
                    player.getName(),
                    player.getLife(),
                    player.getStartingLife(),
                    player.getCardsIn(ZoneType.Hand).size(),
                    player.getCardsIn(ZoneType.Library).size(),
                    player.getCardsIn(ZoneType.Graveyard).size(),
                    player.getCardsIn(ZoneType.Exile).size(),
                    player.getCardsIn(ZoneType.Command).size(),
                    player.getCardsIn(ZoneType.Battlefield).size(),
                    external,
                    cards(player, ZoneType.Hand, observer),
                    battlefield,
                    graveyard,
                    exile,
                    command,
                    commanders
            );
        }

        return new AgentObservation.OpponentPlayer(
                "opponent",
                playerId(player),
                player.getName(),
                player.getLife(),
                player.getStartingLife(),
                player.getCardsIn(ZoneType.Hand).size(),
                player.getCardsIn(ZoneType.Library).size(),
                player.getCardsIn(ZoneType.Graveyard).size(),
                player.getCardsIn(ZoneType.Exile).size(),
                player.getCardsIn(ZoneType.Command).size(),
                player.getCardsIn(ZoneType.Battlefield).size(),
                external,
                battlefield,
                graveyard,
                exile,
                command,
                commanders
        );
    }

    private static List<AgentObservation.CardObservation> cards(
            Player player,
            ZoneType zone,
            Player observer
    ) {
        return player.getCardsIn(zone).stream()
                .map(card -> card(card, zone, observer))
                .toList();
    }

    private static AgentObservation.CardObservation card(
            Card card,
            ZoneType zone,
            Player observer
    ) {
        boolean identityVisible = identityVisible(card, observer);
        boolean battlefield = zone == ZoneType.Battlefield;
        boolean characteristicsVisible = identityVisible || battlefield;
        return new AgentObservation.CardObservation(
                cardRef(card),
                identityVisible ? card.getName() : null,
                zone.name().toLowerCase(Locale.ROOT),
                playerId(card.getOwner()),
                playerId(card.getController()),
                card.isFaceDown(),
                !identityVisible,
                battlefield ? card.isTapped() : null,
                battlefield && card.isCreature() ? card.isSick() : null,
                battlefield ? counters(card) : null,
                battlefield && card.isCreature() ? card.getNetPower() : null,
                battlefield && card.isCreature() ? card.getNetToughness() : null,
                characteristicsVisible ? card.getType().toString() : null
        );
    }

    static boolean identityVisible(Card card, Player observer) {
        CardView view = card.getView();
        return view.canBeShownTo(observer.getView())
                && (!card.isFaceDown() || view.canFaceDownBeShownTo(observer.getView()));
    }

    private static Map<String, Integer> counters(Card card) {
        if (!card.hasCounters()) {
            return Map.of();
        }
        List<CounterType> types = new ArrayList<>(card.getCounters().elementSet());
        types.sort(Comparator.comparing(CounterType::getName));
        Map<String, Integer> result = new LinkedHashMap<>();
        for (CounterType type : types) {
            result.put(type.getName(), card.getCounters(type));
        }
        return Collections.unmodifiableMap(result);
    }

    private static List<AgentObservation.CommanderObservation> commanders(
            Game game,
            Player player
    ) {
        List<AgentObservation.CommanderObservation> result = new ArrayList<>();
        for (Card commanderReference : player.getCommanders()) {
            Card commander = game.getCardState(commanderReference);
            result.add(new AgentObservation.CommanderObservation(
                    cardRef(commander),
                    commander.getName(),
                    commander.isInZone(ZoneType.Command),
                    player.getCommanderCast(commander)
            ));
        }
        return List.copyOf(result);
    }

    private static List<AgentObservation.StackItem> buildStack(Game game, Player observer) {
        List<AgentObservation.StackItem> result = new ArrayList<>();
        int position = 0;
        for (SpellAbilityStackInstance instance : game.getStack()) {
            Card source = instance.getSourceCard();
            boolean visible = identityVisible(source, observer);
            result.add(new AgentObservation.StackItem(
                    "stack-" + instance.getId(),
                    position++,
                    cardRef(source),
                    visible ? source.getName() : null,
                    playerId(instance.getActivatingPlayer()),
                    visible ? shortText(instance.getStackDescription()) : null,
                    source.isFaceDown(),
                    !visible
            ));
        }
        return List.copyOf(result);
    }

    static String shortText(String text) {
        if (text == null || text.isBlank()) {
            return null;
        }
        String compact = text.replaceAll("\\s+", " ").trim();
        return compact.length() <= 240 ? compact : compact.substring(0, 237) + "...";
    }

    static String cardRef(Card card) {
        return card == null ? null : "card-" + card.getId();
    }

    static String playerId(Player player) {
        return player == null ? null : "player-" + (player.getId() + 1);
    }
}
