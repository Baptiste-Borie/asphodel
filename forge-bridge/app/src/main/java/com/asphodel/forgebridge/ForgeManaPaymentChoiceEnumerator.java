package com.asphodel.forgebridge;

import forge.card.MagicColor;
import forge.card.mana.ManaCostShard;
import forge.game.card.Card;
import forge.game.cost.CostPart;
import forge.game.cost.CostPartMana;
import forge.game.cost.CostTap;
import forge.game.mana.Mana;
import forge.game.mana.ManaCostBeingPaid;
import forge.game.player.Player;
import forge.game.spellability.AbilityManaPart;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;

import java.util.ArrayList;
import java.util.EnumSet;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Enumerates the deliberately small mana-payment subset externalized in V1i.
 * Every candidate retains the exact Forge object that will later be consumed.
 */
final class ForgeManaPaymentChoiceEnumerator {
    private static final Set<ManaCostShard> SUPPORTED_SHARDS = EnumSet.of(
            ManaCostShard.WHITE,
            ManaCostShard.BLUE,
            ManaCostShard.BLACK,
            ManaCostShard.RED,
            ManaCostShard.GREEN,
            ManaCostShard.COLORLESS,
            ManaCostShard.GENERIC,
            ManaCostShard.WU,
            ManaCostShard.WB,
            ManaCostShard.UB,
            ManaCostShard.UR,
            ManaCostShard.BR,
            ManaCostShard.BG,
            ManaCostShard.RW,
            ManaCostShard.RG,
            ManaCostShard.GW,
            ManaCostShard.GU,
            ManaCostShard.CW,
            ManaCostShard.CU,
            ManaCostShard.CB,
            ManaCostShard.CR,
            ManaCostShard.CG
    );

    boolean supportsPaymentShape(SpellAbility ability, CostPartMana cost, boolean effect) {
        if (ability == null || cost == null || effect || ability.isOffering() || ability.isEmerge()) {
            return false;
        }
        if (cost.isExiledCreatureCost()
                || cost.isEnchantedCreatureCost()
                || cost.getMaxWaterbend() != null
                || ability.getMaxWaterbend() != null
                || ability.getPayCosts().isMandatory()
                || ability.getAlternativeCost() != null
                || ability.hasParam("TapCreaturesForMana")) {
            return false;
        }
        Card host = ability.getHostCard();
        return !host.hasKeyword("Convoke")
                && !host.hasKeyword("Delve")
                && !host.hasKeyword("Improvise")
                && !host.hasKeyword("Assist");
    }

    boolean supportsAdjustedCost(ManaCostBeingPaid cost) {
        return cost.getUnpaidShards().stream().allMatch(SUPPORTED_SHARDS::contains);
    }

    List<Candidate> enumerate(Player player, SpellAbility paidFor, ManaCostBeingPaid cost) {
        List<Candidate> result = new ArrayList<>();
        for (Mana mana : player.getManaPool()) {
            if (isUsableFloatingMana(player, paidFor, cost, mana)) {
                result.add(Candidate.floating(mana));
            }
        }

        byte usableColors = usableColors(player, cost);
        if (usableColors == 0) {
            return result;
        }
        Map<SpellAbility, Boolean> seen = new IdentityHashMap<>();
        for (Card card : player.getCardsIn(ZoneType.Battlefield)) {
            for (SpellAbility manaAbility : card.getManaAbilities()) {
                manaAbility.setActivatingPlayer(player);
                if (seen.put(manaAbility, Boolean.TRUE) == null
                        && isUsableAbility(player, paidFor, cost, manaAbility, usableColors)) {
                    result.add(Candidate.ability(
                            manaAbility,
                            producedSymbols(manaAbility, paidFor)
                    ));
                }
            }
        }
        return result;
    }

    boolean isStillLegal(
            Player player,
            SpellAbility paidFor,
            ManaCostBeingPaid cost,
            Candidate candidate
    ) {
        if (candidate.mana() != null) {
            return containsIdentity(player, candidate.mana())
                    && isUsableFloatingMana(player, paidFor, cost, candidate.mana());
        }
        SpellAbility ability = candidate.ability();
        return ability != null
                && player.getCardsIn(ZoneType.Battlefield).contains(ability.getHostCard())
                && isUsableAbility(player, paidFor, cost, ability, usableColors(player, cost));
    }

