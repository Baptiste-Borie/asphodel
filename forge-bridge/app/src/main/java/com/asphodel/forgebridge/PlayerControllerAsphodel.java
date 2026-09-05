package com.asphodel.forgebridge;

import forge.LobbyPlayer;
import forge.ai.PlayerControllerAi;
import forge.card.mana.ManaCost;
import forge.game.Game;
import forge.game.GameEntity;
import forge.game.card.CardView;
import forge.game.player.DelayedReveal;
import forge.game.player.PlayerActionConfirmMode;
import forge.game.replacement.ReplacementEffect;
import forge.game.trigger.WrappedAbility;
import forge.game.zone.ZoneType;
import forge.util.collect.FCollectionView;
import org.apache.commons.lang3.tuple.ImmutablePair;
import forge.game.card.Card;
import forge.game.card.CardCollection;
import forge.game.card.CardCollectionView;
import forge.game.combat.Combat;
import java.util.Map;
import forge.game.cost.CostPartMana;
import forge.game.cost.CostDecisionMakerBase;
import forge.game.mana.ManaConversionMatrix;
import forge.game.mana.ManaCostBeingPaid;
import forge.game.player.Player;
import forge.game.player.PlaySpellAbility;
import forge.game.spellability.AbilityManaPart;
import forge.game.spellability.AbilitySub;
import forge.game.spellability.OptionalCostValue;
import forge.game.spellability.SpellAbility;

import java.util.ArrayList;
import java.util.List;

public final class PlayerControllerAsphodel extends AuditedPlayerControllerAi {
    private final AsphodelDecisionBroker decisions;
    private final ForgeLegalActionEnumerator legalActions = new ForgeLegalActionEnumerator();
    private final ForgeTargetChoiceEnumerator targetChoices = new ForgeTargetChoiceEnumerator();
    private final ForgeModeChoiceEnumerator modeChoices = new ForgeModeChoiceEnumerator();
    private final ForgeValueDecisionBuilder valueDecisions = new ForgeValueDecisionBuilder();
    private final ForgeOptionalCostChoiceEnumerator optionalCosts =
            new ForgeOptionalCostChoiceEnumerator();
    private final ForgeManaPaymentChoiceEnumerator manaPayments =
            new ForgeManaPaymentChoiceEnumerator();
    private final AgentObservationBuilder observations = new AgentObservationBuilder();
    private SpellAbility executingPrimaryAbility;
    private boolean externalManaPaymentActive;

    PlayerControllerAsphodel(
            Game game,
            Player player,
            LobbyPlayer lobbyPlayer,
            AsphodelDecisionBroker decisions
    ) {
        super(game, player, lobbyPlayer, decisions);
        this.decisions = decisions;
    }

    private final ForgeStrategicSelections selections = new ForgeStrategicSelections();

    private <T> List<T> select(String type, String kind, String prompt, SpellAbility source,
            Iterable<T> options, int min, int max, boolean optional) {
        return selections.select(decisions, observations, getPlayer(), type, kind, prompt,
                source, options, min, max, optional);
    }

    private boolean yesNo(String kind, String prompt, SpellAbility source) {
        return select("yes_no", kind, prompt, source, List.of(true, false), 1, 1, false).get(0);
    }

    @Override
    public boolean confirmAction(SpellAbility sa, PlayerActionConfirmMode mode, String message,
            List<String> options, Card cardToShow, Map<String, Object> params) {
        return yesNo("confirm_action", message, sa);
    }

    @Override
    public boolean confirmStaticApplication(Card host, PlayerActionConfirmMode mode, String message, String logic) {
        return yesNo("static_application", message, null);
    }

    @Override
    public boolean confirmTrigger(WrappedAbility wrapper) {
        return wrapper.isMandatory() || yesNo("optional_trigger", "Accept optional trigger", wrapper);
    }

    @Override
    public boolean confirmReplacementEffect(ReplacementEffect replacement, SpellAbility sa, GameEntity affected, String question) {
        return yesNo("optional_replacement", question, sa);
    }

