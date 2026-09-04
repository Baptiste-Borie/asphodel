package com.asphodel.forgebridge;

import forge.ai.ComputerUtilAbility;
import forge.ai.ComputerUtilCost;
import forge.game.Game;
import forge.game.card.Card;
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

    List<Candidate> enumerate(Game game, forge.game.player.Player player) {
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
    private static Set<Card> visibleCandidateCards(forge.game.player.Player player) {
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
            forge.game.player.Player player
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
            boolean payable = ComputerUtilCost.canPayCost(ability, player, false);
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
        if (!ComputerUtilCost.canPayCost(ability, player, false)) {
            return false;
        }
        return ComputerUtilAbility.isFullyTargetable(ability);
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
