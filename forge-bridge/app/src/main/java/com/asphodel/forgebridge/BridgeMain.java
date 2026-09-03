package com.asphodel.forgebridge;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParseException;
import com.google.gson.JsonParser;
import forge.card.MagicColor;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.PrintStream;
import java.io.PrintWriter;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Properties;

public final class BridgeMain {
    private static final int PROTOCOL_VERSION = 1;
    private static final Gson JSON = new GsonBuilder().serializeNulls().create();
    private static final Properties BUILD_INFO = loadBuildInfo();

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
                default -> error(requestId, "UNKNOWN_COMMAND", "Unknown command: " + type, null);
            };
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
        int timeoutSeconds = Math.toIntExact(getLong(request, "timeoutSeconds", 30L));
        if (timeoutSeconds < 1 || timeoutSeconds > 120) {
            return error(requestId, "INVALID_PAYLOAD", "timeoutSeconds must be between 1 and 120.", null);
        }

        return success(
                requestId,
                "run_test_game",
                new ForgeGameRunner().run(format, seed, timeoutSeconds)
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
