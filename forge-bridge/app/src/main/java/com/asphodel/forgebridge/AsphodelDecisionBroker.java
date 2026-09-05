package com.asphodel.forgebridge;

import forge.game.Game;
import forge.game.GameObject;
import forge.card.MagicColor;
import forge.card.mana.ManaCostShard;
import forge.game.mana.Mana;
import forge.game.mana.ManaCostBeingPaid;
import forge.game.phase.PhaseHandler;
import forge.game.player.Player;
import forge.game.spellability.AbilitySub;
import forge.game.spellability.OptionalCostValue;
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
import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

final class AsphodelDecisionBroker {
    private final AtomicLong decisionIds = new AtomicLong();
    private final AtomicLong actionIds = new AtomicLong();
    private final AtomicLong targetIds = new AtomicLong();
    private final AtomicLong modeIds = new AtomicLong();
    private final AtomicLong costIds = new AtomicLong();
    private final AtomicLong objectIds = new AtomicLong();
    private final AtomicLong manaOptionIds = new AtomicLong();
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
    private long modeDecisionsRequested;
    private long modeDecisionsSubmitted;
    private long modesSelected;
    private long valueDecisionsRequested;
    private long valueDecisionsSubmitted;
    private long optionalCostDecisionsRequested;
    private long optionalCostsSelected;
    private long costObjectDecisionsRequested;
    private long costObjectsSelected;
    private long manaPaymentDecisionsRequested;
    private long manaPaymentDecisionsSubmitted;
    private long manaOptionsSelected;
    private long manaPaymentsFallbackToAi;
    private final List<StrategicFallback> strategicFallbacks = new ArrayList<>();

    synchronized void recordStrategicFallback(String family, String method, String sourceCardRef, String reason) {
        strategicFallbacks.add(new StrategicFallback(family, method, sourceCardRef, reason));
    }

    synchronized List<StrategicFallback> strategicFallbacks() {
        return List.copyOf(strategicFallbacks);
    }

    record StrategicFallback(String family, String method, String sourceCardRef, String reason) {}

    ForgeCombatDecisions.Choice requestCombatDecision(Game game, Player player, String type,
            List<ForgeCombatDecisions.Choice> candidates, List<CombatAssignment> selected,
            AgentObservation observation) {
        PendingInternal decision;
        synchronized (this) {
            ensureCanRequest();
            String decisionId = "decision-" + decisionIds.incrementAndGet();
            Map<String, DecisionChoice> choices = new LinkedHashMap<>();
            List<CombatOption> options = new ArrayList<>();
            for (ForgeCombatDecisions.Choice candidate : candidates) {
                String id = "combat-" + objectIds.incrementAndGet();
                choices.put(id, new CombatChoice(candidate));
                options.add(new CombatOption(id, candidate.operation(), candidate.cardRef(),
                        candidate.relatedRef(), candidate.label()));
            }
            decision = new PendingInternal(new PendingCombatDecision(decisionId, type,
                    playerId(player), context(game, game.getPhaseHandler()), List.copyOf(options),
                    List.copyOf(selected), game.getCombat() == null ? List.of() : game.getCombat().getAttackers().stream()
                            .map(card -> new CombatAssignment(AgentObservationBuilder.cardRef(card),
                                    ForgeCombatDecisions.ref(game.getCombat().getDefenderByAttacker(card)))).toList()), observation, choices);
            pending = decision;
        }
        return ((CombatChoice) await(decision)).candidate();
    }

    <T> int requestSelection(Game game, Player player, String type, String kind, String prompt,
            SpellAbility source, List<T> candidates, List<String> labels, List<String> refs,
            List<String> selected, int min, int max, boolean canFinish, AgentObservation observation) {
        PendingInternal decision;
        synchronized (this) {
            ensureCanRequest();
            Map<String, DecisionChoice> choices = new LinkedHashMap<>();
            List<SelectionOption> options = new ArrayList<>();
            for (int i = 0; i < candidates.size(); i++) {
                String id = "selection-" + objectIds.incrementAndGet();
                choices.put(id, new SelectionChoice(i, candidates.get(i)));
                options.add(new SelectionOption(id, labels.get(i), refs.get(i), false));
            }
            if (canFinish) {
                String id = "selection-" + objectIds.incrementAndGet();
                choices.put(id, new SelectionChoice(-1, null));
                options.add(new SelectionOption(id, "Finish selection", null, true));
            }
            decision = new PendingInternal(new PendingSelectionDecision(
                    "decision-" + decisionIds.incrementAndGet(), type, playerId(player),
                    context(game, game.getPhaseHandler()), kind, prompt,
                    source == null ? null : source(null, source), List.copyOf(options), List.copyOf(selected), min, max, canFinish),
                    observation, choices);
            pending = decision;
        }
        return ((SelectionChoice) await(decision)).index();
    }

