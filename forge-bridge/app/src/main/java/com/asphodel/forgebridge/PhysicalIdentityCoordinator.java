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
     *
     * <p>Each round's declaration and reconciliation is scoped to ONLY that round's own zone (see
     * {@link #candidates} / {@link #reconcile}) -- a genuinely rare case where the same identity is
     * needed by two simultaneous events in different zones within one checkpoint is a documented V0
     * limitation (docs/physical-companion-v0.md §7), not silently guessed at: {@link #reconcile}
     * throws {@link PhysicalReconciliationException} rather than attempting an unsafe cross-zone
     * swap (which could relocate a genuinely-milled/drawn card into the wrong real zone).
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
     * The authoritative candidate pool for one physical declaration round: Forge's real current
     * Library composition, PLUS {@code extra} -- the very cards this round is about to reconcile.
     *
     * <p>{@code extra} matters for correctness, not just convenience: a card already silently
     * placed by Forge (e.g. a fresh draw) is no longer physically IN the library, but its true
     * identity is exactly as undeclared as anything still there -- and in a singleton (or
     * near-singleton) deck, the ONLY remaining copy of a name can easily be the very card Forge
     * already (arbitrarily) dealt. Omitting it would make that name silently un-offerable even
     * though declaring it is completely legitimate (the physical human really did draw their only
     * copy). Callers pass {@code List.of()} when the cards in question are still genuinely IN the
     * library at candidate-computation time (the scry/surveil peek, {@link
     * AsphodelDecisionBroker#reconcilePhysicalLibraryPeek}) -- adding them there would double-count.
     */
    List<AsphodelDecisionBroker.PhysicalCandidate> candidates(List<Card> extra) {
        Map<String, Integer> counts = new LinkedHashMap<>();
        for (Card c : player.getCardsIn(ZoneType.Library)) {
            counts.merge(c.getName(), 1, Integer::sum);
        }
        for (Card c : extra) {
            counts.merge(c.getName(), 1, Integer::sum);
        }
        List<AsphodelDecisionBroker.PhysicalCandidate> result = new ArrayList<>();
        for (Map.Entry<String, Integer> entry : counts.entrySet()) {
            result.add(new AsphodelDecisionBroker.PhysicalCandidate(entry.getKey(), entry.getValue()));
        }
        return result;
    }

    /**
     * Reconciles {@code wrongCards} (real objects Forge itself already placed in one zone) against
     * {@code declaredNames} (same size) so that zone ends up holding exactly the declared name
     * multiset -- backed by real Forge objects with matching rules text. Two passes:
     *
     * <ol>
     * <li><b>Keep by name, not by position.</b> Hand/Graveyard/etc. are unordered zones -- there is
     * no real positional correspondence between "the i-th Forge-arbitrary card" and "the i-th
     * declared name" to begin with. Any wrong card whose name is still needed by the declaration
     * multiset is left completely untouched, regardless of which position declared that name. This
     * also means a card Forge already happens to have gotten right needs no swap at all, and a
     * batch whose multiset already matches the declaration (just reordered) does zero card churn.
     * <li><b>Swap the rest from the library.</b> Whatever is left over (wrong cards whose name is
     * not needed, and declared names not yet satisfied) is resolved by pulling a same-named real
     * object from the library and ejecting the surplus wrong card there in its place -- direct Zone
     * membership changes only, per the class doc.
     * </ol>
     *
     * <p>If a still-needed declared name cannot be found anywhere in the library, this throws
     * {@link PhysicalReconciliationException} rather than silently keeping the wrong card or
     * guessing a substitute -- candidates are always drawn from {@link #candidates}, so this should
     * never happen for a legally-submitted declaration UNLESS the same identity was simultaneously
     * needed by a different zone's round within the same checkpoint (see {@link
     * #unreconciledNewCardsByZone}'s doc) -- a rare, explicitly documented V0 limitation.
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
        List<String> stillNeeded = new ArrayList<>(declaredNames);
        List<Card> kept = new ArrayList<>();
        List<Card> toEject = new ArrayList<>();
        for (Card wrong : wrongCards) {
            int index = stillNeeded.indexOf(wrong.getName());
            if (index >= 0) {
                stillNeeded.remove(index);
                kept.add(wrong);
            } else {
                toEject.add(wrong);
            }
        }
        // Invariant (guaranteed by construction, not runtime-checked): stillNeeded.size() ==
        // toEject.size() == wrongCards.size() - kept.size(), since wrongCards.size() ==
        // declaredNames.size() was already checked above.
        List<Card> reconciled = new ArrayList<>(kept);
        List<Card> claimedFromLibrary = new ArrayList<>();
        PlayerZone library = player.getZone(ZoneType.Library);
        for (int i = 0; i < stillNeeded.size(); i++) {
            String name = stillNeeded.get(i);
            Card eject = toEject.get(i);
            Zone ejectZone = eject.getZone();
            if (ejectZone == null) {
                throw new PhysicalReconciliationException(
                        "Card \"" + eject.getName() + "\" has no current zone; cannot reconcile it.");
            }
            Card replacement = findInLibrary(name, claimedFromLibrary);
            if (replacement == null) {
                throw new PhysicalReconciliationException(
                        "No remaining real card named \"" + name + "\" could be found in the library to "
                                + "reconcile the slot currently holding \"" + eject.getName() + "\". This is "
                                + "never silently guessed or substituted -- it can happen when the SAME "
                                + "identity is needed by two simultaneous hidden-zone events in different "
                                + "zones within one checkpoint, a rare, documented V0 limitation (see "
                                + "docs/physical-companion-v0.md).");
            }
            ejectZone.remove(eject);
            library.remove(replacement);
            ejectZone.add(replacement);
            library.add(eject);
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

    /**
     * Thrown instead of ever silently keeping a wrong identity or guessing a substitute -- see
     * {@link #reconcile}. Surfaces to Node as a generic {@code EXTERNAL_MATCH_FAILED} (the bridge's
     * existing catch-all for an unexpected {@code RuntimeException} on the game thread), with this
     * message logged server-side; V0 does not add a dedicated wire error code for it.
     */
    static final class PhysicalReconciliationException extends RuntimeException {
        PhysicalReconciliationException(String message) {
            super(message);
        }
    }
}