    private static boolean isUsableFloatingMana(
            Player player,
            SpellAbility paidFor,
            ManaCostBeingPaid cost,
            Mana mana
    ) {
        return !mana.isSnow()
                && !mana.isRestricted()
                && mana.meetsManaRestrictions(paidFor)
                && paidFor.allowsPayingWithShard(mana.getSourceCard(), mana.getColor())
                && cost.isNeeded(mana, player.getManaPool());
    }

    private static boolean isUsableAbility(
            Player player,
            SpellAbility paidFor,
            ManaCostBeingPaid cost,
            SpellAbility ability,
            byte usableColors
    ) {
        if (usableColors == 0
                || ability.getHostCard().getController() != player
                || ability.getSubAbility() != null
                || !ability.isManaAbility()
                || hasConditionalOrVariableProduction(ability)
                || !ability.canPlay(true)
                || !ability.isManaAbilityFor(paidFor, usableColors)
                || !hasOnlyTapCost(ability)
                || ability.totalAmountOfManaGenerated(paidFor, true) <= 0) {
            return false;
        }
        List<AbilityManaPart> parts = ability.getAllManaParts();
        return !parts.isEmpty() && parts.stream().allMatch(part -> isSimpleFixedPart(part, paidFor));
    }

    private static boolean hasConditionalOrVariableProduction(SpellAbility ability) {
        if (ability.getMapParams().keySet().stream().anyMatch(
                key -> key.startsWith("Condition")
        )) {
            return true;
        }
        return ability.hasParam("Amount")
                && !ability.getParam("Amount").matches("[1-9][0-9]*");
    }

    private static boolean hasOnlyTapCost(SpellAbility ability) {
        List<CostPart> parts = ability.getPayCosts().getCostParts();
        return parts.size() == 1 && parts.get(0) instanceof CostTap;
    }

    private static boolean isSimpleFixedPart(AbilityManaPart part, SpellAbility paidFor) {
        return !part.isAnyMana()
                && !part.isComboMana()
                && !part.isSpecialMana()
                && !part.isSnow()
                && part.getManaRestrictions().isEmpty()
                && part.getExtraManaRestriction().isEmpty()
                && !part.isCannotCounterPaidWith()
                && !part.addsCounters(paidFor)
                && !part.addKeywords(paidFor)
                && !part.getTriggersWhenSpent();
    }

    private static byte usableColors(Player player, ManaCostBeingPaid cost) {
        byte result = 0;
        for (byte color : forge.card.mana.ManaAtom.MANATYPES) {
            if (cost.isAnyPartPayableWith(color, player.getManaPool())) {
                result |= color;
            }
        }
        if (cost.isAnyPartPayableWith(
                (byte) forge.card.mana.ManaAtom.GENERIC,
                player.getManaPool()
        )) {
            result |= (byte) forge.card.mana.ManaAtom.GENERIC;
        }
        return result;
    }

    private static boolean containsIdentity(Player player, Mana expected) {
        for (Mana mana : player.getManaPool()) {
            if (mana == expected) {
                return true;
            }
        }
        return false;
    }

    private static List<String> producedSymbols(
            SpellAbility ability,
            SpellAbility paidFor
    ) {
        List<String> result = new ArrayList<>();
        for (AbilityManaPart part : ability.getAllManaParts()) {
            for (String symbol : part.getOrigProduced().trim().split("\\s+")) {
                if (!symbol.isBlank()) {
                    result.add(symbol);
                }
            }
        }
        int forgeAmount = ability.totalAmountOfManaGenerated(paidFor, true);
        if (result.size() == 1 && forgeAmount > 1) {
            String symbol = result.get(0);
            while (result.size() < forgeAmount) {
                result.add(symbol);
            }
        }
        return List.copyOf(result);
    }

    record Candidate(
            String type,
            SpellAbility ability,
            Mana mana,
            String sourceCardRef,
            String sourceCardName,
            String abilityText,
            List<String> produces,
            boolean tapped,
            String color
    ) {
        static Candidate ability(SpellAbility ability, List<String> produces) {
            Card source = ability.getHostCard();
            return new Candidate(
                    "activate_mana_ability",
                    ability,
                    null,
                    AgentObservationBuilder.cardRef(source),
                    source.getName(),
                    AgentObservationBuilder.shortText(ability.getDescription()),
                    produces,
                    source.isTapped(),
                    null
            );
        }

        static Candidate floating(Mana mana) {
            return new Candidate(
                    "spend_floating_mana",
                    null,
                    mana,
                    null,
                    null,
                    null,
                    List.of(),
                    false,
                    MagicColor.toShortString(mana.getColor())
            );
        }
    }
}
