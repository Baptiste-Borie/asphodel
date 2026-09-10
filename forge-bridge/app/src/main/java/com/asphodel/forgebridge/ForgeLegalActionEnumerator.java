package com.asphodel.forgebridge;

import forge.ai.ComputerUtilAbility;
import forge.ai.ComputerUtilCost;
import forge.ai.ComputerUtilMana;
import forge.game.Game;
import forge.game.card.Card;
import forge.game.cost.Cost;
import forge.game.mana.ManaCostBeingPaid;
import forge.game.player.Player;
import forge.game.spellability.SpellAbility;
import forge.game.zone.Zone;
import forge.game.zone.ZoneType;

import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * Enumerates supported primary actions using Forge rule and feasibility APIs.
 *
 * <p>This class deliberately contains no scoring, ordering preference, or call
 * to {@code AiController.canPlaySa}. It only answers whether a supported action
 * can be attempted in the current game state.</p>
 *
 * <p>Supported primary action types are {@code play_land}, {@code cast_spell},
 * and {@code activate_ability}. Mana abilities, triggered abilities, and other
 * special actions are never classified as one of these and are therefore never
 * exposed. Alternative costs (e.g. Flashback) are mechanically exposed because
 * {@code Card.getAllPossibleAbilities} enumerates them as separate
 * {@link SpellAbility} instances that pass through the same restriction and
 * affordability checks as a normal cast, but this is PASS WITH LIMITATION —
 * it is not proven correct end-to-end by a dedicated test. Mandatory
 * additional costs (e.g. sacrifice) are accounted for by
 * {@link ComputerUtilCost#canPayCost} for affordability; V1h externalizes the
 * supported fixed-one object choices during execution. Optional costs are
 * likewise execution-time choices. Bounded untargeted {@code Count$xPaid}
 * actions are exposed after Forge computes their legal X range; other X shapes
 * remain omitted.</p>
 */
final class ForgeLegalActionEnumerator {
    private final ForgeValueDecisionBuilder valueDecisions =
            new ForgeValueDecisionBuilder();

    List<Candidate> enumerate(Game game, Player player) {
        List<Candidate> candidates = new ArrayList<>();
        for (Card card : visibleCandidateCards(player)) {
            for (SpellAbility ability : card.getAllPossibleAbilities(player, true)) {
                ability.setActivatingPlayer(player);
                ActionType type = classify(ability);
                if (type == null || !isPlayable(card, ability, player)) {
                    continue;
                }
                candidates.add(new Candidate(
                        type,
                        ability,
                        "card-" + card.getId(),
                        card.getName(),
                        sourceZone(game.getZoneOf(card)),
                        label(type, card),
                        shortAbilityText(ability),
                        manaCost(ability),
                        requiresTargets(ability)
                ));
            }
        }
        return List.copyOf(candidates);
    }

    /**
     * Scope candidate discovery to the external player's own visible information.
     *
     * <p>Only zones whose card identities are public to their controller are
     * scanned. Opponent zones are never scanned, and — deliberately, even for
     * the external player's own side — {@link ZoneType#Library} is never
     * scanned either: the top card of a library is hidden information until
     * something reveals it, so enumerating abilities off of it (as V1c did)
     * would leak identity that Forge itself would not disclose. Play from
     * library is therefore NOT IMPLEMENTED in V1d; it requires an explicit
     * model of Forge's play/reveal permissions before it can be exposed
     * safely, which is deferred to a future pass.</p>
     */
    private static Set<Card> visibleCandidateCards(Player player) {
        Set<Card> cards = new LinkedHashSet<>();
        cards.addAll(player.getCardsIn(ZoneType.Hand));
        cards.addAll(player.getCardsIn(ZoneType.Battlefield));
        cards.addAll(player.getCardsIn(ZoneType.Command));
        cards.addAll(player.getCardsIn(ZoneType.Graveyard));
        cards.addAll(player.getCardsIn(ZoneType.Exile));
        return cards;
    }

    private static ActionType classify(SpellAbility ability) {
        if (ability.isLandAbility()) {
            return ActionType.PLAY_LAND;
        }
        if (ability.isSpell()) {
            return ActionType.CAST_SPELL;
        }
        if (ability.isActivatedAbility() && !ability.isManaAbility() && !ability.isTrigger()) {
            return ActionType.ACTIVATE_ABILITY;
        }
        return null;
    }

    private boolean isPlayable(
            Card card,
            SpellAbility ability,
            Player player
    ) {
        if (ability.getPayCosts() != null && ability.getPayCosts().hasXInAnyCostPart()) {
            if (!valueDecisions.supportsPrimaryAction(ability, player)) {
                return false;
            }
            Integer previousX = ability.getXManaCostPaid();
            ForgeValueDecisionBuilder.Decision value = valueDecisions.buildX(
                    ability, player, 0, Integer.MAX_VALUE
            );
            ability.setXManaCostPaid(value.minValue());
            boolean payable = canPayCostAllowingPhyrexianLife(ability, player);
            ability.setXManaCostPaid(previousX);
            if (!payable) {
                return false;
            }
        }
        if (!ability.checkRestrictions(card, player)) {
            return false;
        }
        if (!ability.isLegalAfterStack() || !ability.canPlay()) {
            return false;
        }
        if (!canPayCostAllowingPhyrexianLife(ability, player)) {
            return false;
        }
        return ComputerUtilAbility.isFullyTargetable(ability);
    }

    /**
     * {@link ComputerUtilCost#canPayCost} delegates to {@code ComputerUtilMana}'s AI mana-payment
     * heuristic, reused here purely as a feasibility oracle. That heuristic assigns real mana
     * sources to color-matching pips (including Phyrexian ones) before the generic portion of a
     * cost — deliberately, so the AI keeps its life when it has the mana to spare — and it never
     * backtracks. When a board's mana sources are exactly the color a card's Phyrexian pips want
     * (e.g. K'rrik, Son of Yawgmoth's {@code {4}{B/P}{B/P}{B/P}} from a Swamp-only manabase), that
     * single-pass assignment can starve the generic portion of real sources and report the cost as
     * unpayable — even though MTG rule 118.4a lets every Phyrexian pip be paid with 2 life instead
     * of mana, independent of whether matching mana is available. A real match (untapped lands as
     * mana SOURCES, discovered through {@code ComputerUtilMana}'s source-search) hits exactly this:
     * the regression-tested claim that {4} + 6 life is legal only held for a fixture that floated
     * mana directly into the pool, short-circuiting that source search entirely (see
     * {@code KrrikPhyrexianCastLegalityTest}'s real-land threshold tests).
     *
     * <p>This retries a failed check with every Phyrexian pip pre-committed to its life
     * alternative — bypassing the greedy mana-first assignment for those pips specifically — then
     * confirms the player can actually afford that much life. It does not solve for every partial
     * mix of mana/life per pip (that needs a general assignment search); the reported symptom —
     * K'rrik never offered below the full mana cost despite enough life for the {@code {B/P}} pips
     * — is exactly the all-mana-fails/all-life-for-Phyrexian-succeeds pair this covers.</p>
     */
    private static boolean canPayCostAllowingPhyrexianLife(SpellAbility ability, Player player) {
        if (ComputerUtilCost.canPayCost(ability, player, false)) {
            return true;
        }
        Cost cost = ability.getPayCosts();
        if (cost == null || !cost.hasManaCost() || cost.getTotalMana().getPhyrexianCount() == 0) {
            return false;
        }
        ManaCostBeingPaid remaining = ComputerUtilMana.calculateManaCost(cost, ability, player, true, 0, false);
        int phyrexianPipsPaidWithLife = 0;
        while (remaining.payPhyrexian()) {
            phyrexianPipsPaidWithLife++;
        }
        int lifeNeeded = phyrexianPipsPaidWithLife * 2;
        if (!player.canPayLife(lifeNeeded, false, ability)) {
            return false;
        }
        return ComputerUtilMana.canPayManaCost(remaining, ability, player, false);
    }

    static boolean requiresTargets(SpellAbility ability) {
        SpellAbility current = ability;
        while (current != null) {
            if (current.usesTargeting()) {
                return true;
            }
            current = current.getSubAbility();
        }
        return false;
    }

    private static String sourceZone(Zone zone) {
        if (zone == null) {
            return "other";
        }
        return switch (zone.getZoneType()) {
            case Hand -> "hand";
            case Battlefield -> "battlefield";
            case Command -> "command";
            case Graveyard -> "graveyard";
            case Exile -> "exile";
            case Library -> "library";
            default -> "other";
        };
    }

    private static String label(ActionType type, Card card) {
        return switch (type) {
            case PLAY_LAND -> "Play land — " + card.getName();
            case CAST_SPELL -> "Cast spell — " + card.getName();
            case ACTIVATE_ABILITY -> "Activate ability — " + card.getName();
        };
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

    private static String manaCost(SpellAbility ability) {
        if (ability.isLandAbility() || ability.getPayCosts() == null
                || !ability.getPayCosts().hasManaCost()) {
            return null;
        }
        return ability.getPayCosts().getTotalMana().toString();
    }

    enum ActionType {
        PLAY_LAND,
        CAST_SPELL,
        ACTIVATE_ABILITY;

        String wireName() {
            return name().toLowerCase(Locale.ROOT);
        }
    }

    record Candidate(
            ActionType type,
            SpellAbility ability,
            String cardRef,
            String cardName,
            String sourceZone,
            String label,
            String abilityText,
            String manaCost,
            boolean requiresTargets
    ) {
    }
}