    @Override
    public ReplacementEffect chooseSingleReplacementEffect(List<ReplacementEffect> options) {
        return select("object_selection", "replacement_effect", "Choose replacement effect", null,
                options, 1, 1, false).get(0);
    }

    @Override
    public <T extends GameEntity> T chooseSingleEntityForEffect(FCollectionView<T> options,
            DelayedReveal reveal, SpellAbility sa, String title, boolean optional, Player related,
            Map<String, Object> params) {
        List<T> selected = select("object_selection", "entity", title, sa, options, 1, 1, optional);
        return selected.isEmpty() ? null : selected.get(0);
    }

    @Override
    public <T extends GameEntity> List<T> chooseEntitiesForEffect(FCollectionView<T> options,
            int min, int max, DelayedReveal reveal, SpellAbility sa, String title, Player related,
            Map<String, Object> params) {
        return select("object_selection", "entities", title, sa, options, min, max, false);
    }

    @Override
    public CardCollectionView chooseCardsForEffect(CardCollectionView cards, SpellAbility sa,
            String title, int min, int max, boolean optional, Map<String, Object> params) {
        return new CardCollection(select("object_selection", "cards_for_effect", title, sa, cards, min, max, optional));
    }

    @Override
    public CardCollectionView choosePermanentsToSacrifice(SpellAbility sa, int min, int max, CardCollectionView cards, String title) {
        return new CardCollection(select("object_selection", "sacrifice_effect", title, sa, cards, min, max, false));
    }

    @Override
    public CardCollectionView choosePermanentsToDestroy(SpellAbility sa, int min, int max, CardCollectionView cards, String title) {
        return new CardCollection(select("object_selection", "destroy_effect", title, sa, cards, min, max, false));
    }

    @Override
    public CardCollection chooseCardsToDiscardFrom(Player player, SpellAbility sa, CardCollection cards,
            int min, int max, CardCollectionView visible) {
        return new CardCollection(select("object_selection", "discard_effect", "Choose cards to discard", sa, cards, min, max, false));
    }

    @Override
    public CardCollectionView chooseCardsToDiscardToMaximumHandSize(int amount) {
        return new CardCollection(select("object_selection", "cleanup_discard", "Discard to maximum hand size", null,
                getPlayer().getCardsIn(ZoneType.Hand), amount, amount, false));
    }

    @Override
    public Card chooseSingleCardForZoneChange(ZoneType destination, List<ZoneType> origin, SpellAbility sa,
            CardCollection cards, DelayedReveal reveal, String title, boolean optional, Player decider) {
        List<Card> chosen = select("object_selection", "zone_change", title, sa, cards, 1, 1, optional);
        return chosen.isEmpty() ? null : chosen.get(0);
    }

    @Override
    public List<Card> chooseCardsForZoneChange(ZoneType destination, List<ZoneType> origin, SpellAbility sa,
            CardCollection cards, int min, int max, DelayedReveal reveal, String title, Player decider) {
        return select("object_selection", "zone_change", title, sa, cards, min, max, false);
    }

    @Override
    public CardCollectionView orderMoveToZoneList(CardCollectionView cards, ZoneType zone, SpellAbility sa) {
        return new CardCollection(select("ordering_selection", "zone_order", "Order cards moved to " + zone,
                sa, cards, cards.size(), cards.size(), false));
    }

    @Override
    public List<SpellAbility> orderSimultaneousSa(List<SpellAbility> abilities) {
        return select("ordering_selection", "trigger_order", "Choose resolution order (first resolves first)",
                null, abilities, abilities.size(), abilities.size(), false);
    }

    @Override
    public void orderAndPlaySimultaneousSa(List<SpellAbility> abilities) {
        if (abilities.stream().anyMatch(SpellAbility::isCopied)) {
            decisions.recordStrategicFallback("copied_abilities", "orderAndPlaySimultaneousSa", null,
                    "Mixed copied ability groups retain the AI preparation path");
            super.orderAndPlaySimultaneousSa(abilities);
            return;
        }
        List<SpellAbility> ordered = orderSimultaneousSa(abilities);
        for (int i = ordered.size() - 1; i >= 0; i--) {
            SpellAbility sa = ordered.get(i);
            if (sa.isTrigger()) PlaySpellAbility.playSpellAbility(this, getPlayer(), sa);
            else getGame().getStack().add(sa);
        }
    }

