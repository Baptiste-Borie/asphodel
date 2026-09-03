package com.asphodel.forgebridge;

import forge.game.Game;
import forge.game.card.Card;
import forge.game.phase.PhaseHandler;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;

import java.util.ArrayList;
import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.atomic.AtomicLong;
import java.util.function.Consumer;

final class AsphodelDecisionBroker {
    private final AtomicLong decisionIds = new AtomicLong();
    private final AtomicLong actionIds = new AtomicLong();
    private final Consumer<Boolean> waitingListener;
    private final Set<String> consumedDecisionIds = new LinkedHashSet<>();
    private final Set<SpellAbility> acceptedAbilities = Collections.newSetFromMap(
            new IdentityHashMap<>()
    );

    private PendingInternal pending;
    private boolean cancelled;
    private long decisionsRequested;
    private long decisionsSubmitted;
    private long passesSubmitted;
    private long suggestionsAccepted;
    private long suggestionAbilitiesPlayed;

    AsphodelDecisionBroker(Consumer<Boolean> waitingListener) {
        this.waitingListener = waitingListener;
    }

    List<SpellAbility> requestPriorityDecision(
            Game game,
            Player player,
            List<SpellAbility> forgeSuggestion
    ) {
        PendingInternal decision;
        synchronized (this) {
            if (cancelled) {
                throw new ExternalMatchCancelledException();
            }
            if (pending != null) {
                throw new IllegalStateException("Only one Asphodel decision may be pending.");
            }

            String decisionId = "decision-" + decisionIds.incrementAndGet();
            Map<String, ActionChoice> choices = new LinkedHashMap<>();
            List<ExternalAction> actions = new ArrayList<>();

            String passActionId = "action-" + actionIds.incrementAndGet();
            choices.put(passActionId, new ActionChoice("pass", null));
            actions.add(new ExternalAction(
                    passActionId,
                    "pass",
                    "Pass priority",
                    null,
                    null
            ));

            if (forgeSuggestion != null && !forgeSuggestion.isEmpty()) {
                List<SpellAbility> retainedSuggestion = List.copyOf(forgeSuggestion);
                SpellAbility first = retainedSuggestion.get(0);
                String suggestionActionId = "action-" + actionIds.incrementAndGet();
                choices.put(
                        suggestionActionId,
                        new ActionChoice("forge_ai_suggestion", retainedSuggestion)
                );
                actions.add(new ExternalAction(
                        suggestionActionId,
                        "forge_ai_suggestion",
                        "Accept Forge AI suggestion",
                        cardName(first),
                        shortAbilityText(first)
                ));
            }

            PhaseHandler phase = game.getPhaseHandler();
            PendingDecision snapshot = new PendingDecision(
                    decisionId,
                    "priority_action",
                    playerId(player),
                    new DecisionContext(
                            phase.getTurn(),
                            phase.getPhase().name().toLowerCase(Locale.ROOT),
                            playerId(phase.getPlayerTurn()),
                            playerId(phase.getPriorityPlayer()),
                            game.getStack().size()
                    ),
                    List.copyOf(actions)
            );
            decision = new PendingInternal(snapshot, choices);
            pending = decision;
            decisionsRequested++;
        }

        waitingListener.accept(true);
        try {
            ActionChoice choice = decision.answer().get();
            return choice.abilities();
        } catch (InterruptedException exception) {
            Thread.currentThread().interrupt();
            throw new ExternalMatchCancelledException();
        } catch (ExecutionException exception) {
            throw new ExternalMatchCancelledException();
        } finally {
            decision.clear();
            synchronized (this) {
                if (pending == decision) {
                    pending = null;
                }
            }
            waitingListener.accept(false);
        }
    }

    void submit(String decisionId, String actionId) {
        PendingInternal decision;
        ActionChoice choice;
        synchronized (this) {
            if (consumedDecisionIds.contains(decisionId)) {
                throw new ExternalMatchException(
                        "STALE_DECISION",
                        "The decision has already been answered."
                );
            }
            decision = pending;
            if (decision == null) {
                throw new ExternalMatchException(
                        "MATCH_NOT_WAITING",
                        "The external match is not waiting for a decision."
                );
            }
            if (!decision.snapshot().decisionId().equals(decisionId)) {
                throw new ExternalMatchException(
                        "DECISION_NOT_FOUND",
                        "The pending decision does not match decisionId."
                );
            }
            if (!decision.choices().containsKey(actionId)) {
                throw new ExternalMatchException(
                        "ACTION_NOT_FOUND",
                        "The action does not belong to the pending decision."
                );
            }

            choice = decision.choices().get(actionId);
            consumedDecisionIds.add(decisionId);
            pending = null;
            decisionsSubmitted++;
            if (choice.abilities() == null) {
                passesSubmitted++;
            } else {
                suggestionsAccepted++;
                acceptedAbilities.addAll(choice.abilities());
            }
        }

        waitingListener.accept(false);
        decision.answer().complete(choice);
    }

    synchronized PendingDecision pendingDecision() {
        return pending == null ? null : pending.snapshot();
    }

    synchronized Progress progress() {
        return new Progress(
                decisionsRequested,
                decisionsSubmitted,
                passesSubmitted,
                suggestionsAccepted,
                suggestionAbilitiesPlayed
        );
    }

    synchronized void recordSuggestionAbilityPlayed(SpellAbility ability) {
        if (acceptedAbilities.remove(ability)) {
            suggestionAbilitiesPlayed++;
        }
    }

    void cancel() {
        PendingInternal decision;
        synchronized (this) {
            cancelled = true;
            decision = pending;
            pending = null;
            acceptedAbilities.clear();
        }
        waitingListener.accept(false);
        if (decision != null) {
            decision.clear();
            decision.answer().completeExceptionally(new ExternalMatchCancelledException());
        }
    }

    private static String playerId(Player player) {
        return player == null ? "" : "player-" + (player.getId() + 1);
    }

    private static String cardName(SpellAbility ability) {
        Card host = ability.getHostCard();
        return host == null ? null : host.getName();
    }

    private static String shortAbilityText(SpellAbility ability) {
        String text = ability.getDescription();
        if (text == null || text.isBlank()) {
            text = ability.getStackDescription();
        }
        if (text == null || text.isBlank()) {
            return null;
        }
        String compact = text.replaceAll("\\s+", " ").trim();
        return compact.length() <= 240 ? compact : compact.substring(0, 237) + "...";
    }

    record DecisionContext(
            int turn,
            String phase,
            String activePlayerId,
            String priorityPlayerId,
            int stackSize
    ) {
    }

    record ExternalAction(
            String actionId,
            String type,
            String label,
            String cardName,
            String abilityText
    ) {
    }

    record PendingDecision(
            String decisionId,
            String type,
            String playerId,
            DecisionContext context,
            List<ExternalAction> actions
    ) {
    }

    record Progress(
            long decisionsRequested,
            long decisionsSubmitted,
            long passesSubmitted,
            long suggestionsAccepted,
            long suggestionAbilitiesPlayed
    ) {
    }

    private record ActionChoice(String type, List<SpellAbility> abilities) {
    }

    private record PendingInternal(
            PendingDecision snapshot,
            Map<String, ActionChoice> choices,
            CompletableFuture<ActionChoice> answer
    ) {
        PendingInternal(PendingDecision snapshot, Map<String, ActionChoice> choices) {
            this(snapshot, choices, new CompletableFuture<>());
        }

        void clear() {
            choices.clear();
        }
    }

    static final class ExternalMatchCancelledException extends RuntimeException {
    }
}
