package com.asphodel.forgebridge;

import forge.ai.LobbyPlayerAi;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameEndReason;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicReference;

final class ExternalMatchSession {
    private final String sessionId;
    private final String format;
    private final long seed;
    private final Deck playerDeck;
    private final Deck aiDeck;
    private final AsphodelDecisionBroker decisions;
    private final ExecutorService executor;
    private final AtomicReference<Game> game = new AtomicReference<>();

    private volatile Status status = Status.STARTING;
    private volatile Map<String, Object> result;
    private volatile Map<String, Object> failure;
    private volatile boolean workerTerminated;
    private Future<?> future;

    ExternalMatchSession(
            String sessionId,
            String format,
            long seed,
            Deck playerDeck,
            Deck aiDeck
    ) {
        this.sessionId = sessionId;
        this.format = format;
        this.seed = seed;
        this.playerDeck = playerDeck;
        this.aiDeck = aiDeck;
        this.decisions = new AsphodelDecisionBroker(this::decisionWaitingChanged);
        this.executor = Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "asphodel-external-match-" + sessionId);
            thread.setDaemon(true);
            return thread;
        });
    }

    synchronized void start() {
        if (status != Status.STARTING) {
            throw new IllegalStateException("External match session was already started.");
        }
        status = Status.RUNNING;
        future = executor.submit(this::runGame);
        executor.shutdown();
    }

    Map<String, Object> startResult() {
        return Map.of(
                "sessionId", sessionId,
                "status", Status.RUNNING.wireName()
        );
    }

    synchronized Map<String, Object> snapshot() {
        AsphodelDecisionBroker.PendingAgentTurn pending = decisions.pendingAgentTurn();
        Status snapshotStatus = status;
        if (snapshotStatus == Status.RUNNING || snapshotStatus == Status.WAITING_FOR_DECISION) {
            snapshotStatus = pending == null ? Status.RUNNING : Status.WAITING_FOR_DECISION;
        }

        Map<String, Object> snapshot = new LinkedHashMap<>();
        snapshot.put("sessionId", sessionId);
        snapshot.put("status", snapshotStatus.wireName());
        snapshot.put("progress", decisions.progress());

        if (snapshotStatus == Status.WAITING_FOR_DECISION) {
            snapshot.put("observation", pending.observation());
            snapshot.put("pendingDecision", pending.pendingDecision());
        }
        if (snapshotStatus == Status.COMPLETED && result != null) {
            snapshot.put("result", result);
        }
        if (snapshotStatus == Status.FAILED && failure != null) {
            snapshot.put("error", failure);
        }
        return snapshot;
    }

    void submit(String decisionId, String choiceId, boolean targetSubmission) {
        Status current = status;
        if (current.isTerminal()) {
            throw new ExternalMatchException(
                    "MATCH_COMPLETED",
                    "The external match is already terminal."
            );
        }
        decisions.submit(decisionId, choiceId, targetSubmission);
    }

    Map<String, Object> cancel() {
        synchronized (this) {
            if (status == Status.COMPLETED || status == Status.FAILED) {
                throw new ExternalMatchException(
                        "MATCH_COMPLETED",
                        "The external match is already terminal."
                );
            }
            if (status == Status.CANCELLED) {
                return cancellationResult();
            }
            status = Status.CANCELLED;
        }

        decisions.cancel();
        Game runningGame = game.get();
        if (runningGame != null && !runningGame.isGameOver()) {
            runningGame.setGameOver(GameEndReason.Draw);
        }
        Future<?> runningFuture = future;
        if (runningFuture != null) {
            runningFuture.cancel(true);
        }
        executor.shutdownNow();
        awaitTermination();
        return cancellationResult();
    }

    String sessionId() {
        return sessionId;
    }

    boolean blocksNewMatch() {
        return !status.isTerminal() || !workerTerminated;
    }

    private void runGame() {
        try {
            LobbyPlayerAsphodel externalPlayer = new LobbyPlayerAsphodel(
                    "Asphodel External Player",
                    decisions
            );
            LobbyPlayerAi aiPlayer = ForgeGameRunner.createAiLobbyPlayer("Forge AI 2");
            Map<String, Object> gameResult = new ForgeGameRunner().runExternal(
                    format,
                    seed,
                    playerDeck,
                    aiDeck,
                    externalPlayer,
                    aiPlayer,
                    this::gameCreated
            );
            synchronized (this) {
                if (status != Status.CANCELLED) {
                    result = gameResult;
                    status = Status.COMPLETED;
                }
            }
        } catch (AsphodelDecisionBroker.ExternalMatchCancelledException exception) {
            synchronized (this) {
                if (status != Status.CANCELLED) {
                    fail("EXTERNAL_MATCH_INTERRUPTED", "The external decision wait was interrupted.");
                }
            }
        } catch (RuntimeException | Error exception) {
            synchronized (this) {
                if (status != Status.CANCELLED) {
                    System.err.println("External Forge match failed: " + exception.getMessage());
                    fail(
                            "EXTERNAL_MATCH_FAILED",
                            "The Forge external match failed: " + exception.getClass().getSimpleName()
                    );
                }
            }
        } finally {
            decisions.cancel();
            game.set(null);
            workerTerminated = true;
            executor.shutdownNow();
        }
    }

    private synchronized void gameCreated(Game createdGame) {
        game.set(createdGame);
        if (status == Status.CANCELLED && !createdGame.isGameOver()) {
            createdGame.setGameOver(GameEndReason.Draw);
        }
    }

    private synchronized void decisionWaitingChanged(boolean waiting) {
        if (status == Status.RUNNING || status == Status.WAITING_FOR_DECISION) {
            status = waiting ? Status.WAITING_FOR_DECISION : Status.RUNNING;
        }
    }

    private void fail(String code, String message) {
        status = Status.FAILED;
        failure = Map.of("code", code, "message", message);
    }

    private Map<String, Object> cancellationResult() {
        return Map.of(
                "sessionId", sessionId,
                "status", Status.CANCELLED.wireName(),
                "cancelled", true
        );
    }

    private void awaitTermination() {
        try {
            executor.awaitTermination(2, TimeUnit.SECONDS);
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
        }
    }

    private enum Status {
        STARTING("starting"),
        RUNNING("running"),
        WAITING_FOR_DECISION("waiting_for_decision"),
        COMPLETED("completed"),
        CANCELLED("cancelled"),
        FAILED("failed");

        private final String wireName;

        Status(String wireName) {
            this.wireName = wireName;
        }

        String wireName() {
            return wireName;
        }

        boolean isTerminal() {
            return this == COMPLETED || this == CANCELLED || this == FAILED;
        }
    }
}