    @Override
    public boolean playTrigger(Card host, WrappedAbility wrapper, boolean mandatory) {
        return PlaySpellAbility.playSpellAbilityNoStack(this, getPlayer(), wrapper, false);
    }

    @Override
    public void playSpellAbilityNoStack(SpellAbility sa, boolean chooseTargets) {
        PlaySpellAbility.playSpellAbilityNoStack(this, getPlayer(), sa, !chooseTargets);
    }

    @Override
    public boolean playSaFromPlayEffect(SpellAbility sa) {
        return PlaySpellAbility.playSpellAbility(this, getPlayer(), sa);
    }

    @Override
    public boolean mulliganKeepHand(Player first, int cardsToReturn) {
        // Explicit baseline pregame policy, not a Forge AI mulligan decision.
        return true;
    }

    private ImmutablePair<CardCollection, CardCollection> arrangeTop(CardCollection cards, String kind) {
        // Forge has explicitly supplied these cards for the player to look at.
        CardCollection top = new CardCollection(selections.selectVisible(decisions, observations, getPlayer(),
                "object_selection", kind + "_top", "Choose cards to keep on top", null,
                cards, 0, cards.size(), false, true));
        CardCollection other = new CardCollection(cards);
        other.removeAll(top);
        CardCollection orderedTop = new CardCollection(selections.selectVisible(decisions, observations, getPlayer(),
                "ordering_selection", kind + "_top_order", "Order cards kept on top", null,
                top, top.size(), top.size(), false, true));
        CardCollection orderedOther = new CardCollection(selections.selectVisible(decisions, observations, getPlayer(),
                "ordering_selection", kind + "_other_order", "Order remaining cards", null,
                other, other.size(), other.size(), false, true));
        return ImmutablePair.of(orderedTop, orderedOther);
    }

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForScry(CardCollection cards) { return arrangeTop(cards, "scry"); }

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForSurveil(CardCollection cards) { return arrangeTop(cards, "surveil"); }

    @Override
    public boolean chooseBinary(SpellAbility sa, String prompt, BinaryChoiceType kind, Boolean defaultChoice) {
        return yesNo("binary_" + kind.name(), prompt, sa);
    }

    @Override
    public boolean chooseBinary(SpellAbility sa, String prompt, BinaryChoiceType kind, Map<String, Object> params) {
        return yesNo("binary_" + kind.name(), prompt, sa);
    }

    @Override
    public SpellAbility chooseSingleSpellForEffect(List<SpellAbility> abilities, SpellAbility sa, String title, Map<String, Object> params) {
        List<SpellAbility> result = select("object_selection", "spell_ability", title, sa, abilities, 1, 1, false);
        return result.isEmpty() ? null : result.get(0);
    }

    @Override
    public List<SpellAbility> chooseSpellAbilitiesForEffect(List<SpellAbility> abilities, SpellAbility sa, String title, int num, Map<String, Object> params) {
        return select("object_selection", "spell_abilities", title, sa, abilities, num, num, false);
    }

    @Override
    public forge.game.staticability.StaticAbility chooseSingleStaticAbility(List<forge.game.staticability.StaticAbility> abilities) {
        List<forge.game.staticability.StaticAbility> result = select("object_selection", "static_ability", "Choose static ability", null, abilities, 1, 1, false);
        return result.isEmpty() ? null : result.get(0);
    }

    @Override
    public CardCollectionView cheatShuffle(CardCollectionView cards) { return cards; }

    @Override
    public SpellAbility getAbilityToPlay(Card host, List<SpellAbility> abilities, forge.util.ITriggerEvent event) {
        List<SpellAbility> chosen = select("object_selection", "ability", "Choose ability", null, abilities, 1, 1, false);
        return chosen.isEmpty() ? null : chosen.get(0);
    }

