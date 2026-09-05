package com.asphodel.forgebridge;

import forge.deck.Deck;

import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicLong;

final class ExternalMatchManager {
    /** Backward-compatible default: seat 0 external (Asphodel/human), seat 1 native Forge AI. */
    static final List<String> DEFAULT_SEATS = List.of("external", "forge_ai");

    private final AtomicLong sessionIds = new AtomicLong();
    private ExternalMatchSession session;
    private boolean synchronousMatchRunning;

    synchronized Map<String, Object> start(
            String format,
            long seed,
            Deck playerDeck,
            Deck aiDeck,
            List<String> seats
    ) {
        ensureMatchSlotAvailable();
        ExternalMatchSession created = new ExternalMatchSession(
                "match-" + sessionIds.incrementAndGet(),
                format,
                seed,
                playerDeck,
                aiDeck,
                seats
        );
        session = created;
        try {
            created.start();
            return created.startResult();
        } catch (RuntimeException exception) {
            session = null;
            throw exception;
        }
    }

    synchronized void ensureCanStart() {
        ensureMatchSlotAvailable();
    }

    synchronized Map<String, Object> get(String sessionId) {
        return requireSession(sessionId).snapshot();
    }

    synchronized Map<String, Object> submit(
            String sessionId,
            String decisionId,
            String choiceId,
            AsphodelDecisionBroker.SubmissionKind submissionKind
    ) {
        ExternalMatchSession current = requireSession(sessionId);
        current.submit(decisionId, choiceId, submissionKind);
        return Map.of("accepted", true);
    }

    synchronized Map<String, Object> submitValue(
            String sessionId,
            String decisionId,
            int value
    ) {
        ExternalMatchSession current = requireSession(sessionId);
        current.submitValue(decisionId, value);
        return Map.of("accepted", true);
    }

    Map<String, Object> cancel(String sessionId) {
        ExternalMatchSession current;
        synchronized (this) {
            current = requireSession(sessionId);
        }
        return current.cancel();
    }

    synchronized void beginSynchronousMatch() {
        ensureMatchSlotAvailable();
        synchronousMatchRunning = true;
    }

    synchronized void endSynchronousMatch() {
        synchronousMatchRunning = false;
    }

    private void ensureMatchSlotAvailable() {
        if (synchronousMatchRunning || (session != null && session.blocksNewMatch())) {
            throw new ExternalMatchException(
                    "MATCH_ALREADY_RUNNING",
                    "Only one Forge match may be active in the bridge."
            );
        }
    }

    private ExternalMatchSession requireSession(String sessionId) {
        if (session == null || !session.sessionId().equals(sessionId)) {
            throw new ExternalMatchException(
                    "MATCH_NOT_FOUND",
                    "No external match exists for sessionId."
            );
        }
        return session;
    }
}
