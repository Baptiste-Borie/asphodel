package com.asphodel.forgebridge;

import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameRules;
import forge.game.GameType;
import forge.game.Match;
import forge.game.card.Card;
import forge.game.card.CardCopyService;
import forge.game.player.Player;
import forge.game.player.RegisteredPlayer;
import forge.game.zone.ZoneType;
import org.junit.Before;
import org.junit.Test;
import java.util.List;
import static org.junit.Assert.*;

/** Real Forge zone transitions, not fake Card identity mocks. */
public class PhysicalIdentityCoordinatorTest {
    private Game game;
    private Player player;
    private PhysicalIdentityCoordinator identities;

    @Before public void setup() {
        ForgeDataRepository.instance();
        game = new Match(new GameRules(GameType.Constructed), List.of(
                new RegisteredPlayer(new Deck()).setPlayer(ForgeGameRunner.createAiLobbyPlayer("P1")),
                new RegisteredPlayer(new Deck()).setPlayer(ForgeGameRunner.createAiLobbyPlayer("P2"))), "identity regression").createGame();
        player = game.getPlayers().get(0);
        identities = new PhysicalIdentityCoordinator(player);
    }
    private Card card(String name, ZoneType zone, boolean known) {
        Card card = Card.fromPaperCard(ForgeDataRepository.instance().requireCard(name), player);
        (zone == ZoneType.Stack ? game.getStackZone() : player.getZone(zone)).add(card);
        if (known) identities.confirm(List.of(card));
        return card;
    }
    private Card move(Card card, ZoneType zone) {
        return game.getAction().moveTo(zone == ZoneType.Stack ? game.getStackZone() : player.getZone(zone), card, null);
    }
    private static void rejects(Runnable action) {
        try { action.run(); fail("Expected reconciliation rejection"); }
        catch (PhysicalIdentityCoordinator.PhysicalReconciliationException expected) { }
    }
    @Test public void knownDiscardKeepsStableIdentity() {
        Card original = card("Swamp", ZoneType.Hand, true);
        Card moved = move(original, ZoneType.Graveyard);
        assertEquals(original.getId(), moved.getId());
        assertTrue(identities.unreconciledNewCardsByZone().isEmpty());
    }
    @Test public void knownReanimationNeverDeclares() {
        move(card("Grizzly Bears", ZoneType.Graveyard, true), ZoneType.Battlefield);
        assertTrue(identities.unreconciledNewCardsByZone().isEmpty());
    }
    @Test public void sacrificeMovementDoesNotHideTheNewDraw() {
        Card stone = card("Mind Stone", ZoneType.Battlefield, true);
        Card draw = card("Swamp", ZoneType.Library, false);
        move(stone, ZoneType.Graveyard);
        Card drawn = move(draw, ZoneType.Hand);
        assertEquals(List.of(drawn), identities.unreconciledNewCardsByZone().get("draw"));
        assertEquals(1, identities.unreconciledNewCardsByZone().size());
        assertEquals(0, player.getCardsIn(ZoneType.Battlefield).size());
        assertEquals(stone.getId(), player.getCardsIn(ZoneType.Graveyard).get(0).getId());
    }
    @Test public void commanderThroughStackAndReturnIsAlwaysKnown() {
        Card commander = card("K'rrik, Son of Yawgmoth", ZoneType.Command, false);
        commander.setCommander(true);
        Card stack = move(commander, ZoneType.Stack);
        identities.recordShuffle();
        Card battlefield = move(stack, ZoneType.Battlefield);
        assertTrue(identities.unreconciledNewCardsByZone().isEmpty());
        Card returned = move(battlefield, ZoneType.Command);
        assertEquals(commander.getId(), returned.getId());
        assertTrue(identities.unreconciledNewCardsByZone().isEmpty());
    }
    @Test public void realLibraryDestinationsStillDeclare() {
        for (ZoneType zone : List.of(ZoneType.Graveyard, ZoneType.Battlefield, ZoneType.Exile)) {
            Card moved = move(card("Grizzly Bears", ZoneType.Library, false), zone);
            assertTrue(identities.unreconciledNewCardsByZone().values().stream().anyMatch(cards -> cards.contains(moved)));
            identities.confirm(List.of(moved));
        }
    }
    @Test public void shuffleDoesNotForgetKnownStackOrConfirmFreshDraw() {
        Card spell = card("Grizzly Bears", ZoneType.Stack, true);
        Card fresh = card("Swamp", ZoneType.Hand, false);
        identities.recordShuffle();
        move(spell, ZoneType.Battlefield);
        assertEquals(List.of(fresh), identities.unreconciledNewCardsByZone().get("draw"));
        assertEquals(1, identities.unreconciledNewCardsByZone().size());
    }
    @Test public void knownCardCannotBeSilentlySwapped() {
        Card known = card("Mind Stone", ZoneType.Graveyard, true);
        Card replacement = card("Swamp", ZoneType.Library, false);
        rejects(() -> identities.reconcile(List.of(new CardCopyService(known).copyCard(false)), List.of("Swamp")));
        assertTrue(player.getCardsIn(ZoneType.Graveyard).contains(known));
        assertTrue(player.getCardsIn(ZoneType.Library).contains(replacement));
    }
    @Test public void failedBatchDoesNotPartiallySwapZones() {
        Card a = card("Swamp", ZoneType.Hand, false);
        Card b = card("Swamp", ZoneType.Hand, false);
        Card replacement = card("Forest", ZoneType.Library, false);
        rejects(() -> identities.reconcile(List.of(a, b), List.of("Forest", "Missing card")));
        assertEquals(List.of(a, b), List.copyOf(player.getCardsIn(ZoneType.Hand)));
        assertTrue(player.getCardsIn(ZoneType.Library).contains(replacement));
    }
}