    @Override
    public List<Card> chooseCardsForSplice(SpellAbility sa, List<Card> cards) {
        if (cards.isEmpty()) return List.of();
        return super.chooseCardsForSplice(sa, cards);
    }

    @Override
    public List<SpellAbility> chooseSaToActivateFromOpeningHand(List<SpellAbility> abilities) {
        if (abilities.isEmpty()) return List.of();
        return super.chooseSaToActivateFromOpeningHand(abilities);
    }

    @Override
    public Player chooseStartingPlayer(boolean firstGame) { return getPlayer(); }

    @Override
    public CardCollectionView tuckCardsViaMulligan(CardCollectionView hand, int count) {
        return new CardCollection(select("object_selection", "mulligan_bottom", "Choose cards to bottom",
                null, hand, count, count, false));
    }

    @Override
    public void declareAttackers(Player attacker, Combat combat) {
        ForgeCombatDecisions choices = new ForgeCombatDecisions(decisions, observations);
        String unsupported = choices.unsupported(attacker, combat, true);
        if (unsupported != null) {
            decisions.recordStrategicFallback("attackers_selection", "declareAttackers", null, unsupported);
            super.declareAttackers(attacker, combat);
            return;
        }
        choices.declare(attacker, combat, true);
    }

    @Override
    public void declareBlockers(Player defender, Combat combat) {
        ForgeCombatDecisions choices = new ForgeCombatDecisions(decisions, observations);
        String unsupported = choices.unsupported(defender, combat, false);
        if (unsupported != null) {
            decisions.recordStrategicFallback("blockers_selection", "declareBlockers", null, unsupported);
            super.declareBlockers(defender, combat);
            return;
        }
        choices.declare(defender, combat, false);
    }

    @Override
    public CardCollection orderBlockers(Card attacker, CardCollection blockers) {
        return new ForgeCombatDecisions(decisions, observations).order(getPlayer(), attacker, blockers);
    }

    @Override
    public CardCollection orderAttackers(Card blocker, CardCollection attackers) {
        return new ForgeCombatDecisions(decisions, observations).order(getPlayer(), blocker, attackers);
    }

    @Override
    public Map<Card, Integer> assignCombatDamage(Card attacker, CardCollectionView blockers,
            CardCollectionView remaining, int damage, GameEntity defender, boolean overrideOrder) {
        decisions.recordStrategicFallback("combat_damage", "assignCombatDamage",
                AgentObservationBuilder.cardRef(attacker),
                "Pinned engine consumes assignments without a reusable rules validator; Forge AI assignment retained.");
        return super.assignCombatDamage(attacker, blockers, remaining, damage, defender, overrideOrder);
    }

    @Override
    public List<SpellAbility> chooseSpellAbilityToPlay() {
        List<ForgeLegalActionEnumerator.Candidate> candidates = legalActions.enumerate(
                getGame(),
                getPlayer()
        );
        return decisions.requestPriorityDecision(
                getGame(),
                getPlayer(),
                candidates,
                observations.build(getGame(), getPlayer())
        );
    }

    @Override
    public boolean playChosenSpellAbility(SpellAbility ability) {
        executingPrimaryAbility = ability;
        boolean played;
        try {
            // Use Forge's full player execution path so optional costs, X,
            // modes, targets, and cost parts occur in native rules order.
            played = PlaySpellAbility.playSpellAbility(this, getPlayer(), ability);
        } finally {
            executingPrimaryAbility = null;
        }
        decisions.recordPrimaryActionResult(ability, played);
        return played;
    }

