package com.asphodel.forgebridge;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import forge.card.MagicColor;
import forge.deck.Deck;
import forge.item.PaperCard;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Properties;

public final class BridgeMain {
    private static final int PROTOCOL_VERSION = 1;
    private static final Gson JSON = new GsonBuilder().serializeNulls().create();
    private static final Properties BUILD_INFO = loadBuildInfo();
    private static final ExternalMatchManager EXTERNAL_MATCHES = new ExternalMatchManager();

    private BridgeMain() {
    }

    public static void main(String[] args) throws IOException {
        PrintStream protocolOutput = System.out;
        System.setOut(System.err);
        try (BufferedReader input = new BufferedReader(
                new InputStreamReader(System.in, StandardCharsets.UTF_8));
             PrintWriter output = new PrintWriter(protocolOutput, true, StandardCharsets.UTF_8)) {
            String line;
            while ((line = input.readLine()) != null) {
                output.println(JSON.toJson(handleLine(line)));
            }
        }
    }

    private static Map<String, Object> handleLine(String line) {
        JsonObject request;
        try {
            JsonElement parsed = JsonParser.parseString(line);
            if (!parsed.isJsonObject()) {
                return error(null, "INVALID_JSON", "The request must be a JSON object.", null);
            }
            request = parsed.getAsJsonObject();
        } catch (JsonParseException | IllegalStateException exception) {
            return error(null, "INVALID_JSON", "The request is not valid JSON.", exception.getMessage());
        }

        String requestId = getString(request, "requestId");
        if (requestId == null || requestId.isBlank()) {
            return error(null, "INVALID_REQUEST", "requestId must be a non-empty string.", null);
        }

        JsonElement version = request.get("protocolVersion");
        if (version == null || !version.isJsonPrimitive()
                || !version.getAsJsonPrimitive().isNumber()
                || version.getAsInt() != PROTOCOL_VERSION) {
            return error(requestId, "UNSUPPORTED_PROTOCOL",
                    "protocolVersion must be " + PROTOCOL_VERSION + ".", null);
        }

        String type = getString(request, "type");
        if (type == null || type.isBlank()) {
            return error(requestId, "INVALID_REQUEST", "type must be a non-empty string.", null);
        }

        try {
            return switch (type) {
                case "ping" -> success(requestId, "pong", Map.of("message", "pong"));
                case "engine_info" -> success(requestId, "engine_info", engineInfo());
                case "forge_color_identity" -> handleColorIdentity(requestId, request);
                case "run_test_game" -> handleRunTestGame(requestId, request);
                case "inspect_deck" -> handleInspectDeck(requestId, request);
                case "run_deck_match" -> handleRunDeckMatch(requestId, request);
                case "start_external_match" -> handleStartExternalMatch(requestId, request);
                case "get_external_match" -> handleGetExternalMatch(requestId, request);
                case "submit_external_decision" -> handleSubmitExternalDecision(requestId, request);
                case "cancel_external_match" -> handleCancelExternalMatch(requestId, request);
                default -> error(requestId, "UNKNOWN_COMMAND", "Unknown command: " + type, null);
            };
        } catch (ExternalMatchException exception) {
            return error(requestId, exception.code(), exception.getMessage(), exception.details());
        } catch (ForgeDeckFactory.CardsNotFoundException exception) {
            return error(
                    requestId,
                    "FORGE_CARDS_NOT_FOUND",
                    exception.getMessage(),
                    Map.of("cards", exception.cards())
            );
        } catch (ForgeDeckFactory.UnsupportedCommanderConfigurationException exception) {
            return error(
                    requestId,
                    "UNSUPPORTED_COMMANDER_CONFIGURATION",
                    exception.getMessage(),
                    Map.of("commanderCards", exception.commanderCards())
            );
        } catch (ForgeGameRunner.GameTimeoutException exception) {
            return error(requestId, "GAME_TIMEOUT", exception.getMessage(), null);
        } catch (IllegalArgumentException exception) {
            return error(requestId, "INVALID_PAYLOAD", exception.getMessage(), null);
        } catch (RuntimeException exception) {
            System.err.println("Forge bridge request failed: " + exception.getMessage());
            return error(requestId, "INTERNAL_ERROR", "The Forge bridge could not process the request.",
                    exception.getClass().getName());
        }
    }

