package com.asphodel.forgebridge;

import forge.game.Game;
import forge.game.phase.PhaseHandler;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;

import java.util.ArrayList;
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
    private final Map<SpellAbility, ForgeLegalActionEnumerator.ActionType> acceptedAbilities =
            new IdentityHashMap<>();

    private PendingInternal pending;
    private boolean cancelled;
    private long decisionsRequested;
    private long decisionsSubmitted;
    private long passesSubmitted;
    private long primaryActionsSubmitted;
    private long primaryActionsPlayed;
    private long landsPlayed;
    private long spellsCast;
    private long abilitiesActivated;

    AsphodelDecisionBroker(Consumer<Boolean> waitingListener) {
        this.waitingListener = waitingListener;
    }

    List<SpellAbility> requestPriorityDecision(
            Game game,
            Player player,
            List<ForgeLegalActionEnumerator.Candidate> candidates,
            AgentObservation observation
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
            choices.put(passActionId, new ActionChoice(null));
            actions.add(new ExternalAction(
                    passActionId,
                    "pass",
                    "Pass priority",
                    null,
                    null,
                    null,
                    null,
                    null,
                    false
            ));

            for (ForgeLegalActionEnumerator.Candidate candidate : candidates) {
                String actionId = "action-" + actionIds.incrementAndGet();
                choices.put(actionId, new ActionChoice(candidate));
                actions.add(new ExternalAction(
                        actionId,
                        candidate.type().wireName(),
                        candidate.label(),
                        candidate.cardRef(),
                        candidate.cardName(),
                        candidate.sourceZone(),
                        candidate.abilityText(),
                        candidate.manaCost(),
                        candidate.requiresTargets()
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
            decision = new PendingInternal(snapshot, observation, choices);
            pending = decision;
            decisionsRequested++;
        }

        waitingListener.accept(true);
        try {
            ActionChoice choice = decision.answer().get();
            return choice.candidate() == null
                    ? null
                    : List.of(choice.candidate().ability());
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
            if (choice.candidate() == null) {
                passesSubmitted++;
            } else {
                primaryActionsSubmitted++;
                acceptedAbilities.put(
                        choice.candidate().ability(),
                        choice.candidate().type()
                );
            }
        }

        waitingListener.accept(false);
        decision.answer().complete(choice);
    }

    synchronized PendingAgentTurn pendingAgentTurn() {
        return pending == null
                ? null
                : new PendingAgentTurn(pending.observation(), pending.snapshot());
    }

    synchronized Progress progress() {
        return new Progress(
                decisionsRequested,
                decisionsSubmitted,
                passesSubmitted,
                primaryActionsSubmitted,
                primaryActionsPlayed,
                landsPlayed,
                spellsCast,
                abilitiesActivated
        );
    }

    synchronized void recordPrimaryActionResult(SpellAbility ability, boolean played) {
        ForgeLegalActionEnumerator.ActionType type = acceptedAbilities.remove(ability);
        if (type == null || !played) {
            return;
        }
        primaryActionsPlayed++;
        switch (type) {
            case PLAY_LAND -> landsPlayed++;
            case CAST_SPELL -> spellsCast++;
            case ACTIVATE_ABILITY -> abilitiesActivated++;
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
            String cardRef,
            String cardName,
            String sourceZone,
            String abilityText,
            String manaCost,
            boolean requiresTargets
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

    record PendingAgentTurn(
            AgentObservation observation,
            PendingDecision pendingDecision
    ) {
    }

    record Progress(
            long decisionsRequested,
            long decisionsSubmitted,
            long passesSubmitted,
            long primaryActionsSubmitted,
            long primaryActionsPlayed,
            long landsPlayed,
            long spellsCast,
            long abilitiesActivated
    ) {
    }

    private record ActionChoice(ForgeLegalActionEnumerator.Candidate candidate) {
    }

    private record PendingInternal(
            PendingDecision snapshot,
            AgentObservation observation,
            Map<String, ActionChoice> choices,
            CompletableFuture<ActionChoice> answer
    ) {
        PendingInternal(
                PendingDecision snapshot,
                AgentObservation observation,
                Map<String, ActionChoice> choices
        ) {
            this(snapshot, observation, choices, new CompletableFuture<>());
        }

        void clear() {
            choices.clear();
        }
    }

    static final class ExternalMatchCancelledException extends RuntimeException {
    }
}