    @Override
    public boolean chooseTargetsFor(SpellAbility ability) {
        // Random target selection and divided allocations are separate kinds
        // of choices. Keep Forge authoritative for those until their wire
        // contracts are externalized explicitly.
        if (ability.getTargetRestrictions().isRandomTarget()
                || ability.isDividedAsYouChoose()) {
            return super.chooseTargetsFor(ability);
        }

        int maxTargets = ability.getMaxTargets();
        List<String> selectedTargetIds = new ArrayList<>();
        while (ability.getTargets().size() < maxTargets) {
            List<ForgeTargetChoiceEnumerator.Candidate> candidates = targetChoices.enumerate(
                    getGame(),
                    getPlayer(),
                    ability
            );
            boolean canFinish = ability.isMinTargetChosen();
            if (candidates.isEmpty()) {
                return canFinish;
            }

            AsphodelDecisionBroker.TargetAnswer answer = decisions.requestTargetDecision(
                    getGame(),
                    getPlayer(),
                    ability,
                    sourceActionId(),
                    candidates,
                    selectedTargetIds,
                    canFinish,
                    observations.build(getGame(), getPlayer())
            );
            if (answer.finish()) {
                return ability.isTargetNumberValid();
            }
            if (answer.target() == null || !ability.canTarget(answer.target())) {
                return false;
            }
            ability.getTargets().add(answer.target());
            selectedTargetIds.add(answer.targetId());
        }
        return ability.isTargetNumberValid();
    }

    @Override
    public List<AbilitySub> chooseModeForAbility(
            SpellAbility ability,
            List<AbilitySub> possible,
            int min,
            int max,
            boolean allowRepeat
    ) {
        if (!modeChoices.supports(ability, possible, min, max, allowRepeat)) {
            return super.chooseModeForAbility(ability, possible, min, max, allowRepeat);
        }

        ForgeModeChoiceEnumerator.Candidate chosen = decisions.requestModeDecision(
                getGame(),
                getPlayer(),
                ability,
                sourceActionId(),
                modeChoices.enumerate(possible),
                min,
                max,
                observations.build(getGame(), getPlayer())
        );
        AbilitySub mode = chosen.mode();
        mode.setActivatingPlayer(ability.getActivatingPlayer());
        mode.setParent(ability);
        return new ArrayList<>(List.of(mode));
    }

    @Override
    public Integer announceRequirements(
            SpellAbility ability,
            int min,
            int max,
            String announce
    ) {
        if (!isExecutingExternalAction(ability) || !"X".equalsIgnoreCase(announce)) {
            return super.announceRequirements(ability, min, max, announce);
        }
        ForgeValueDecisionBuilder.Decision decision = valueDecisions.buildX(
                ability, getPlayer(), min, max
        );
        if (decision == null) {
            return super.announceRequirements(ability, min, max, announce);
        }
        return decisions.requestValueDecision(
                getGame(),
                getPlayer(),
                ability,
                sourceActionId(),
                decision,
                observations.build(getGame(), getPlayer())
        );
    }

    @Override
    public List<OptionalCostValue> chooseOptionalCosts(
            SpellAbility ability,
            List<OptionalCostValue> costs
    ) {
        if (costs.isEmpty()) return List.of();
        if (!isExecutingExternalAction(ability) || !optionalCosts.supports(costs)) {
            return super.chooseOptionalCosts(ability, costs);
        }
        return decisions.requestOptionalCostDecision(
                getGame(),
                getPlayer(),
                ability,
                sourceActionId(),
                optionalCosts.enumerate(costs),
                observations.build(getGame(), getPlayer())
        );
    }

    @Override
    public CostDecisionMakerBase getCostDecisionMaker(
            Player player,
            SpellAbility ability,
            boolean effect,
            String prompt
    ) {
        String actionId = sourceActionId();
        return new AsphodelCostDecision(
                getGame(),
                player,
                ability,
                effect,
                decisions,
                actionId,
                observations
        );
    }

    @Override
    public boolean payManaCost(
            ManaCost toPay,
            CostPartMana costPartMana,
            SpellAbility ability,
            String prompt,
            ManaConversionMatrix matrix,
            boolean effect
    ) {
        if (externalManaPaymentActive
                || !isExecutingExternalAction(ability)
                || !manaPayments.supportsPaymentShape(ability, costPartMana, effect)) {
            if (!externalManaPaymentActive && isExecutingExternalAction(ability)) {
                decisions.recordManaFallbackToAi();
            }
            return super.payManaCost(toPay, costPartMana, ability, prompt, matrix, effect);
        }

        externalManaPaymentActive = true;
        try {
            // This is Forge's human/native payment setup. It expands announced X,
            // applies kicker and static cost adjustments, then calls our
            // applyManaToCost override with the authoritative remaining cost.
            return PlaySpellAbility.payManaCost(
                    this,
                    toPay,
                    costPartMana,
                    ability,
                    getPlayer(),
                    prompt,
                    matrix,
                    effect
            );
        } finally {
            externalManaPaymentActive = false;
        }
    }

