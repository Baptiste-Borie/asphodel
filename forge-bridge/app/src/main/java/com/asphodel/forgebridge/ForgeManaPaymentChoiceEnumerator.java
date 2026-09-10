package com.asphodel.forgebridge;

import forge.card.MagicColor;
import forge.card.mana.ManaAtom;
import forge.card.mana.ManaCostShard;
import forge.game.card.Card;
import forge.game.cost.CostPart;
import forge.game.cost.CostPartMana;
import forge.game.cost.CostTap;
import forge.game.mana.Mana;
import forge.game.mana.ManaCostBeingPaid;
import forge.game.player.Player;
import forge.game.spellability.AbilityManaPart;
import forge.game.spellability.AlternativeCost;
import forge.game.spellability.SpellAbility;
import forge.game.zone.ZoneType;

import java.util.ArrayList;
import java.util.Arrays;
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
        // Madness is excluded from the general "any alternative cost" exclusion below: unlike
        // Escape/Emerge/Offering (which bake extra non-mana CostParts -- exile from graveyard,
        // sacrifice a creature, type restrictions -- into the SAME Cost object), a Madness cast's
        // cost (built by vendor PlayEffect.resolve via Cost#Cost(String, boolean) from the card's
        // plain "PlayCost$" mana-cost string) is structurally an ordinary CostPartMana with nothing
        // else attached. getAlternativeCost() here is purely a post-hoc marker (stack description,
        // "cast for Madness" bookkeeping), not evidence of a different payment shape, so there is no
        // reason to force it to fall back to AuditedPlayerControllerAi the way genuinely
        // differently-shaped alternative costs correctly still do.
        if (ability.getAlternativeCost() != null && ability.getAlternativeCost() != AlternativeCost.Madness) {
            return false;
        }
        if (cost.isExiledCreatureCost()
                || cost.isEnchantedCreatureCost()
                || cost.getMaxWaterbend() != null
                || ability.getMaxWaterbend() != null
                || ability.getPayCosts().isMandatory()
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
                if (seen.put(manaAbility, Boolean.TRUE) != null
                        || !isBaseUsableAbility(player, paidFor, cost, manaAbility, usableColors)) {
                    continue;
                }
                List<AbilityManaPart> parts = manaAbility.getAllManaParts();
                if (parts.size() == 1 && isSupportedFiniteChoicePart(parts.get(0), paidFor)
                        && manaAbility.totalAmountOfManaGenerated(paidFor, true) == 1
                        && !hasManaReplacement(player)) {
                    result.addAll(comboColorIdentityCandidates(player, manaAbility, parts.get(0), cost, usableColors));
                } else if (parts.stream().allMatch(part -> isSimpleFixedPart(part, paidFor))) {
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
        if (ability == null || !player.getCardsIn(ZoneType.Battlefield).contains(ability.getHostCard())) {
            return false;
        }
        byte usableColors = usableColors(player, cost);
        if (!isBaseUsableAbility(player, paidFor, cost, ability, usableColors)) {
            return false;
        }
        if (candidate.forcedColor() != null) {
            return isForcedColorStillLegal(player, paidFor, cost, ability, candidate.forcedColor());
        }
        return ability.getAllManaParts().stream().allMatch(part -> isSimpleFixedPart(part, paidFor));
    }

    /**
     * Revalidates a forced-color candidate immediately before mutation (V2e.6.1 §6; generalized
     * beyond Command Tower to any finite-choice source in V2e.8, e.g. Strangled Cemetery's "Add
     * {B} or {G}"): the source/ability legality itself was already reconfirmed by
     * {@code isBaseUsableAbility} above; this additionally re-derives Forge's own current finite
     * color set (commander-color-identity for a "Combo ColorIdentity" source, or the literal fixed
     * list for a "Combo &lt;colors&gt;" source) and confirms the SPECIFIC previously-selected color
     * is still both legal and still useful for the current remaining cost. Never substitutes a
     * different color if the original choice is no longer valid — the candidate is simply
     * rejected, exactly like any other stale candidate.
     */
    private static boolean isForcedColorStillLegal(
            Player player,
            SpellAbility paidFor,
            ManaCostBeingPaid cost,
            SpellAbility ability,
            String forcedColor
    ) {
        List<AbilityManaPart> parts = ability.getAllManaParts();
        if (parts.size() != 1 || !isSupportedFiniteChoicePart(parts.get(0), paidFor)
                || ability.totalAmountOfManaGenerated(paidFor, true) != 1 || hasManaReplacement(player)) {
            return false;
        }
        String combo = parts.get(0).getComboColors(ability);
        if (combo.isBlank() || !Arrays.asList(combo.trim().split("\\s+")).contains(forcedColor)) {
            return false;
        }
        return cost.isAnyPartPayableWith(ManaAtom.fromName(forcedColor), player.getManaPool());
    }

    /**
     * Derives ONE external candidate per currently-useful, legal color for a finite-choice combo
     * mana ability (V2e.6.1 §§3-4; generalized in V2e.8 §§16-20): Command Tower on a WB commander
     * externalizes as up to two candidates, "-> W" and "-> B"; Strangled Cemetery ("Add {B} or
     * {G}") likewise externalizes as "-> B" and "-> G" — NEVER a vague
     * {@code produces: ["Combo","B","G"]} and never a color the source cannot actually produce.
     * Colors are Forge's own ({@link AbilityManaPart#getComboColors}, which resolves either the
     * controller's real {@code getCommanderColorID()} for a "Combo ColorIdentity" source, or the
     * literal fixed list for a "Combo &lt;colors&gt;" source like Strangled Cemetery's "Combo B
     * G" — never inferred from card names/decklists/Scryfall), intersected with the SAME
     * {@code usableColors} affordability mask every other candidate in this enumerator is already
     * filtered through (never a bespoke calculator).
     */
    private static List<Candidate> comboColorIdentityCandidates(
            Player player,
            SpellAbility manaAbility,
            AbilityManaPart part,
            ManaCostBeingPaid cost,
            byte usableColors
    ) {
        List<Candidate> result = new ArrayList<>();
        String combo = part.getComboColors(manaAbility);
        if (combo.isBlank()) {
            return result;
        }
        for (String colorCode : combo.trim().split("\\s+")) {
            byte colorAtom = ManaAtom.fromName(colorCode);
            if ((usableColors & colorAtom) == 0 || !cost.isAnyPartPayableWith(colorAtom, player.getManaPool())) {
                continue;
            }
            result.add(Candidate.comboColorIdentity(manaAbility, colorCode));
        }
        return result;
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

    /**
     * Base activation-legality gate shared by BOTH the simple-fixed-mana path and the narrow
     * "Combo ColorIdentity" path (V2e.6.1 §2): everything except the per-part production shape,
     * which the two callers (enumerate/isStillLegal) branch on separately since combo and
     * non-combo parts are validated differently from here on.
     */
    private static boolean isBaseUsableAbility(
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
        return !ability.getAllManaParts().isEmpty();
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

    /**
     * Checks shared by every supported production shape (fixed-mana AND the narrow "Combo
     * ColorIdentity" subset): no arbitrary/special/snow mana, no restrictions, no side effects.
     * {@code isComboMana()} is deliberately excluded here — the two callers below decide whether
     * combo mana is acceptable (only the pinned "Combo ColorIdentity" shape is, per V2e.6.1 §2).
     */
    private static boolean isBaseSimplePart(AbilityManaPart part, SpellAbility paidFor) {
        return !part.isAnyMana()
                && !part.isSpecialMana()
                && !part.isSnow()
                && part.getManaRestrictions().isEmpty()
                && part.getExtraManaRestriction().isEmpty()
                && !part.isCannotCounterPaidWith()
                && !part.addsCounters(paidFor)
                && !part.addKeywords(paidFor)
                && !part.getTriggersWhenSpent();
    }

    private static boolean isSimpleFixedPart(AbilityManaPart part, SpellAbility paidFor) {
        return isBaseSimplePart(part, paidFor) && !part.isComboMana();
    }

    /**
     * The finite combo-mana shapes this bridge externalizes (V2e.6.1 §2): a simple mana part whose
     * {@code isComboMana()} is true and whose original production is specifically the pinned
     * Forge string "Combo ColorIdentity" or a literal list of color symbols. Deliberately narrow and
     * documented rather than broadly enabling arbitrary combo mana.
     */
    private static boolean isSupportedFiniteChoicePart(AbilityManaPart part, SpellAbility paidFor) {
        return isBaseSimplePart(part, paidFor)
                && part.isComboMana()
                && ("Combo ColorIdentity".equals(part.getOrigProduced())
                    || part.getOrigProduced().matches("Combo [WUBRGC]( [WUBRGC])*"));
    }

    /** Conservative: a live production replacement requires a richer payment model. */
    private static boolean hasManaReplacement(Player player) {
        for (Card card : player.getGame().getCardsIn(ZoneType.Battlefield)) {
            if (card.getReplacementEffects().stream().anyMatch(effect ->
                    effect.getMode() == forge.game.replacement.ReplacementType.ProduceMana)) return true;
        }
        return false;
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
            String color,
            String forcedColor
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
                    null,
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
                    MagicColor.toShortString(mana.getColor()),
                    null
            );
        }

        /**
         * One exact "Command Tower -> W"-style candidate (V2e.6.1 §3): {@code produces} is the
         * single forced color only (e.g. {@code ["W"]}), NEVER the vague
         * {@code ["Combo","ColorIdentity"]} shape Forge itself uses internally. {@code forcedColor}
         * carries the exact color that must later be pushed through
         * {@link forge.game.spellability.AbilityManaPart#setExpressChoice(String)} for this one
         * activation (V2e.6.1 §5).
         */
        static Candidate comboColorIdentity(SpellAbility ability, String forcedColor) {
            Card source = ability.getHostCard();
            return new Candidate(
                    "activate_mana_ability",
                    ability,
                    null,
                    AgentObservationBuilder.cardRef(source),
                    source.getName(),
                    AgentObservationBuilder.shortText(ability.getDescription()),
                    List.of(forcedColor),
                    source.isTapped(),
                    forcedColor,
                    forcedColor
            );
        }
    }
}
