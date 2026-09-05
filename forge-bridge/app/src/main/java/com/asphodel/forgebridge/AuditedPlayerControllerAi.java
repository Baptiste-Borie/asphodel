package com.asphodel.forgebridge;

import forge.ai.PlayerControllerAi;
import com.google.common.collect.*;
import forge.LobbyPlayer;
import forge.card.CardStateName;
import forge.card.ColorSet;
import forge.card.ICardFace;
import forge.card.MagicColor;
import forge.card.mana.ManaCost;
import forge.card.mana.ManaCostShard;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.game.*;
import forge.game.ability.AbilityUtils;
import forge.game.ability.ApiType;
import forge.game.ability.effects.CharmEffect;
import forge.game.ability.effects.RollDiceEffect;
import forge.game.card.*;
import forge.game.combat.Combat;
import forge.game.cost.*;
import forge.game.keyword.Keyword;
import forge.game.keyword.KeywordInterface;
import forge.game.mana.Mana;
import forge.game.mana.ManaConversionMatrix;
import forge.game.mana.ManaCostBeingPaid;
import forge.game.phase.PhaseHandler;
import forge.game.phase.PhaseType;
import forge.game.player.*;
import forge.game.replacement.ReplacementEffect;
import forge.game.spellability.*;
import forge.game.staticability.StaticAbility;
import forge.game.trigger.Trigger;
import forge.game.trigger.TriggerType;
import forge.game.trigger.WrappedAbility;
import forge.game.zone.PlayerZone;
import forge.game.zone.ZoneType;
import forge.item.PaperCard;
import forge.util.*;
import forge.util.collect.FCollection;
import forge.util.collect.FCollectionView;
import org.apache.commons.lang3.tuple.ImmutablePair;
import org.apache.commons.lang3.tuple.Pair;
import java.util.*;
import java.util.function.Predicate;

/** Explicit fallback boundary for the pinned AI controller. Keep audit table in sync. */
abstract class AuditedPlayerControllerAi extends PlayerControllerAi {
    private final AsphodelDecisionBroker audit;
    AuditedPlayerControllerAi(Game game, Player player, LobbyPlayer lobby, AsphodelDecisionBroker audit) {
        super(game, player, lobby);
        this.audit = audit;
    }

    @Override
    public SpellAbility getAbilityToPlay(Card hostCard, List<SpellAbility> abilities, ITriggerEvent triggerEvent) {
        audit.recordStrategicFallback("getAbilityToPlay", "getAbilityToPlay", AgentObservationBuilder.cardRef(hostCard), "Pinned Forge AI fallback; see controller audit");
        return super.getAbilityToPlay(hostCard, abilities, triggerEvent);
    }

    @Override
    public Map<GameEntity, Integer> divideShield(Card effectSource, Map<GameEntity, Integer> affected, int shieldAmount) {
        audit.recordStrategicFallback("divideShield", "divideShield", AgentObservationBuilder.cardRef(effectSource), "Pinned Forge AI fallback; see controller audit");
        return super.divideShield(effectSource, affected, shieldAmount);
    }