    @Override
    public boolean applyManaToCost(
            ManaCostBeingPaid toPay,
            SpellAbility ability,
            String prompt,
            ManaConversionMatrix matrix,
            boolean effect
    ) {
        if (!externalManaPaymentActive || !manaPayments.supportsAdjustedCost(toPay)) {
            if (externalManaPaymentActive) {
                decisions.recordManaFallbackToAi();
            }
            return super.applyManaToCost(toPay, ability, prompt, matrix, effect);
        }

        if (matrix != null) {
            getPlayer().getManaPool().applyCardMatrix(matrix);
        }
        getPlayer().pushPaidForSA(ability);
        ability.setManaCostBeingPaid(toPay);
        int externallySelected = 0;
        try {
            while (!toPay.isPaid()) {
                List<ForgeManaPaymentChoiceEnumerator.Candidate> candidates =
                        manaPayments.enumerate(getPlayer(), ability, toPay);
                if (candidates.isEmpty()) {
                    if (externallySelected == 0) {
                        decisions.recordManaFallbackToAi();
                        ability.setManaCostBeingPaid(null);
                        getPlayer().popPaidForSA();
                        return super.applyManaToCost(toPay, ability, prompt, matrix, effect);
                    }
                    return false;
                }

                ForgeManaPaymentChoiceEnumerator.Candidate selected =
                        decisions.requestManaPaymentDecision(
                                getGame(),
                                getPlayer(),
                                ability,
                                sourceActionId(),
                                toPay,
                                candidates,
                                manaPayments,
                                observations.build(getGame(), getPlayer())
                        );
                // The broker revalidates before acknowledging the selector. Do
                // the same on the game thread immediately before mutation.
                if (!manaPayments.isStillLegal(getPlayer(), ability, toPay, selected)) {
                    return false;
                }
                if (!applyManaOption(ability, toPay, selected)) {
                    return false;
                }
                externallySelected++;
            }
            return true;
        } finally {
            if (ability.getManaCostBeingPaid() == toPay) {
                ability.setManaCostBeingPaid(null);
                getPlayer().popPaidForSA();
            }
        }
    }

    private boolean applyManaOption(
            SpellAbility paidFor,
            ManaCostBeingPaid remainingCost,
            ForgeManaPaymentChoiceEnumerator.Candidate selected
    ) {
        if (selected.mana() != null) {
            if (!getPlayer().getManaPool().tryPayCostWithMana(
                    paidFor, remainingCost, selected.mana(), false
            )) {
                return false;
            }
            paidFor.getPayingMana().add(selected.mana());
            return true;
        }

        SpellAbility manaAbility = selected.ability();
        if (manaAbility == null
                || !PlaySpellAbility.playSpellAbility(this, getPlayer(), manaAbility)) {
            return false;
        }
        for (AbilityManaPart part : manaAbility.getAllManaParts()) {
            if (!part.meetsManaRestrictions(paidFor)) {
                return false;
            }
        }
        getPlayer().getManaPool().payManaFromAbility(
                paidFor, remainingCost, manaAbility
        );
        return true;
    }

    private boolean isExecutingExternalAction(SpellAbility ability) {
        return executingPrimaryAbility != null
                && decisions.isAcceptedPrimaryAbility(executingPrimaryAbility)
                && (ability == executingPrimaryAbility
                || ability.getHostCard().equals(executingPrimaryAbility.getHostCard()));
    }

    private String sourceActionId() {
        return executingPrimaryAbility == null
                ? null
                : decisions.acceptedActionId(executingPrimaryAbility);
    }
}