    private static Map<String, Object> handleRunTestGame(String requestId, JsonObject request) {
        String format = getString(request, "format");
        if (format == null || format.isBlank()) {
            return error(requestId, "INVALID_PAYLOAD", "format must be a non-empty string.", null);
        }

        long seed = getLong(request, "seed", 12345L);
        int timeoutSeconds = getTimeoutSeconds(request);

        EXTERNAL_MATCHES.beginSynchronousMatch();
        try {
            ForgeDeckFactory factory = new ForgeDeckFactory();
            boolean commander = format.equalsIgnoreCase("commander");
            Deck redDeck = factory.build(redFixture(commander), commander);
            Deck greenDeck = factory.build(greenFixture(commander), commander);
            Map<String, Object> result = new LinkedHashMap<>(new ForgeGameRunner().run(
                    format,
                    seed,
                    timeoutSeconds,
                    redDeck,
                    greenDeck
            ));
            result.put("fixtureConformance", commander
                    ? "engine-test fixture; duplicate cards and fewer than 100 cards"
                    : "engine-test fixture; fewer than 60 cards");
            result.put("cardEvidence", lightningBoltEvidence(
                    ForgeDataRepository.instance().requireCard("Lightning Bolt")
            ));
            result.put("forgeClasses", Map.of(
                    "game", forge.game.Game.class.getName(),
                    "match", forge.game.Match.class.getName(),
                    "aiPlayer", forge.ai.LobbyPlayerAi.class.getName()
            ));

            return success(requestId, "run_test_game", result);
        } finally {
            EXTERNAL_MATCHES.endSynchronousMatch();
        }
    }

    private static Map<String, Object> handleInspectDeck(String requestId, JsonObject request) {
        ForgeDeckFactory factory = new ForgeDeckFactory();
        Deck deck = factory.build(parseDeckSpec(request.get("deck")));
        return success(requestId, "inspect_deck", factory.inspect(deck));
    }

    private static Map<String, Object> handleRunDeckMatch(String requestId, JsonObject request) {
        String format = getString(request, "format");
        if (format == null || !format.equalsIgnoreCase("commander")) {
            return error(
                    requestId,
                    "INVALID_PAYLOAD",
                    "run_deck_match format must be commander in V1b.",
                    null
            );
        }

        JsonElement decksElement = request.get("decks");
        if (decksElement == null || !decksElement.isJsonArray()
                || decksElement.getAsJsonArray().size() != 2) {
            return error(
                    requestId,
                    "INVALID_PAYLOAD",
                    "run_deck_match requires exactly two decks.",
                    null
            );
        }

        long seed = getLong(request, "seed", 12345L);
        int timeoutSeconds = getTimeoutSeconds(request);
        EXTERNAL_MATCHES.beginSynchronousMatch();
        try {
            ForgeDeckFactory factory = new ForgeDeckFactory();
            Deck playerOneDeck = factory.build(parseDeckSpec(decksElement.getAsJsonArray().get(0)));
            Deck playerTwoDeck = factory.build(parseDeckSpec(decksElement.getAsJsonArray().get(1)));

            return success(
                    requestId,
                    "run_deck_match",
                    new ForgeGameRunner().run(
                            format,
                            seed,
                            timeoutSeconds,
                            playerOneDeck,
                            playerTwoDeck
                    )
            );
        } finally {
            EXTERNAL_MATCHES.endSynchronousMatch();
        }
    }

    private static Map<String, Object> handleStartExternalMatch(
            String requestId,
            JsonObject request
    ) {
        String format = getString(request, "format");
        if (format == null || !format.equalsIgnoreCase("commander")) {
            return error(
                    requestId,
                    "INVALID_PAYLOAD",
                    "start_external_match format must be commander in V1c.",
                    null
            );
        }
        JsonElement decksElement = request.get("decks");
        if (decksElement == null || !decksElement.isJsonArray()
                || decksElement.getAsJsonArray().size() != 2) {
            return error(
                    requestId,
                    "INVALID_PAYLOAD",
                    "start_external_match requires exactly two decks.",
                    null
            );
        }

        EXTERNAL_MATCHES.ensureCanStart();
        ForgeDeckFactory factory = new ForgeDeckFactory();
        Deck playerDeck = factory.build(parseDeckSpec(decksElement.getAsJsonArray().get(0)));
        Deck aiDeck = factory.build(parseDeckSpec(decksElement.getAsJsonArray().get(1)));
        Map<String, Object> started = EXTERNAL_MATCHES.start(
                format,
                getLong(request, "seed", 12345L),
                playerDeck,
                aiDeck
        );
        return success(requestId, "start_external_match", started);
    }

