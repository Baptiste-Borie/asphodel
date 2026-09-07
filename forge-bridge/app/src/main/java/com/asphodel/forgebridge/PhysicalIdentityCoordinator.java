package com.asphodel.forgebridge;

import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.zone.PlayerZone;
import forge.game.zone.Zone;
import forge.game.zone.ZoneType;

import java.util.ArrayList;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Reconciles Forge's internally-shuffled library identity against a physically-shuffled real deck
 * for exactly one player's seat (V2g Physical Companion). Forge remains the sole rules/state/count
 * authority at all times: this class only ever swaps WHICH already-real Card object Forge is
 * currently using for a given zone slot, by name, so a physically-declared identity ends up backed
 * by a real Forge object carrying the matching rules text (mana ability, keywords, P/T, ...). It
 * never invents a card, never changes any zone's size, and never calls GameAction.moveTo -- a
 * declaration is a relabeling of an already-legitimate Forge object, not a new game event, so it
 * must not re-fire a "enters this zone" trigger for a card that (from Forge's perspective) already
 * entered that zone once, silently, with the wrong identity.
 *
 * See docs/physical-companion-v0.md for the full synchronization model this implements.
 */
final class PhysicalIdentityCoordinator {
    private static final List<ZoneType> TRACKED_ZONES = List.of(
            ZoneType.Hand, ZoneType.Battlefield, ZoneType.Graveyard, ZoneType.Exile, ZoneType.Command
    );

    private final Player player;
    private Set<Card> trackedCards;

    PhysicalIdentityCoordinator(Player player) {
        this.player = player;
        this.trackedCards = new HashSet<>(visibleZoneCards());
    }

    Player player() {
        return player;
    }

    boolean isFor(Player candidate) {
        return player.equals(candidate);
    }

    /**
     * A real physical shuffle invalidates any assumption about the library's future order (spec
     * V2g §12). Cards already visibly placed in a tracked zone are unaffected; this re-baselines
     * against the zones exactly as they stand right now, synchronously on the same Forge game
     * thread that just performed the shuffle (see {@code cheatShuffle}), so anything that reappears
     * afterward (e.g. a London-mulligan redraw) is correctly treated as unreconciled again.
     */
    void recordShuffle() {
        trackedCards = new HashSet<>(visibleZoneCards());
    }

    private List<Card> visibleZoneCards() {
        List<Card> cards = new ArrayList<>();
        for (ZoneType zone : TRACKED_ZONES) {
            cards.addAll(player.getCardsIn(zone));
        }
        return cards;
    }

    /**
     * Cards that newly appeared in a tracked zone since the last checkpoint, grouped by the
     * physical event kind implied by which zone they appeared in. Iteration order is stable (Hand,
     * Battlefield, Graveyard, Exile, Command) so several simultaneous events resolve
     * deterministically, one physical declaration round at a time.
     */
    Map<String, List<Card>> unreconciledNewCardsByZone() {
        Map<String, List<Card>> result = new LinkedHashMap<>();
        for (ZoneType zone : TRACKED_ZONES) {
            List<Card> fresh = new ArrayList<>();
            for (Card c : player.getCardsIn(zone)) {
                if (!trackedCards.contains(c)) {
                    fresh.add(c);
                }
            }
            if (!fresh.isEmpty()) {
                result.put(eventKindFor(zone), fresh);
            }
        }
        return result;
    }

    private static String eventKindFor(ZoneType zone) {
        return switch (zone) {
            case Hand -> "draw";
            case Graveyard -> "mill";
            case Exile -> "exile_from_library";
            case Battlefield -> "library_to_battlefield";
            case Command -> "library_to_command";
            default -> "library_event";
        };
    }

    /**
     * The library's real current composition, grouped by name -- the sole authoritative candidate
     * pool for a physical declaration. This is Forge's own remaining Library contents at this exact
     * instant; nothing invented, nothing sourced from a Node-side ledger.
     */
    List<AsphodelDecisionBroker.PhysicalCandidate> libraryComposition() {
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (Card c : player.getCardsIn(ZoneType.Library)) {
            counts.merge(c.getName(), 1, Integer::sum);
        }
        List<AsphodelDecisionBroker.PhysicalCandidate> result = new ArrayList<>();
        for (Map.Entry<String, Integer> entry : counts.entrySet()) {
            result.add(new AsphodelDecisionBroker.PhysicalCandidate(entry.getKey(), entry.getValue()));
        }
        return result;
    }

    /**
     * Reconciles {@code wrongCards} (real objects Forge itself already placed) against
     * {@code declaredNames} (same size, positional): for each pair whose names differ, swaps the
     * wrong card back into the library for a same-named library card, so the exact same zone slot
     * ends up holding an object whose real name matches the physical declaration. Uses direct Zone
     * membership changes (not GameAction.moveTo), so library/zone sizes never change and no
     * zone-change trigger fires a second time for a card that is only being relabeled to its true
     * physical identity. Returns the reconciled objects in declaredNames order.
     *
     * <p>Known limitation: engine bookkeeping keyed off "entered this zone this turn" (e.g.
     * descend/landfall-style turn trackers) is updated by the underlying {@code Zone.add} call as
     * for any normal transfer, so it may double-count once across a reconciliation swap in rare
     * cases. This does not affect zone membership, card identity, or counts.
     */
    List<Card> reconcile(List<Card> wrongCards, List<String> declaredNames) {
        if (wrongCards.size() != declaredNames.size()) {
            throw new IllegalArgumentException(
                    "physical reconciliation size mismatch: " + wrongCards.size()
                            + " cards vs " + declaredNames.size() + " declared names");
        }
        List<Card> reconciled = new ArrayList<>(wrongCards.size());
        List<Card> claimedFromLibrary = new ArrayList<>();
        PlayerZone library = player.getZone(ZoneType.Library);
        for (int i = 0; i < wrongCards.size(); i++) {
            Card wrong = wrongCards.get(i);
            String declaredName = declaredNames.get(i);
            if (wrong.getName().equals(declaredName)) {
                reconciled.add(wrong);
                continue;
            }
            Card replacement = findInLibrary(declaredName, claimedFromLibrary);
            Zone wrongZone = wrong.getZone();
            if (replacement == null || wrongZone == null) {
                // Candidates always come from the real library composition, so this should not
                // happen; degrade to the Forge-chosen object rather than lose the card entirely.
                reconciled.add(wrong);
                continue;
            }
            wrongZone.remove(wrong);
            library.remove(replacement);
            wrongZone.add(replacement);
            library.add(wrong);
            claimedFromLibrary.add(replacement);
            reconciled.add(replacement);
        }
        return reconciled;
    }

    private Card findInLibrary(String name, List<Card> alreadyClaimed) {
        for (Card c : player.getCardsIn(ZoneType.Library)) {
            if (c.getName().equals(name) && !alreadyClaimed.contains(c)) {
                return c;
            }
        }
        return null;
    }

    /**
     * Marks the given (now-reconciled) cards as known/tracked, so the next checkpoint does not
     * treat them as a fresh, undeclared event.
     */
    void confirm(List<Card> cards) {
        trackedCards.addAll(cards);
    }
}