    record SelectionOption(String objectId, String label, String cardRef, boolean finish) {}
    record PendingSelectionDecision(String decisionId, String type, String playerId,
            DecisionContext context, String selectionKind, String prompt, TargetSource source,
            List<SelectionOption> options, List<String> selected, int minSelections, int maxSelections, boolean canFinish) implements DecisionSnapshot {}
    private record SelectionChoice(int index, Object retainedObject) implements DecisionChoice {}

    record CombatOption(String objectId, String operation, String cardRef, String relatedRef, String label) {}
    record CombatAssignment(String cardRef, String relatedRef) {}
    record PendingCombatDecision(String decisionId, String type, String playerId,
            DecisionContext context, List<CombatOption> options,
            List<CombatAssignment> selected, List<CombatAssignment> attackers) implements DecisionSnapshot {}
    private record CombatChoice(ForgeCombatDecisions.Choice candidate) implements DecisionChoice {}


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
            String sourceActionId,
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
            PendingTargetDecision snapshot = new PendingTargetDecision(
                    decisionId,
                    "target_selection",
                    playerId(player),
                    context(game, phase),
                    new TargetSource(
                            sourceActionId,
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

    ForgeModeChoiceEnumerator.Candidate requestModeDecision(
            Game game,
            Player player,
            SpellAbility ability,
            String sourceActionId,
            List<ForgeModeChoiceEnumerator.Candidate> candidates,
            int minModes,
            int maxModes,
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
            List<ExternalMode> modes = new ArrayList<>();
            for (ForgeModeChoiceEnumerator.Candidate candidate : candidates) {
                String modeId = "mode-" + modeIds.incrementAndGet();
                choices.put(modeId, new ModeChoice(candidate, modeId));
                modes.add(new ExternalMode(
                        modeId,
                        candidate.label(),
                        candidate.description()
                ));
            }

            PendingModeDecision snapshot = new PendingModeDecision(
                    decisionId,
                    "mode_selection",
                    playerId(player),
                    context(game, game.getPhaseHandler()),
                    new TargetSource(
                            sourceActionId,
                            AgentObservationBuilder.cardRef(ability.getHostCard()),
                            ability.getHostCard().getName(),
                            AgentObservationBuilder.shortText(ability.getDescription())
                    ),
                    "Choose one mode.",
                    minModes,
                    maxModes,
                    List.of(),
                    false,
                    null,
                    List.copyOf(modes)
            );
            decision = new PendingInternal(snapshot, observation, choices);
            pending = decision;
            modeDecisionsRequested++;
        }

        waitingListener.accept(true);
        try {
            ModeChoice choice = (ModeChoice) decision.answer().get();
            return choice.candidate();
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

    int requestValueDecision(
            Game game,
            Player player,
            SpellAbility ability,
            String sourceActionId,
            ForgeValueDecisionBuilder.Decision value,
            AgentObservation observation
    ) {
        PendingInternal decision;
        synchronized (this) {
            ensureCanRequest();
            String decisionId = "decision-" + decisionIds.incrementAndGet();
            PendingValueDecision snapshot = new PendingValueDecision(
                    decisionId,
                    "value_selection",
                    playerId(player),
                    context(game, game.getPhaseHandler()),
                    source(sourceActionId, ability),
                    value.prompt(),
                    value.valueKind(),
                    value.minValue(),
                    value.maxValue(),
                    suggestedValues(value.minValue(), value.maxValue())
            );
            decision = new PendingInternal(snapshot, observation, new LinkedHashMap<>());
            pending = decision;
            valueDecisionsRequested++;
        }
        ValueChoice answer = (ValueChoice) await(decision);
        return answer.value();
    }

    List<OptionalCostValue> requestOptionalCostDecision(
            Game game,
            Player player,
            SpellAbility ability,
            String sourceActionId,
            List<ForgeOptionalCostChoiceEnumerator.Candidate> candidates,
            AgentObservation observation
    ) {
        PendingInternal decision;
        synchronized (this) {
            ensureCanRequest();
            String decisionId = "decision-" + decisionIds.incrementAndGet();
            Map<String, DecisionChoice> choices = new LinkedHashMap<>();
            List<ExternalOptionalCost> costs = new ArrayList<>();
            for (ForgeOptionalCostChoiceEnumerator.Candidate candidate : candidates) {
                String costId = "cost-" + costIds.incrementAndGet();
                choices.put(costId, new OptionalCostChoice(candidate.cost(), costId));
                costs.add(new ExternalOptionalCost(
                        costId,
                        candidate.type(),
                        candidate.label(),
                        candidate.costText()
                ));
            }
            String declineCostId = "cost-" + costIds.incrementAndGet();
            choices.put(declineCostId, new OptionalCostChoice(null, declineCostId));
            PendingOptionalCostDecision snapshot = new PendingOptionalCostDecision(
                    decisionId,
                    "optional_cost_selection",
                    playerId(player),
                    context(game, game.getPhaseHandler()),
                    source(sourceActionId, ability),
                    "Choose an optional cost or decline.",
                    0,
                    1,
                    declineCostId,
                    List.copyOf(costs)
            );
            decision = new PendingInternal(snapshot, observation, choices);
            pending = decision;
            optionalCostDecisionsRequested++;
        }
        OptionalCostChoice answer = (OptionalCostChoice) await(decision);
        return answer.cost() == null ? List.of() : List.of(answer.cost());
    }

    ForgeCostObjectChoiceEnumerator.Candidate requestCostObjectDecision(
            Game game,
            Player player,
            SpellAbility ability,
            String sourceActionId,
            String selectionKind,
            String prompt,
            List<ForgeCostObjectChoiceEnumerator.Candidate> candidates,
            AgentObservation observation
    ) {
        PendingInternal decision;
        synchronized (this) {
            ensureCanRequest();
            String decisionId = "decision-" + decisionIds.incrementAndGet();
            Map<String, DecisionChoice> choices = new LinkedHashMap<>();
            List<ExternalCostObject> options = new ArrayList<>();
            for (ForgeCostObjectChoiceEnumerator.Candidate candidate : candidates) {
                String objectId = "object-" + objectIds.incrementAndGet();
                choices.put(objectId, new CostObjectChoice(candidate, objectId));
                options.add(new ExternalCostObject(
                        objectId,
                        candidate.cardRef(),
                        candidate.name(),
                        candidate.zone(),
                        candidate.controllerId(),
                        candidate.faceDown(),
                        candidate.hidden()
                ));
            }
            PendingCostObjectDecision snapshot = new PendingCostObjectDecision(
                    decisionId,
                    "cost_object_selection",
                    playerId(player),
                    context(game, game.getPhaseHandler()),
                    source(sourceActionId, ability),
                    prompt,
                    selectionKind,
                    1,
                    1,
                    List.of(),
                    false,
                    null,
                    List.copyOf(options)
            );
            decision = new PendingInternal(snapshot, observation, choices);
            pending = decision;
            costObjectDecisionsRequested++;
        }
        CostObjectChoice answer = (CostObjectChoice) await(decision);
        return answer.candidate();
    }

    ForgeManaPaymentChoiceEnumerator.Candidate requestManaPaymentDecision(
            Game game,
            Player player,
            SpellAbility ability,
            String sourceActionId,
            ManaCostBeingPaid remainingCost,
            List<ForgeManaPaymentChoiceEnumerator.Candidate> candidates,
            ForgeManaPaymentChoiceEnumerator enumerator,
            AgentObservation observation
    ) {
        PendingInternal decision;
        synchronized (this) {
            ensureCanRequest();
            String decisionId = "decision-" + decisionIds.incrementAndGet();
            Map<String, DecisionChoice> choices = new LinkedHashMap<>();
            List<ExternalManaPaymentOption> options = new ArrayList<>();
            for (ForgeManaPaymentChoiceEnumerator.Candidate candidate : candidates) {
                String manaOptionId = "mana-option-" + manaOptionIds.incrementAndGet();
                BooleanSupplier revalidator = () -> enumerator.isStillLegal(
                        player, ability, remainingCost, candidate
                );
                choices.put(
                        manaOptionId,
                        new ManaChoice(candidate, manaOptionId, revalidator)
                );
                options.add(new ExternalManaPaymentOption(
                        manaOptionId,
                        candidate.type(),
                        candidate.sourceCardRef(),
                        candidate.sourceCardName(),
                        candidate.abilityText(),
                        candidate.produces(),
                        candidate.tapped(),
                        candidate.mana() == null ? null : "mana-" + manaOptionId.substring(12),
                        candidate.color()
                ));
            }
            PendingManaPaymentDecision snapshot = new PendingManaPaymentDecision(
                    decisionId,
                    "mana_payment",
                    playerId(player),
                    context(game, game.getPhaseHandler()),
                    source(sourceActionId, ability),
                    manaCost(remainingCost),
                    manaPool(player),
                    List.copyOf(options),
                    remainingCost.isPaid()
            );
            decision = new PendingInternal(snapshot, observation, choices);
            pending = decision;
            manaPaymentDecisionsRequested++;
        }
        ManaChoice answer = (ManaChoice) await(decision);
        return answer.candidate();
    }

    synchronized void recordManaFallbackToAi() {
        manaPaymentsFallbackToAi++;
    }

    void submit(String decisionId, String choiceId, SubmissionKind submissionKind) {
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
            SubmissionKind expected = submissionKind(decision.snapshot());
            if (expected != submissionKind) {
                throw new ExternalMatchException(
                        expected.requiredCode(),
                        expected.selectorName() + " is required for this decision."
                );
            }
            if (!decision.choices().containsKey(choiceId)) {
                throw new ExternalMatchException(
                        expected.notFoundCode(),
                        "The choice does not belong to the pending decision."
                );
            }

            choice = decision.choices().get(choiceId);
            if (choice instanceof ManaChoice mana && !mana.revalidator().getAsBoolean()) {
                throw new ExternalMatchException(
                        "MANA_OPTION_NO_LONGER_LEGAL",
                        "The retained Forge mana option is no longer legal."
                );
            }
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
            } else if (choice instanceof ModeChoice) {
                modeDecisionsSubmitted++;
                modesSelected++;
            } else if (choice instanceof OptionalCostChoice optionalCost) {
                if (optionalCost.cost() != null) {
                    optionalCostsSelected++;
                }
            } else if (choice instanceof CostObjectChoice) {
                costObjectsSelected++;
            } else if (choice instanceof ManaChoice) {
                manaPaymentDecisionsSubmitted++;
                manaOptionsSelected++;
            }
        }

        waitingListener.accept(false);
        decision.answer().complete(choice);
    }

    void submitValue(String decisionId, int value) {
        PendingInternal decision;
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
            if (!(decision.snapshot() instanceof PendingValueDecision valueDecision)) {
                SubmissionKind expected = submissionKind(decision.snapshot());
                throw new ExternalMatchException(
                        expected.requiredCode(),
                        expected.selectorName() + " is required for this decision."
                );
            }
            if (value < valueDecision.minValue() || value > valueDecision.maxValue()) {
                throw new ExternalMatchException(
                        "VALUE_OUT_OF_RANGE",
                        "value must be between " + valueDecision.minValue()
                                + " and " + valueDecision.maxValue() + "."
                );
            }
            consumedDecisionIds.add(decisionId);
            pending = null;
            valueDecisionsSubmitted++;
        }
        waitingListener.accept(false);
        decision.answer().complete(new ValueChoice(value));
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
                targetsSelected,
                modeDecisionsRequested,
                modeDecisionsSubmitted,
                modesSelected,
                valueDecisionsRequested,
                valueDecisionsSubmitted,
                optionalCostDecisionsRequested,
                optionalCostsSelected,
                costObjectDecisionsRequested,
                costObjectsSelected,
                manaPaymentDecisionsRequested,
                manaPaymentDecisionsSubmitted,
                manaOptionsSelected,
                manaPaymentsFallbackToAi
        );
    }

    synchronized boolean isAcceptedPrimaryAbility(SpellAbility ability) {
        return acceptedAbilities.containsKey(ability.getRootAbility());
    }

    synchronized String acceptedActionId(SpellAbility ability) {
        AcceptedAbility accepted = acceptedAbilities.get(ability.getRootAbility());
        return accepted == null ? null : accepted.actionId();
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

    private void ensureCanRequest() {
        if (cancelled) {
            throw new ExternalMatchCancelledException();
        }
        if (pending != null) {
            throw new IllegalStateException("Only one Asphodel decision may be pending.");
        }
    }

    private DecisionChoice await(PendingInternal decision) {
        waitingListener.accept(true);
        try {
            return decision.answer().get();
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

    private static TargetSource source(String actionId, SpellAbility ability) {
        return new TargetSource(
                actionId,
                AgentObservationBuilder.cardRef(ability.getHostCard()),
                ability.getHostCard().getName(),
                AgentObservationBuilder.shortText(ability.getDescription())
        );
    }

    private static List<Integer> suggestedValues(int min, int max) {
        if (min == max) {
            return List.of(min);
        }
        if (min + 1 == max) {
            return List.of(min, max);
        }
        return List.of(min, min + 1, max);
    }

    private static ManaCostObservation manaCost(ManaCostBeingPaid cost) {
        List<String> shards = cost.getUnpaidShards().stream()
                .map(ManaCostShard::toShortString)
                .toList();
        return new ManaCostObservation(
                cost.toString(),
                cost.getGenericManaAmount(),
                cost.getConvertedManaCost(),
                shards
        );
    }

    private static ManaPoolObservation manaPool(Player player) {
        Map<String, Integer> byColor = new LinkedHashMap<>();
        int total = 0;
        for (Mana mana : player.getManaPool()) {
            String color = MagicColor.toShortString(mana.getColor());
            byColor.merge(color, 1, Integer::sum);
            total++;
        }
        return new ManaPoolObservation(total, Map.copyOf(byColor));
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

    private static SubmissionKind submissionKind(DecisionSnapshot snapshot) {
        if (snapshot instanceof PendingCombatDecision || snapshot instanceof PendingSelectionDecision) {
            return SubmissionKind.OBJECT;
        }
        if (snapshot instanceof PendingTargetDecision) {
            return SubmissionKind.TARGET;
        }
        if (snapshot instanceof PendingModeDecision) {
            return SubmissionKind.MODE;
        }
        if (snapshot instanceof PendingValueDecision) {
            return SubmissionKind.VALUE;
        }
        if (snapshot instanceof PendingOptionalCostDecision) {
            return SubmissionKind.COST;
        }
        if (snapshot instanceof PendingCostObjectDecision) {
            return SubmissionKind.OBJECT;
        }
        if (snapshot instanceof PendingManaPaymentDecision) {
            return SubmissionKind.MANA;
        }
        return SubmissionKind.ACTION;
    }

    enum SubmissionKind {
        ACTION("actionId", "ACTION_ID_REQUIRED", "ACTION_NOT_FOUND"),
        TARGET("targetId", "TARGET_ID_REQUIRED", "TARGET_NOT_FOUND"),
        MODE("modeId", "MODE_ID_REQUIRED", "MODE_NOT_FOUND"),
        VALUE("value", "VALUE_REQUIRED", "VALUE_OUT_OF_RANGE"),
        COST("costId", "COST_ID_REQUIRED", "COST_NOT_FOUND"),
        OBJECT("objectId", "OBJECT_ID_REQUIRED", "OBJECT_NOT_FOUND"),
        MANA("manaOptionId", "MANA_OPTION_ID_REQUIRED", "MANA_OPTION_NOT_FOUND");

        private final String selectorName;
        private final String requiredCode;
        private final String notFoundCode;

        SubmissionKind(String selectorName, String requiredCode, String notFoundCode) {
            this.selectorName = selectorName;
            this.requiredCode = requiredCode;
            this.notFoundCode = notFoundCode;
        }

        String selectorName() {
            return selectorName;
        }

        String requiredCode() {
            return requiredCode;
        }

        String notFoundCode() {
            return notFoundCode;
        }
    }

    sealed interface DecisionSnapshot permits PendingDecision, PendingTargetDecision,
            PendingModeDecision, PendingValueDecision, PendingOptionalCostDecision,
            PendingCostObjectDecision, PendingManaPaymentDecision, PendingCombatDecision, PendingSelectionDecision {
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

    record ExternalMode(
            String modeId,
            String label,
            String description
    ) {
    }

    record PendingModeDecision(
            String decisionId,
            String type,
            String playerId,
            DecisionContext context,
            TargetSource source,
            String prompt,
            int minModes,
            int maxModes,
            List<String> selectedModeIds,
            boolean canFinish,
            String finishModeId,
            List<ExternalMode> modes
    ) implements DecisionSnapshot {
    }

    record PendingValueDecision(
            String decisionId,
            String type,
            String playerId,
            DecisionContext context,
            TargetSource source,
            String prompt,
            String valueKind,
            int minValue,
            int maxValue,
            List<Integer> suggestedValues
    ) implements DecisionSnapshot {
    }

    record ExternalOptionalCost(
            String costId,
            String type,
            String label,
            String costText
    ) {
    }

    record PendingOptionalCostDecision(
            String decisionId,
            String type,
            String playerId,
            DecisionContext context,
            TargetSource source,
            String prompt,
            int minSelections,
            int maxSelections,
            String declineCostId,
            List<ExternalOptionalCost> costs
    ) implements DecisionSnapshot {
    }

    record ExternalCostObject(
            String objectId,
            String cardRef,
            String name,
            String zone,
            String controllerId,
            boolean faceDown,
            boolean hidden
    ) {
    }

    record PendingCostObjectDecision(
            String decisionId,
            String type,
            String playerId,
            DecisionContext context,
            TargetSource source,
            String prompt,
            String selectionKind,
            int minSelections,
            int maxSelections,
            List<String> selectedIds,
            boolean canFinish,
            String finishChoiceId,
            List<ExternalCostObject> options
    ) implements DecisionSnapshot {
    }

    record ManaCostObservation(
            String text,
            int generic,
            int convertedManaCost,
            List<String> shards
    ) {
    }

    record ManaPoolObservation(
            int total,
            Map<String, Integer> byColor
    ) {
    }

    record ExternalManaPaymentOption(
            String manaOptionId,
            String type,
            String sourceCardRef,
            String sourceCardName,
            String abilityText,
            List<String> produces,
            boolean tapped,
            String manaRef,
            String color
    ) {
    }

    record PendingManaPaymentDecision(
            String decisionId,
            String type,
            String playerId,
            DecisionContext context,
            TargetSource source,
            ManaCostObservation remainingCost,
            ManaPoolObservation manaPool,
            List<ExternalManaPaymentOption> options,
            boolean canFinish
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
            long targetsSelected,
            long modeDecisionsRequested,
            long modeDecisionsSubmitted,
            long modesSelected,
            long valueDecisionsRequested,
            long valueDecisionsSubmitted,
            long optionalCostDecisionsRequested,
            long optionalCostsSelected,
            long costObjectDecisionsRequested,
            long costObjectsSelected,
            long manaPaymentDecisionsRequested,
            long manaPaymentDecisionsSubmitted,
            long manaOptionsSelected,
            long manaPaymentsFallbackToAi
    ) {
    }

    record TargetAnswer(GameObject target, boolean finish, String targetId) {
    }

    private sealed interface DecisionChoice permits PrimaryActionChoice, TargetChoice,
            ModeChoice, ValueChoice, OptionalCostChoice, CostObjectChoice, ManaChoice, CombatChoice, SelectionChoice {
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

    private record ModeChoice(
            ForgeModeChoiceEnumerator.Candidate candidate,
            String choiceId
    ) implements DecisionChoice {
    }

    private record ValueChoice(int value) implements DecisionChoice {
    }

    private record OptionalCostChoice(
            OptionalCostValue cost,
            String choiceId
    ) implements DecisionChoice {
    }

    private record CostObjectChoice(
            ForgeCostObjectChoiceEnumerator.Candidate candidate,
            String choiceId
    ) implements DecisionChoice {
    }

    private record ManaChoice(
            ForgeManaPaymentChoiceEnumerator.Candidate candidate,
            String choiceId,
            BooleanSupplier revalidator
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
