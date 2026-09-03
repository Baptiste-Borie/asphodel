package com.asphodel.forgebridge;

import forge.ai.LobbyPlayerAi;
import forge.deck.Deck;
import forge.deck.DeckSection;
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
import forge.item.PaperCard;
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
    private static final List<String> REQUIRED_CARDS = List.of(
            "Mountain",
            "Forest",
            "Lightning Bolt",
            "Grizzly Bears",
            "Goblin Piker",
            "Krenko, Tin Street Kingpin",
            "Ayula, Queen Among Bears"
    );

    Map<String, Object> run(String requestedFormat, long seed, int timeoutSeconds) {
        ForgeDataRepository cards = ForgeDataRepository.instance();
        // GameType localizes its display names during static initialization, so
        // Forge's locale/resources must exist before this class is first used.
        GameType gameType = parseGameType(requestedFormat);
        Map<String, PaperCard> loadedCards = loadCards(cards);

        MyRandom.setRandom(new Random(seed));

        Deck redDeck = createRedDeck(loadedCards, gameType);
        Deck greenDeck = createGreenDeck(loadedCards, gameType);
        List<RegisteredPlayer> registeredPlayers = List.of(
                createPlayer(redDeck, gameType, "Test AI Red", 0),
                createPlayer(greenDeck, gameType, "Test AI Green", 1)
        );

        GameRules rules = new GameRules(gameType);
        rules.setAppliedVariants(EnumSet.of(gameType));
        rules.setGamesPerMatch(1);
        rules.setSimTimeout(timeoutSeconds);
        rules.setWarnAboutAICards(false);

        Match match = new Match(rules, registeredPlayers, "Asphodel Forge Bridge V1");
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
        result.put("fixtureConformance", gameType == GameType.Commander
                ? "engine-test fixture; duplicate cards and fewer than 100 cards"
                : "engine-test fixture; fewer than 60 cards");
        result.put("cardEvidence", lightningBoltEvidence(loadedCards.get("Lightning Bolt")));
        result.put("forgeClasses", Map.of(
                "game", Game.class.getName(),
                "match", Match.class.getName(),
                "aiPlayer", LobbyPlayerAi.class.getName()
        ));
        return result;
    }

    private static GameType parseGameType(String requestedFormat) {
        return switch (requestedFormat.toLowerCase()) {
            case "commander" -> GameType.Commander;
            case "constructed" -> GameType.Constructed;
            default -> throw new IllegalArgumentException(
                    "format must be either commander or constructed"
            );
        };
    }

    private static Map<String, PaperCard> loadCards(ForgeDataRepository repository) {
        Map<String, PaperCard> cards = new LinkedHashMap<>();
        for (String name : REQUIRED_CARDS) {
            cards.put(name, repository.requireCard(name));
        }
        return cards;
    }

    private static Deck createRedDeck(Map<String, PaperCard> cards, GameType gameType) {
        Deck deck = new Deck("Asphodel Red Fixture");
        deck.getMain().add(cards.get("Mountain"), 10);
        deck.getMain().add(cards.get("Lightning Bolt"), 5);
        deck.getMain().add(cards.get("Goblin Piker"), 5);
        if (gameType == GameType.Commander) {
            deck.getOrCreate(DeckSection.Commander)
                    .add(cards.get("Krenko, Tin Street Kingpin"));
        }
        return deck;
    }

    private static Deck createGreenDeck(Map<String, PaperCard> cards, GameType gameType) {
        Deck deck = new Deck("Asphodel Green Fixture");
        deck.getMain().add(cards.get("Forest"), 10);
        deck.getMain().add(cards.get("Grizzly Bears"), 10);
        if (gameType == GameType.Commander) {
            deck.getOrCreate(DeckSection.Commander)
                    .add(cards.get("Ayula, Queen Among Bears"));
        }
        return deck;
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

            target.add(new PlayerSetup(
                    playerId(index),
                    player.getName(),
                    player.getStartingLife(),
                    player.getController().isAI(),
                    player.getController().getClass().getName(),
                    zones,
                    commanders,
                    commandersInCommandZone
            ));
        }
    }

    private static Map<String, Object> lightningBoltEvidence(PaperCard card) {
        if (card == null) {
            throw new IllegalStateException("Lightning Bolt was not loaded");
        }
        List<String> abilities = new ArrayList<>();
        card.getRules().getMainPart().getAbilities().forEach(abilities::add);
        return Map.of(
                "name", card.getName(),
                "manaCost", card.getRules().getManaCost().toString(),
                "oracleText", card.getRules().getOracleText(),
                "scriptAbilities", abilities,
                "scriptAbilityCount", abilities.size(),
                "rulesClass", card.getRules().getClass().getName()
        );
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

    private static String playerId(int index) {
        return "player-" + (index + 1);
    }

    private record PlayerSetup(
            String id,
            String name,
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