    private static Map<String, Object> handleGetExternalMatch(
            String requestId,
            JsonObject request
    ) {
        String sessionId = requireString(request, "sessionId");
        return success(
                requestId,
                "get_external_match",
                EXTERNAL_MATCHES.get(sessionId)
        );
    }

    private static Map<String, Object> handleSubmitExternalDecision(
            String requestId,
            JsonObject request
    ) {
        String sessionId = requireString(request, "sessionId");
        String decisionId = requireString(request, "decisionId");
        String actionId = getString(request, "actionId");
        String targetId = getString(request, "targetId");
        String modeId = getString(request, "modeId");
        boolean hasActionId = actionId != null && !actionId.isBlank();
        boolean hasTargetId = targetId != null && !targetId.isBlank();
        boolean hasModeId = modeId != null && !modeId.isBlank();
        int selectorCount = (hasActionId ? 1 : 0)
                + (hasTargetId ? 1 : 0)
                + (hasModeId ? 1 : 0);
        if (selectorCount != 1) {
            throw new IllegalArgumentException(
                    "submit_external_decision requires exactly one of actionId, targetId, "
                            + "or modeId."
            );
        }
        String choiceId = hasActionId ? actionId : hasTargetId ? targetId : modeId;
        AsphodelDecisionBroker.SubmissionKind submissionKind = hasActionId
                ? AsphodelDecisionBroker.SubmissionKind.ACTION
                : hasTargetId
                ? AsphodelDecisionBroker.SubmissionKind.TARGET
                : AsphodelDecisionBroker.SubmissionKind.MODE;
        return success(
                requestId,
                "submit_external_decision",
                EXTERNAL_MATCHES.submit(
                        sessionId,
                        decisionId,
                        choiceId,
                        submissionKind
                )
        );
    }

    private static Map<String, Object> handleCancelExternalMatch(
            String requestId,
            JsonObject request
    ) {
        String sessionId = requireString(request, "sessionId");
        return success(
                requestId,
                "cancel_external_match",
                EXTERNAL_MATCHES.cancel(sessionId)
        );
    }

    private static ForgeDeckFactory.DeckSpec parseDeckSpec(JsonElement element) {
        if (element == null || !element.isJsonObject()) {
            throw new IllegalArgumentException("deck must be an object.");
        }
        try {
            return JSON.fromJson(element, ForgeDeckFactory.DeckSpec.class);
        } catch (JsonParseException exception) {
            throw new IllegalArgumentException("deck is not a valid ForgeDeckSpec.", exception);
        }
    }

    private static int getTimeoutSeconds(JsonObject request) {
        long timeoutSeconds = getLong(request, "timeoutSeconds", 30L);
        if (timeoutSeconds < 1 || timeoutSeconds > 120) {
            throw new IllegalArgumentException("timeoutSeconds must be between 1 and 120.");
        }
        return (int) timeoutSeconds;
    }

    private static ForgeDeckFactory.DeckSpec redFixture(boolean includeCommander) {
        List<ForgeDeckFactory.CardSpec> cards = new ArrayList<>(List.of(
                new ForgeDeckFactory.CardSpec("Mountain", 10, "mainboard"),
                new ForgeDeckFactory.CardSpec("Lightning Bolt", 5, "mainboard"),
                new ForgeDeckFactory.CardSpec("Goblin Piker", 5, "mainboard")
        ));
        if (includeCommander) {
            cards.add(new ForgeDeckFactory.CardSpec(
                    "Krenko, Tin Street Kingpin",
                    1,
                    "commander"
            ));
        }
        return new ForgeDeckFactory.DeckSpec("Asphodel Red Fixture", cards);
    }

