package com.asphodel.forgebridge;

import forge.ai.LobbyPlayerAi;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameEndReason;
import forge.game.GameOutcome;
import forge.game.GameRules;
import forge.game.GameType;
import forge.game.Match;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.game.zone.ZoneType;
import forge.util.MyRandom;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.TimeoutException;

final class ForgeGameRunner {
    Map<String, Object> run(
            String requestedFormat,
            long seed,
            int timeoutSeconds,
            Deck playerOneDeck,
            Deck playerTwoDeck
    ) {
        // GameType localizes its display names during static initialization, so
        // Forge's locale/resources must exist before this class is first used.
        GameType gameType = parseGameType(requestedFormat);
        MyRandom.setRandom(new Random(seed));

        List<RegisteredPlayer> registeredPlayers = List.of(
                createPlayer(playerOneDeck, gameType, "Forge AI 1", 0),
                createPlayer(playerTwoDeck, gameType, "Forge AI 2", 1)
        );

        GameRules rules = new GameRules(gameType);
        rules.setAppliedVariants(EnumSet.of(gameType));
        rules.setGamesPerMatch(1);
        rules.setSimTimeout(timeoutSeconds);
        rules.setWarnAboutAICards(false);

        Match match = new Match(rules, registeredPlayers, "Asphodel Forge Bridge V1b");
        Game game = match.createGame();
        List<PlayerSetup> startingPlayers = new ArrayList<>();

        runWithTimeout(
                () -> match.startGame(game, () -> captureStartingState(game, startingPlayers)),
                game,
                timeoutSeconds
        );

        GameOutcome outcome = game.getOutcome();
        RegisteredPlayer winner = outcome.getWinningPlayer();
        String winnerId = winner == null ? null : playerId(registeredPlayers.indexOf(winner));

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("gameId", "forge-game-" + game.getId());
        result.put("format", requestedFormat.toLowerCase());
        result.put("seed", seed);
        result.put("players", startingPlayers);
        result.put("winnerId", winnerId);
        result.put("turns", outcome.getLastTurnNumber());
        result.put("gameOver", game.isGameOver());
        result.put("draw", outcome.isDraw());
        result.put("terminalReason", outcome.getWinCondition().name());
        result.put("commanderRulesActive", rules.hasCommander());
        return result;
    }

    static GameType parseGameType(String requestedFormat) {
        return switch (requestedFormat.toLowerCase()) {
            case "commander" -> GameType.Commander;
            case "constructed" -> GameType.Constructed;
            default -> throw new IllegalArgumentException(
                    "format must be either commander or constructed"
            );
        };
    }

    private static RegisteredPlayer createPlayer(
            Deck deck,
            GameType gameType,
            String name,
            int index
    ) {
        LobbyPlayerAi ai = new LobbyPlayerAi(name, Set.of());
        ai.setAiProfile("Default");
        RegisteredPlayer player = gameType == GameType.Commander
                ? RegisteredPlayer.forCommander(deck)
                : new RegisteredPlayer(deck);
        player.setId(index);
        return player.setPlayer(ai);
    }

    private static void captureStartingState(Game game, List<PlayerSetup> target) {
        for (int index = 0; index < game.getPlayers().size(); index++) {
            Player player = game.getPlayers().get(index);
            Map<String, Integer> zones = new LinkedHashMap<>();
            zones.put("library", player.getZone(ZoneType.Library).size());
            zones.put("hand", player.getZone(ZoneType.Hand).size());
            zones.put("battlefield", player.getZone(ZoneType.Battlefield).size());
            zones.put("graveyard", player.getZone(ZoneType.Graveyard).size());
            zones.put("command", player.getZone(ZoneType.Command).size());

            List<String> commanders = player.getCommanders().stream()
                    .map(Card::getName)
                    .toList();
            boolean commandersInCommandZone = player.getCommanders().stream()
                    .allMatch(card -> card.getZone() != null
                            && card.getZone().getZoneType() == ZoneType.Command);
            String deckName = player.getRegisteredPlayer().getDeck().getName();

            target.add(new PlayerSetup(
                    playerId(index),
                    player.getName(),
                    deckName,
                    player.getStartingLife(),
                    player.getController().isAI(),
                    player.getController().getClass().getName(),
                    zones,
                    commanders,
                    commandersInCommandZone
            ));
        }
    }

    private static void runWithTimeout(Runnable gameTask, Game game, int timeoutSeconds) {
        ExecutorService executor = Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "asphodel-forge-game");
            thread.setDaemon(true);
            return thread;
        });
        Future<?> future = executor.submit(gameTask);
        executor.shutdown();
        try {
            future.get(timeoutSeconds, TimeUnit.SECONDS);
        } catch (TimeoutException exception) {
            future.cancel(true);
            if (!game.isGameOver()) {
                game.setGameOver(GameEndReason.Draw);
            }
            executor.shutdownNow();
            awaitTermination(executor);
            throw new GameTimeoutException(
                    "Forge game exceeded the " + timeoutSeconds + " second timeout",
                    exception
            );
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new IllegalStateException("Forge game was interrupted", exception);
        } catch (ExecutionException exception) {
            Throwable cause = exception.getCause();
            if (cause instanceof RuntimeException runtimeException) {
                throw runtimeException;
            }
            if (cause instanceof Error error) {
                throw error;
            }
            throw new IllegalStateException("Forge game failed", cause);
        } finally {
            executor.shutdownNow();
        }
    }

    private static void awaitTermination(ExecutorService executor) {
        try {
            executor.awaitTermination(2, TimeUnit.SECONDS);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
        }
    }

    private static String playerId(int index) {
        return "player-" + (index + 1);
    }

    private record PlayerSetup(
            String id,
            String name,
            String deckName,
            int startingLife,
            boolean ai,
            String controllerClass,
            Map<String, Integer> zones,
            List<String> commanders,
            boolean commandersInCommandZone
    ) {
    }

    static final class GameTimeoutException extends RuntimeException {
        GameTimeoutException(String message, Throwable cause) {
            super(message, cause);
        }
    }
}