    @Override
    public Map<Byte, Integer> specifyManaCombo(SpellAbility sa, ColorSet colorSet, int manaAmount, boolean different) {
        audit.recordStrategicFallback("specifyManaCombo", "specifyManaCombo", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.specifyManaCombo(sa, colorSet, manaAmount, different);
    }

    @Override
    public Integer announceRequirements(SpellAbility ability, int min, int max, String announce) {
        audit.recordStrategicFallback("announceRequirements", "announceRequirements", ability == null ? null : AgentObservationBuilder.cardRef(ability.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.announceRequirements(ability, min, max, announce);
    }

    @Override
    public CardCollectionView choosePermanentsToSacrifice(SpellAbility sa, int min, int max, CardCollectionView validTargets, String message) {
        audit.recordStrategicFallback("choosePermanentsToSacrifice", "choosePermanentsToSacrifice", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.choosePermanentsToSacrifice(sa, min, max, validTargets, message);
    }

    @Override
    public CardCollectionView choosePermanentsToDestroy(SpellAbility sa, int min, int max, CardCollectionView validTargets, String message) {
        audit.recordStrategicFallback("choosePermanentsToDestroy", "choosePermanentsToDestroy", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.choosePermanentsToDestroy(sa, min, max, validTargets, message);
    }

    @Override
    public CardCollectionView chooseCardsForEffect(CardCollectionView sourceList, SpellAbility sa, String title, int min, int max, boolean isOptional, Map<String, Object> params) {
        audit.recordStrategicFallback("chooseCardsForEffect", "chooseCardsForEffect", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseCardsForEffect(sourceList, sa, title, min, max, isOptional, params);
    }

    @Override
    public List<Card> chooseContraptionsToCrank(List<Card> contraptions) {
        audit.recordStrategicFallback("chooseContraptionsToCrank", "chooseContraptionsToCrank", null, "Pinned Forge AI fallback; see controller audit");
        return super.chooseContraptionsToCrank(contraptions);
    }

    @Override
    public boolean helpPayForAssistSpell(ManaCostBeingPaid cost, SpellAbility sa, int max, int requested) {
        audit.recordStrategicFallback("helpPayForAssistSpell", "helpPayForAssistSpell", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.helpPayForAssistSpell(cost, sa, max, requested);
    }

    @Override
    public Player choosePlayerToAssistPayment(FCollectionView<Player> optionList, SpellAbility sa, String title, int max) {
        audit.recordStrategicFallback("choosePlayerToAssistPayment", "choosePlayerToAssistPayment", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.choosePlayerToAssistPayment(optionList, sa, title, max);
    }

    @Override
    public <T extends GameEntity> T chooseSingleEntityForEffect(FCollectionView<T> optionList, DelayedReveal delayedReveal, SpellAbility sa, String title, boolean isOptional, Player targetedPlayer, Map<String, Object> params) {
        audit.recordStrategicFallback("chooseSingleEntityForEffect", "chooseSingleEntityForEffect", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseSingleEntityForEffect(optionList, delayedReveal, sa, title, isOptional, targetedPlayer, params);
    }

    @Override
    public <T extends GameEntity> List<T> chooseEntitiesForEffect(
            FCollectionView<T> optionList, int min, int max, DelayedReveal delayedReveal, SpellAbility sa, String title,
            Player targetedPlayer, Map<String, Object> params) {
        audit.recordStrategicFallback("chooseEntitiesForEffect", "chooseEntitiesForEffect", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseEntitiesForEffect(optionList, min, max, delayedReveal, sa, title, targetedPlayer, params);
    }

    @Override
    public List<SpellAbility> chooseSpellAbilitiesForEffect(List<SpellAbility> spells, SpellAbility sa, String title,
            int num, Map<String, Object> params) {
        audit.recordStrategicFallback("chooseSpellAbilitiesForEffect", "chooseSpellAbilitiesForEffect", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseSpellAbilitiesForEffect(spells, sa, title, num, params);
    }

    @Override
    public SpellAbility chooseSingleSpellForEffect(List<SpellAbility> spells, SpellAbility sa, String title,
            Map<String, Object> params) {
        audit.recordStrategicFallback("chooseSingleSpellForEffect", "chooseSingleSpellForEffect", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseSingleSpellForEffect(spells, sa, title, params);
    }

    @Override
    public boolean confirmAction(SpellAbility sa, PlayerActionConfirmMode mode, String message, List<String> options, Card cardToShow, Map<String, Object> params) {
        audit.recordStrategicFallback("confirmAction", "confirmAction", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.confirmAction(sa, mode, message, options, cardToShow, params);
    }

    @Override
    public boolean confirmBidAction(SpellAbility sa, PlayerActionConfirmMode mode, String string,
            int bid, Player winner) {
        audit.recordStrategicFallback("confirmBidAction", "confirmBidAction", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.confirmBidAction(sa, mode, string, bid, winner);
    }

    @Override
    public boolean confirmStaticApplication(Card hostCard, PlayerActionConfirmMode mode, String message, String logic) {
        audit.recordStrategicFallback("confirmStaticApplication", "confirmStaticApplication", AgentObservationBuilder.cardRef(hostCard), "Pinned Forge AI fallback; see controller audit");
        return super.confirmStaticApplication(hostCard, mode, message, logic);
    }

    @Override
    public boolean confirmTrigger(WrappedAbility wrapper) {
        audit.recordStrategicFallback("confirmTrigger", "confirmTrigger", wrapper == null ? null : AgentObservationBuilder.cardRef(wrapper.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.confirmTrigger(wrapper);
    }

    @Override
    public boolean confirmPayment(CostPart costPart, String prompt, SpellAbility sa) {
        audit.recordStrategicFallback("confirmPayment", "confirmPayment", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.confirmPayment(costPart, prompt, sa);
    }

    @Override
    public boolean confirmReplacementEffect(ReplacementEffect replacementEffect, SpellAbility effectSA, GameEntity affected, String question) {
        audit.recordStrategicFallback("confirmReplacementEffect", "confirmReplacementEffect", effectSA == null ? null : AgentObservationBuilder.cardRef(effectSA.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.confirmReplacementEffect(replacementEffect, effectSA, affected, question);
    }

    @Override
    public List<Card> exertAttackers(List<Card> attackers) {
        audit.recordStrategicFallback("exertAttackers", "exertAttackers", null, "Pinned Forge AI fallback; see controller audit");
        return super.exertAttackers(attackers);
    }

    @Override
    public List<Card> enlistAttackers(List<Card> attackers) {
        audit.recordStrategicFallback("enlistAttackers", "enlistAttackers", null, "Pinned Forge AI fallback; see controller audit");
        return super.enlistAttackers(attackers);
    }

    @Override
    public CardCollection orderBlocker(Card attacker, Card blocker, CardCollection oldBlockers) {
        audit.recordStrategicFallback("orderBlocker", "orderBlocker", AgentObservationBuilder.cardRef(blocker), "Pinned Forge AI fallback; see controller audit");
        return super.orderBlocker(attacker, blocker, oldBlockers);
    }

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForScry(CardCollection topN) {
        audit.recordStrategicFallback("arrangeForScry", "arrangeForScry", null, "Pinned Forge AI fallback; see controller audit");
        return super.arrangeForScry(topN);
    }

    @Override
    public ImmutablePair<CardCollection, CardCollection> arrangeForSurveil(CardCollection topN) {
        audit.recordStrategicFallback("arrangeForSurveil", "arrangeForSurveil", null, "Pinned Forge AI fallback; see controller audit");
        return super.arrangeForSurveil(topN);
    }

    @Override
    public boolean willPutCardOnTop(Card c) {
        audit.recordStrategicFallback("willPutCardOnTop", "willPutCardOnTop", AgentObservationBuilder.cardRef(c), "Pinned Forge AI fallback; see controller audit");
        return super.willPutCardOnTop(c);
    }

    @Override
    public CardCollectionView orderMoveToZoneList(CardCollectionView cards, ZoneType destinationZone, SpellAbility source) {
        audit.recordStrategicFallback("orderMoveToZoneList", "orderMoveToZoneList", source == null ? null : AgentObservationBuilder.cardRef(source.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.orderMoveToZoneList(cards, destinationZone, source);
    }

    @Override
    public CardCollection chooseCardsToDiscardFrom(Player p, SpellAbility sa, CardCollection validCards, int min, int max, CardCollectionView visibleToChooser) {
        audit.recordStrategicFallback("chooseCardsToDiscardFrom", "chooseCardsToDiscardFrom", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseCardsToDiscardFrom(p, sa, validCards, min, max, visibleToChooser);
    }

    @Override
    public void playSpellAbilityNoStack(SpellAbility effectSA, boolean canSetupTargets) {
        audit.recordStrategicFallback("playSpellAbilityNoStack", "playSpellAbilityNoStack", effectSA == null ? null : AgentObservationBuilder.cardRef(effectSA.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        super.playSpellAbilityNoStack(effectSA, canSetupTargets);
    }

    @Override
    public CardCollectionView chooseCardsToDelve(int genericAmount, CardCollection grave) {
        audit.recordStrategicFallback("chooseCardsToDelve", "chooseCardsToDelve", null, "Pinned Forge AI fallback; see controller audit");
        return super.chooseCardsToDelve(genericAmount, grave);
    }

    @Override
    public CardCollectionView chooseCardsToDiscardUnlessType(int num, CardCollectionView hand, String[] uTypes, SpellAbility sa) {
        audit.recordStrategicFallback("chooseCardsToDiscardUnlessType", "chooseCardsToDiscardUnlessType", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseCardsToDiscardUnlessType(num, hand, uTypes, sa);
    }

    @Override
    public String chooseSomeType(String kindOfType, SpellAbility sa, Collection<String> validTypes, boolean isOptional) {
        audit.recordStrategicFallback("chooseSomeType", "chooseSomeType", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseSomeType(kindOfType, sa, validTypes, isOptional);
    }

    @Override
    public Object vote(SpellAbility sa, String prompt, List<Object> options, ListMultimap<Object, Player> votes, Player forPlayer, boolean optional) {
        audit.recordStrategicFallback("vote", "vote", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.vote(sa, prompt, options, votes, forPlayer, optional);
    }

    @Override
    public String chooseSector(Card assignee, String ai, List<String> sectors) {
        audit.recordStrategicFallback("chooseSector", "chooseSector", AgentObservationBuilder.cardRef(assignee), "Pinned Forge AI fallback; see controller audit");
        return super.chooseSector(assignee, ai, sectors);
    }

    @Override
    public int chooseSprocket(Card assignee, List<Integer> sprockets) {
        audit.recordStrategicFallback("chooseSprocket", "chooseSprocket", AgentObservationBuilder.cardRef(assignee), "Pinned Forge AI fallback; see controller audit");
        return super.chooseSprocket(assignee, sprockets);
    }

    @Override
    public PlanarDice choosePDRollToIgnore(List<PlanarDice> rolls) {
        audit.recordStrategicFallback("choosePDRollToIgnore", "choosePDRollToIgnore", null, "Pinned Forge AI fallback; see controller audit");
        return super.choosePDRollToIgnore(rolls);
    }

    @Override
    public Integer chooseRollToIgnore(List<Integer> rolls) {
        audit.recordStrategicFallback("chooseRollToIgnore", "chooseRollToIgnore", null, "Pinned Forge AI fallback; see controller audit");
        return super.chooseRollToIgnore(rolls);
    }

    @Override
    public List<Integer> chooseDiceToReroll(List<Integer> rolls) {
        audit.recordStrategicFallback("chooseDiceToReroll", "chooseDiceToReroll", null, "Pinned Forge AI fallback; see controller audit");
        return super.chooseDiceToReroll(rolls);
    }

    @Override
    public Integer chooseRollToModify(List<Integer> rolls) {
        audit.recordStrategicFallback("chooseRollToModify", "chooseRollToModify", null, "Pinned Forge AI fallback; see controller audit");
        return super.chooseRollToModify(rolls);
    }

    @Override
    public RollDiceEffect.DieRollResult chooseRollToSwap(List<RollDiceEffect.DieRollResult> rolls) {
        audit.recordStrategicFallback("chooseRollToSwap", "chooseRollToSwap", null, "Pinned Forge AI fallback; see controller audit");
        return super.chooseRollToSwap(rolls);
    }

    @Override
    public String chooseRollSwapValue(List<String> swapChoices, Integer currentResult, int power, int toughness) {
        audit.recordStrategicFallback("chooseRollSwapValue", "chooseRollSwapValue", null, "Pinned Forge AI fallback; see controller audit");
        return super.chooseRollSwapValue(swapChoices, currentResult, power, toughness);
    }

    @Override
    public boolean mulliganKeepHand(Player firstPlayer, int cardsToReturn) {
        audit.recordStrategicFallback("mulliganKeepHand", "mulliganKeepHand", null, "Pinned Forge AI fallback; see controller audit");
        return super.mulliganKeepHand(firstPlayer, cardsToReturn);
    }

    @Override
    public CardCollectionView tuckCardsViaMulligan(CardCollectionView hand, int cardsToReturn) {
        audit.recordStrategicFallback("tuckCardsViaMulligan", "tuckCardsViaMulligan", null, "Pinned Forge AI fallback; see controller audit");
        return super.tuckCardsViaMulligan(hand, cardsToReturn);
    }

    @Override
    public List<SpellAbility> chooseSpellAbilityToPlay() {
        audit.recordStrategicFallback("chooseSpellAbilityToPlay", "chooseSpellAbilityToPlay", null, "Pinned Forge AI fallback; see controller audit");
        return super.chooseSpellAbilityToPlay();
    }

    @Override
    public boolean playChosenSpellAbility(SpellAbility sa) {
        audit.recordStrategicFallback("playChosenSpellAbility", "playChosenSpellAbility", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.playChosenSpellAbility(sa);
    }

    @Override
    public CardCollectionView chooseCardsToDiscardToMaximumHandSize(int numDiscard) {
        audit.recordStrategicFallback("chooseCardsToDiscardToMaximumHandSize", "chooseCardsToDiscardToMaximumHandSize", null, "Pinned Forge AI fallback; see controller audit");
        return super.chooseCardsToDiscardToMaximumHandSize(numDiscard);
    }

    @Override
    public CardCollectionView chooseCardsToRevealFromHand(int min, int max, CardCollectionView valid) {
        audit.recordStrategicFallback("chooseCardsToRevealFromHand", "chooseCardsToRevealFromHand", null, "Pinned Forge AI fallback; see controller audit");
        return super.chooseCardsToRevealFromHand(min, max, valid);
    }

    @Override
    public Player chooseStartingPlayer(boolean isFirstGame) {
        audit.recordStrategicFallback("chooseStartingPlayer", "chooseStartingPlayer", null, "Pinned Forge AI fallback; see controller audit");
        return super.chooseStartingPlayer(isFirstGame);
    }

    @Override
    public PlayerZone chooseStartingHand(List<PlayerZone> zones) {
        audit.recordStrategicFallback("chooseStartingHand", "chooseStartingHand", null, "Pinned Forge AI fallback; see controller audit");
        return super.chooseStartingHand(zones);
    }

    @Override
    public List<SpellAbility> chooseSaToActivateFromOpeningHand(List<SpellAbility> usableFromOpeningHand) {
        audit.recordStrategicFallback("chooseSaToActivateFromOpeningHand", "chooseSaToActivateFromOpeningHand", null, "Pinned Forge AI fallback; see controller audit");
        return super.chooseSaToActivateFromOpeningHand(usableFromOpeningHand);
    }

    @Override
    public int chooseNumber(SpellAbility sa, String title, int min, int max) {
        audit.recordStrategicFallback("chooseNumber", "chooseNumber", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseNumber(sa, title, min, max);
    }

    @Override
    public int chooseNumber(SpellAbility sa, String string, int min, int max, Map<String, Object> params) {
        audit.recordStrategicFallback("chooseNumber", "chooseNumber", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseNumber(sa, string, min, max, params);
    }

    @Override
    public int chooseNumber(SpellAbility sa, String title, List<Integer> options, Player relatedPlayer) {
        audit.recordStrategicFallback("chooseNumber", "chooseNumber", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseNumber(sa, title, options, relatedPlayer);
    }

    @Override
    public boolean chooseFlipResult(SpellAbility sa, Player flipper, boolean call) {
        audit.recordStrategicFallback("chooseFlipResult", "chooseFlipResult", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseFlipResult(sa, flipper, call);
    }

    @Override
    public Pair<SpellAbilityStackInstance, GameObject> chooseTarget(SpellAbility saSrc, List<Pair<SpellAbilityStackInstance, GameObject>> allTargets) {
        audit.recordStrategicFallback("chooseTarget", "chooseTarget", saSrc == null ? null : AgentObservationBuilder.cardRef(saSrc.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseTarget(saSrc, allTargets);
    }

    @Override
    public boolean chooseBinary(SpellAbility sa, String question, BinaryChoiceType kindOfChoice, Boolean defaultVal) {
        audit.recordStrategicFallback("chooseBinary", "chooseBinary", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseBinary(sa, question, kindOfChoice, defaultVal);
    }

    @Override
    public boolean chooseBinary(SpellAbility sa, String question, BinaryChoiceType kindOfChoice, Map<String, Object> params) {
        audit.recordStrategicFallback("chooseBinary", "chooseBinary", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseBinary(sa, question, kindOfChoice, params);
    }

    @Override
    public List<AbilitySub> chooseModeForAbility(SpellAbility sa, List<AbilitySub> possible, int min, int num, boolean allowRepeat) {
        audit.recordStrategicFallback("chooseModeForAbility", "chooseModeForAbility", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseModeForAbility(sa, possible, min, num, allowRepeat);
    }

    @Override
    public byte chooseColorAllowColorless(String message, Card card, ColorSet colors) {
        audit.recordStrategicFallback("chooseColorAllowColorless", "chooseColorAllowColorless", AgentObservationBuilder.cardRef(card), "Pinned Forge AI fallback; see controller audit");
        return super.chooseColorAllowColorless(message, card, colors);
    }

    @Override
    public byte chooseColor(String message, SpellAbility sa, ColorSet colors) {
        audit.recordStrategicFallback("chooseColor", "chooseColor", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseColor(message, sa, colors);
    }

    @Override
    public ColorSet chooseColors(String message, SpellAbility sa, int min, int max, ColorSet options) {
        audit.recordStrategicFallback("chooseColors", "chooseColors", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseColors(message, sa, min, max, options);
    }

    @Override
    public CounterType chooseCounterType(List<CounterType> options, SpellAbility sa, String prompt,
            Map<String, Object> params) {
        audit.recordStrategicFallback("chooseCounterType", "chooseCounterType", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseCounterType(options, sa, prompt, params);
    }

    @Override
    public String chooseKeywordForPump(final List<String> options, final SpellAbility sa, final String prompt, final Card tgtCard) {
        audit.recordStrategicFallback("chooseKeywordForPump", "chooseKeywordForPump", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseKeywordForPump(options, sa, prompt, tgtCard);
    }

    @Override
    public ReplacementEffect chooseSingleReplacementEffect(List<ReplacementEffect> possibleReplacers) {
        audit.recordStrategicFallback("chooseSingleReplacementEffect", "chooseSingleReplacementEffect", null, "Pinned Forge AI fallback; see controller audit");
        return super.chooseSingleReplacementEffect(possibleReplacers);
    }

    @Override
    public String chooseProtectionType(SpellAbility sa, List<String> choices) {
        audit.recordStrategicFallback("chooseProtectionType", "chooseProtectionType", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseProtectionType(sa, choices);
    }

    @Override
    public boolean payManaCost(ManaCost toPay, CostPartMana costPartMana, SpellAbility sa, String prompt , ManaConversionMatrix matrix, boolean effect) {
        // A basic mana ability's zero mana payment has no strategic selection.
        if (!(sa.isManaAbility() && (toPay.isZero() || toPay.isNoCost())))
            audit.recordStrategicFallback("payManaCost", "payManaCost", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.payManaCost(toPay, costPartMana, sa, prompt, matrix, effect);
    }

    @Override
    public boolean payCombatCost(Card c, Cost cost, SpellAbility sa, String prompt) {
        audit.recordStrategicFallback("payCombatCost", "payCombatCost", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.payCombatCost(c, cost, sa, prompt);
    }

    @Override
    public CardCollectionView chooseCardsForCost(CardCollectionView optionList, SpellAbility sa, CostPartWithList cpl, int amount, boolean isOptional, String prompt) {
        audit.recordStrategicFallback("chooseCardsForCost", "chooseCardsForCost", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseCardsForCost(optionList, sa, cpl, amount, isOptional, prompt);
    }

    @Override
    public boolean applyManaToCost(ManaCostBeingPaid toPay, SpellAbility ability, String prompt, ManaConversionMatrix matrix, boolean effect) {
        audit.recordStrategicFallback("applyManaToCost", "applyManaToCost", ability == null ? null : AgentObservationBuilder.cardRef(ability.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.applyManaToCost(toPay, ability, prompt, matrix, effect);
    }

    @Override
    public CostDecisionMakerBase getCostDecisionMaker(Player player, SpellAbility ability, boolean effect, String prompt) {
        audit.recordStrategicFallback("getCostDecisionMaker", "getCostDecisionMaker", ability == null ? null : AgentObservationBuilder.cardRef(ability.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.getCostDecisionMaker(player, ability, effect, prompt);
    }

    @Override
    public boolean payCostToPreventEffect(Cost cost, SpellAbility sa, boolean alreadyPaid, FCollectionView<Player> allPayers) {
        audit.recordStrategicFallback("payCostToPreventEffect", "payCostToPreventEffect", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.payCostToPreventEffect(cost, sa, alreadyPaid, allPayers);
    }

    @Override
    public boolean payCostDuringRoll(final Cost cost, final SpellAbility sa) {
        audit.recordStrategicFallback("payCostDuringRoll", "payCostDuringRoll", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.payCostDuringRoll(cost, sa);
    }

    @Override
    public List<SpellAbility> orderSimultaneousSa(List<SpellAbility> activePlayerSAs) {
        audit.recordStrategicFallback("orderSimultaneousSa", "orderSimultaneousSa", null, "Pinned Forge AI fallback; see controller audit");
        return super.orderSimultaneousSa(activePlayerSAs);
    }

    @Override
    public void orderAndPlaySimultaneousSa(List<SpellAbility> activePlayerSAs) {
        audit.recordStrategicFallback("orderAndPlaySimultaneousSa", "orderAndPlaySimultaneousSa", null, "Pinned Forge AI fallback; see controller audit");
        super.orderAndPlaySimultaneousSa(activePlayerSAs);
    }

    @Override
    public boolean playTrigger(Card host, WrappedAbility wrapperAbility, boolean isMandatory) {
        audit.recordStrategicFallback("playTrigger", "playTrigger", wrapperAbility == null ? null : AgentObservationBuilder.cardRef(wrapperAbility.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.playTrigger(host, wrapperAbility, isMandatory);
    }

    @Override
    public boolean playSaFromPlayEffect(SpellAbility tgtSA) {
        audit.recordStrategicFallback("playSaFromPlayEffect", "playSaFromPlayEffect", tgtSA == null ? null : AgentObservationBuilder.cardRef(tgtSA.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.playSaFromPlayEffect(tgtSA);
    }

    @Override
    public boolean chooseTargetsFor(SpellAbility currentAbility) {
        audit.recordStrategicFallback("chooseTargetsFor", "chooseTargetsFor", currentAbility == null ? null : AgentObservationBuilder.cardRef(currentAbility.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseTargetsFor(currentAbility);
    }

    @Override
    public TargetChoices chooseNewTargetsFor(SpellAbility ability, Predicate<GameObject> filter, boolean optional) {
        audit.recordStrategicFallback("chooseNewTargetsFor", "chooseNewTargetsFor", ability == null ? null : AgentObservationBuilder.cardRef(ability.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseNewTargetsFor(ability, filter, optional);
    }

    @Override
    public boolean chooseCardsPile(SpellAbility sa, CardCollectionView pile1, CardCollectionView pile2, String faceUp) {
        audit.recordStrategicFallback("chooseCardsPile", "chooseCardsPile", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseCardsPile(sa, pile1, pile2, faceUp);
    }

    @Override
    public CardCollectionView cheatShuffle(CardCollectionView list) {
        audit.recordStrategicFallback("cheatShuffle", "cheatShuffle", null, "Pinned Forge AI fallback; see controller audit");
        return super.cheatShuffle(list);
    }

    @Override
    public Map<Card, ManaCostShard> chooseCardsForConvokeOrImprovise(SpellAbility sa, ManaCost manaCost, CardCollectionView untappedCards, boolean artifacts, boolean creatures, Integer maxReduction) {
        audit.recordStrategicFallback("chooseCardsForConvokeOrImprovise", "chooseCardsForConvokeOrImprovise", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseCardsForConvokeOrImprovise(sa, manaCost, untappedCards, artifacts, creatures, maxReduction);
    }

    @Override
    public String chooseCardName(SpellAbility sa, List<ICardFace> faces, String message) {
        audit.recordStrategicFallback("chooseCardName", "chooseCardName", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseCardName(sa, faces, message);
    }

    @Override
    public String chooseCardName(SpellAbility sa, Predicate<ICardFace> cpp, String valid, String message) {
        audit.recordStrategicFallback("chooseCardName", "chooseCardName", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseCardName(sa, cpp, valid, message);
    }

    @Override
    public Card chooseSingleCardForZoneChange(ZoneType destination,
            List<ZoneType> origin, SpellAbility sa, CardCollection fetchList, DelayedReveal delayedReveal,
            String selectPrompt, boolean isOptional, Player decider) {
        audit.recordStrategicFallback("chooseSingleCardForZoneChange", "chooseSingleCardForZoneChange", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseSingleCardForZoneChange(destination, origin, sa, fetchList, delayedReveal, selectPrompt, isOptional, decider);
    }

    @Override
    public List<Card> chooseCardsForZoneChange(
	    ZoneType destination, List<ZoneType> origin, SpellAbility sa, CardCollection fetchList, int min, int max,
            DelayedReveal delayedReveal, String selectPrompt, Player decider) {
        audit.recordStrategicFallback("chooseCardsForZoneChange", "chooseCardsForZoneChange", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseCardsForZoneChange(destination, origin, sa, fetchList, min, max, delayedReveal, selectPrompt, decider);
    }

    @Override
    public ICardFace chooseSingleCardFace(SpellAbility sa, List<ICardFace> faces, String message) {
        audit.recordStrategicFallback("chooseSingleCardFace", "chooseSingleCardFace", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseSingleCardFace(sa, faces, message);
    }

    @Override
    public ICardFace chooseSingleCardFace(SpellAbility sa, String message, Predicate<ICardFace> cpp, String name) {
        audit.recordStrategicFallback("chooseSingleCardFace", "chooseSingleCardFace", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseSingleCardFace(sa, message, cpp, name);
    }

    @Override
    public CardState chooseSingleCardState(SpellAbility sa, List<CardState> states, String message, Map<String, Object> params) {
        audit.recordStrategicFallback("chooseSingleCardState", "chooseSingleCardState", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseSingleCardState(sa, states, message, params);
    }

    @Override
    public List<Card> chooseCardsForSplice(SpellAbility sa, List<Card> cards) {
        audit.recordStrategicFallback("chooseCardsForSplice", "chooseCardsForSplice", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseCardsForSplice(sa, cards);
    }

    @Override
    public List<OptionalCostValue> chooseOptionalCosts(SpellAbility chosen, List<OptionalCostValue> optionalCostValues) {
        audit.recordStrategicFallback("chooseOptionalCosts", "chooseOptionalCosts", chosen == null ? null : AgentObservationBuilder.cardRef(chosen.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseOptionalCosts(chosen, optionalCostValues);
    }

    @Override
    public int chooseNumberForKeywordCost(SpellAbility sa, Cost cost, KeywordInterface keyword, String prompt, int max) {
        audit.recordStrategicFallback("chooseNumberForKeywordCost", "chooseNumberForKeywordCost", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseNumberForKeywordCost(sa, cost, keyword, prompt, max);
    }

    @Override
    public int chooseNumberForCostReduction(final SpellAbility sa, final int min, final int max) {
        audit.recordStrategicFallback("chooseNumberForCostReduction", "chooseNumberForCostReduction", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseNumberForCostReduction(sa, min, max);
    }

    @Override
    public CardCollection chooseCardsForEffectMultiple(Map<String, CardCollection> validMap, SpellAbility sa, String title, boolean isOptional) {
        audit.recordStrategicFallback("chooseCardsForEffectMultiple", "chooseCardsForEffectMultiple", sa == null ? null : AgentObservationBuilder.cardRef(sa.getHostCard()), "Pinned Forge AI fallback; see controller audit");
        return super.chooseCardsForEffectMultiple(validMap, sa, title, isOptional);
    }
}