    private static ForgeDeckFactory.DeckSpec greenFixture(boolean includeCommander) {
        List<ForgeDeckFactory.CardSpec> cards = new ArrayList<>(List.of(
                new ForgeDeckFactory.CardSpec("Forest", 10, "mainboard"),
                new ForgeDeckFactory.CardSpec("Grizzly Bears", 10, "mainboard")
        ));
        if (includeCommander) {
            cards.add(new ForgeDeckFactory.CardSpec(
                    "Ayula, Queen Among Bears",
                    1,
                    "commander"
            ));
        }
        return new ForgeDeckFactory.DeckSpec("Asphodel Green Fixture", cards);
    }

    private static Map<String, Object> lightningBoltEvidence(PaperCard card) {
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

    private static Map<String, Object> handleColorIdentity(String requestId, JsonObject request) {
        String color = getString(request, "color");
        if (color == null || color.isBlank()) {
            return error(requestId, "INVALID_PAYLOAD", "color must be a non-empty string.", null);
        }

        byte mask = MagicColor.fromName(color.trim());
        List<String> symbols = new ArrayList<>();
        appendSymbol(symbols, mask, MagicColor.WHITE, "W");
        appendSymbol(symbols, mask, MagicColor.BLUE, "U");
        appendSymbol(symbols, mask, MagicColor.BLACK, "B");
        appendSymbol(symbols, mask, MagicColor.RED, "R");
        appendSymbol(symbols, mask, MagicColor.GREEN, "G");

        return success(requestId, "forge_color_identity", Map.of(
                "input", color,
                "mask", Byte.toUnsignedInt(mask),
                "symbols", symbols,
                "forgeClass", MagicColor.class.getName(),
                "sourceModule", "forge-core"
        ));
    }

    private static void appendSymbol(List<String> symbols, byte mask, byte color, String symbol) {
        if ((mask & color) != 0) {
            symbols.add(symbol);
        }
    }

    private static Map<String, Object> engineInfo() {
        return Map.of(
                "bridgeVersion", BUILD_INFO.getProperty("bridge.version"),
                "protocolVersion", PROTOCOL_VERSION,
                "forgeVersion", BUILD_INFO.getProperty("forge.version"),
                "forgeRevision", BUILD_INFO.getProperty("forge.revision"),
                "forgeModules", List.of("forge-core", "forge-game", "forge-ai")
        );
    }

    private static long getLong(JsonObject object, String name, long defaultValue) {
        JsonElement value = object.get(name);
        if (value == null) {
            return defaultValue;
        }
        if (!value.isJsonPrimitive() || !value.getAsJsonPrimitive().isNumber()) {
            throw new IllegalArgumentException(name + " must be an integer.");
        }
        try {
            return value.getAsBigDecimal().longValueExact();
        } catch (ArithmeticException | NumberFormatException exception) {
            throw new IllegalArgumentException(name + " must be an integer.", exception);
        }
    }

    private static Map<String, Object> success(String requestId, String type, Object result) {
        return Map.of(
                "protocolVersion", PROTOCOL_VERSION,
                "requestId", requestId,
                "ok", true,
                "type", type,
                "result", result
        );
    }

    private static Map<String, Object> error(String requestId, String code, String message, Object details) {
        return Map.of(
                "protocolVersion", PROTOCOL_VERSION,
                "requestId", requestId == null ? "" : requestId,
                "ok", false,
                "error", Map.of(
                        "code", code,
                        "message", message,
                        "details", details == null ? "" : details
                )
        );
    }

    private static String getString(JsonObject object, String name) {
        JsonElement value = object.get(name);
        if (value == null || !value.isJsonPrimitive() || !value.getAsJsonPrimitive().isString()) {
            return null;
        }
        return value.getAsString();
    }

    private static String requireString(JsonObject object, String name) {
        String value = getString(object, name);
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(name + " must be a non-empty string.");
        }
        return value;
    }

    private static Properties loadBuildInfo() {
        Properties properties = new Properties();
        try (var stream = BridgeMain.class.getResourceAsStream("/bridge.properties")) {
            if (stream == null) {
                throw new IllegalStateException("bridge.properties is missing");
            }
            properties.load(stream);
            return properties;
        } catch (IOException exception) {
            throw new ExceptionInInitializerError(exception);
        }
    }
}
