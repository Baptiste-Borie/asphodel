package com.asphodel.forgebridge;

import forge.game.Game;
import forge.game.GameObject;
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
    private final AtomicLong targetIds = new AtomicLong();
    private final Consumer<Boolean> waitingListener;
    private final Set<String> consumedDecisionIds = new LinkedHashSet<>();
    private final Map<SpellAbility, AcceptedAbility> acceptedAbilities =
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
    private long targetDecisionsRequested;
    private long targetDecisionsSubmitted;
    private long targetsSelected;

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
            Map<String, DecisionChoice> choices = new LinkedHashMap<>();
            List<ExternalAction> actions = new ArrayList<>();

            String passActionId = "action-" + actionIds.incrementAndGet();
            choices.put(passActionId, new PrimaryActionChoice(null, passActionId));
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
                choices.put(actionId, new PrimaryActionChoice(candidate, actionId));
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
            PrimaryActionChoice choice = (PrimaryActionChoice) decision.answer().get();
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

    TargetAnswer requestTargetDecision(
            Game game,
            Player player,
            SpellAbility ability,
            List<ForgeTargetChoiceEnumerator.Candidate> candidates,
            List<String> selectedTargetIds,
            boolean canFinish,
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
            Map<String, DecisionChoice> choices = new LinkedHashMap<>();
            List<ExternalTarget> targets = new ArrayList<>();
            for (ForgeTargetChoiceEnumerator.Candidate candidate : candidates) {
                String targetId = "target-" + targetIds.incrementAndGet();
                choices.put(targetId, new TargetChoice(candidate.target(), false, targetId));
                targets.add(new ExternalTarget(
                        targetId,
                        candidate.targetType(),
                        candidate.label(),
                        candidate.playerId(),
                        candidate.cardRef(),
                        candidate.stackRef(),
                        candidate.name(),
                        candidate.zone(),
                        candidate.controllerId(),
                        candidate.faceDown(),
                        candidate.hidden()
                ));
            }
            String finishTargetId = null;
            if (canFinish) {
                finishTargetId = "target-" + targetIds.incrementAndGet();
                choices.put(finishTargetId, new TargetChoice(null, true, finishTargetId));
            }

            PhaseHandler phase = game.getPhaseHandler();
            AcceptedAbility accepted = acceptedAbilities.get(ability.getRootAbility());
            PendingTargetDecision snapshot = new PendingTargetDecision(
                    decisionId,
                    "target_selection",
                    playerId(player),
                    context(game, phase),
                    new TargetSource(
                            accepted == null ? null : accepted.actionId(),
                            AgentObservationBuilder.cardRef(ability.getHostCard()),
                            ability.getHostCard().getName(),
                            AgentObservationBuilder.shortText(ability.getDescription())
                    ),
                    ability.getTargetRestrictions().getVTSelection(),
                    ability.getMinTargets(),
                    ability.getMaxTargets(),
                    List.copyOf(selectedTargetIds),
                    canFinish,
                    finishTargetId,
                    List.copyOf(targets)
            );
            decision = new PendingInternal(snapshot, observation, choices);
            pending = decision;
            targetDecisionsRequested++;
        }

        waitingListener.accept(true);
        try {
            TargetChoice choice = (TargetChoice) decision.answer().get();
            return new TargetAnswer(choice.target(), choice.finish(), choice.choiceId());
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

    void submit(String decisionId, String choiceId, boolean targetSubmission) {
        PendingInternal decision;
        DecisionChoice choice;
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
            boolean targetDecision = decision.snapshot() instanceof PendingTargetDecision;
            if (targetDecision != targetSubmission) {
                throw new ExternalMatchException(
                        targetDecision ? "TARGET_ID_REQUIRED" : "ACTION_ID_REQUIRED",
                        targetDecision
                                ? "targetId is required for a target selection."
                                : "actionId is required for a priority action."
                );
            }
            if (!decision.choices().containsKey(choiceId)) {
                throw new ExternalMatchException(
                        targetDecision
                                ? "TARGET_NOT_FOUND"
                                : "ACTION_NOT_FOUND",
                        "The choice does not belong to the pending decision."
                );
            }

            choice = decision.choices().get(choiceId);
            consumedDecisionIds.add(decisionId);
            pending = null;
            if (choice instanceof PrimaryActionChoice primary) {
                decisionsSubmitted++;
                if (primary.candidate() == null) {
                    passesSubmitted++;
                } else {
                    primaryActionsSubmitted++;
                    acceptedAbilities.put(
                            primary.candidate().ability(),
                            new AcceptedAbility(primary.candidate().type(), primary.actionId())
                    );
                }
            } else if (choice instanceof TargetChoice target) {
                targetDecisionsSubmitted++;
                if (!target.finish()) {
                    targetsSelected++;
                }
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
                abilitiesActivated,
                targetDecisionsRequested,
                targetDecisionsSubmitted,
                targetsSelected
        );
    }

    synchronized boolean isAcceptedPrimaryAbility(SpellAbility ability) {
        return acceptedAbilities.containsKey(ability.getRootAbility());
    }

    synchronized void recordPrimaryActionResult(SpellAbility ability, boolean played) {
        AcceptedAbility accepted = acceptedAbilities.remove(ability);
        if (accepted == null || !played) {
            return;
        }
        primaryActionsPlayed++;
        switch (accepted.type()) {
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

    private static DecisionContext context(Game game, PhaseHandler phase) {
        return new DecisionContext(
                phase.getTurn(),
                phase.getPhase().name().toLowerCase(Locale.ROOT),
                playerId(phase.getPlayerTurn()),
                playerId(phase.getPriorityPlayer()),
                game.getStack().size()
        );
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

    sealed interface DecisionSnapshot permits PendingDecision, PendingTargetDecision {
        String decisionId();
    }

    record PendingDecision(
            String decisionId,
            String type,
            String playerId,
            DecisionContext context,
            List<ExternalAction> actions
    ) implements DecisionSnapshot {
    }

    record TargetSource(
            String actionId,
            String cardRef,
            String cardName,
            String abilityText
    ) {
    }

    record ExternalTarget(
            String targetId,
            String type,
            String label,
            String playerId,
            String cardRef,
            String stackRef,
            String name,
            String zone,
            String controllerId,
            boolean faceDown,
            boolean hidden
    ) {
    }

    record PendingTargetDecision(
            String decisionId,
            String type,
            String playerId,
            DecisionContext context,
            TargetSource source,
            String prompt,
            int minTargets,
            int maxTargets,
            List<String> selectedTargetIds,
            boolean canFinish,
            String finishTargetId,
            List<ExternalTarget> targets
    ) implements DecisionSnapshot {
    }

    record PendingAgentTurn(
            AgentObservation observation,
            DecisionSnapshot pendingDecision
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
            long abilitiesActivated,
            long targetDecisionsRequested,
            long targetDecisionsSubmitted,
            long targetsSelected
    ) {
    }

    record TargetAnswer(GameObject target, boolean finish, String targetId) {
    }

    private sealed interface DecisionChoice permits PrimaryActionChoice, TargetChoice {
    }

    private record PrimaryActionChoice(
            ForgeLegalActionEnumerator.Candidate candidate,
            String actionId
    ) implements DecisionChoice {
    }

    private record TargetChoice(
            GameObject target,
            boolean finish,
            String choiceId
    ) implements DecisionChoice {
    }

    private record AcceptedAbility(
            ForgeLegalActionEnumerator.ActionType type,
            String actionId
    ) {
    }

    private record PendingInternal(
            DecisionSnapshot snapshot,
            AgentObservation observation,
            Map<String, DecisionChoice> choices,
            CompletableFuture<DecisionChoice> answer
    ) {
        PendingInternal(
                DecisionSnapshot snapshot,
                AgentObservation observation,
                Map<String, DecisionChoice> choices
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
