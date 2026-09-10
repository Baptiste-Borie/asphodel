package com.asphodel.forgebridge;

import forge.ai.LobbyPlayerAi;
import forge.card.MagicColor;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameEndReason;
import forge.game.card.Card;
import forge.game.mana.Mana;
import forge.game.player.Player;
import forge.util.MyRandom;
import org.junit.Test;

import java.util.List;
import java.util.Random;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.fail;

/**
 * Regression coverage for K'rrik, Son of Yawgmoth ({4}{B/P}{B/P}{B/P}): a bug report claimed the
 * Physical Companion action dock never offered "Cast K'rrik..." even though the player had 4 mana
 * available and enough life to pay the three Phyrexian black symbols with 6 life.
 *
 * <p>This drives a real Forge game through the exact production path used in play —
 * {@link LobbyPlayerAsphodel} / {@link PlayerControllerAsphodel} / {@link AsphodelDecisionBroker} —
 * up to the acting player's own Main Phase 1 with priority and an empty stack (the same window
 * {@code PlayerControllerAsphodel.chooseSpellAbilityToPlay()} enumerates in), then calls the exact
 * same {@link ForgeLegalActionEnumerator} the broker uses. No Magic payment rule is reimplemented
 * here or anywhere in the bridge: every assertion below is a direct consequence of real Forge
 * {@code Card}/{@code SpellAbility}/{@code ComputerUtilCost} behavior.</p>
 */
public class KrrikPhyrexianCastLegalityTest {

    private static Deck deck(String commander, String land) {
        ForgeDeckFactory.DeckSpec spec = new ForgeDeckFactory.DeckSpec(commander, List.of(
                new ForgeDeckFactory.CardSpec(commander, 1, "commander"),
                new ForgeDeckFactory.CardSpec(land, 40, "mainboard")
        ));
        return new ForgeDeckFactory().build(spec);
    }

    /** One real, running Forge game paused at the acting player's own Main Phase 1, empty stack. */
    private record PausedGame(Game game, Player actingPlayer, Card commander, Thread worker) {
        void endAndJoin() {
            game.setGameOver(GameEndReason.Draw);
            try {
                worker.join(5_000);
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
            }
        }
    }

    /**
     * Starts a real external match (player 1 externally controlled via the production broker,
     * player 2 a normal Forge AI) and drives PASS through every priority window until player 1's
     * own Main Phase 1 with an empty stack — the first point in a real game where a sorcery-speed
     * commander cast is legally timed. Returns the live, paused {@code Game}/{@code Player}/
     * commander {@code Card}, ready for direct state inspection or mutation.
     */
    private static PausedGame reachOwnMain1(Deck p1Deck, Deck p2Deck, long seed) throws InterruptedException {
        MyRandom.setRandom(new Random(seed));
        AsphodelDecisionBroker broker = new AsphodelDecisionBroker(waiting -> { });
        LobbyPlayerAsphodel seatOne = new LobbyPlayerAsphodel("External P1", broker);
        LobbyPlayerAi seatTwo = ForgeGameRunner.createAiLobbyPlayer("Forge AI P2");
        AtomicReference<Game> gameRef = new AtomicReference<>();

        Thread worker = new Thread(() ->
                new ForgeGameRunner().runExternal("commander", seed, p1Deck, p2Deck, seatOne, seatTwo, gameRef::set),
                "krrik-test-worker");
        worker.setDaemon(true);
        worker.start();

        for (int i = 0; i < 200; i++) {
            AsphodelDecisionBroker.PendingAgentTurn pending = null;
            for (int wait = 0; wait < 400 && pending == null; wait++) {
                pending = broker.pendingAgentTurn();
                if (pending == null) Thread.sleep(25);
            }
            if (pending == null) {
                fail("Forge match never reached a pending decision (game ended or hung).");
            }
            if (!(pending.pendingDecision() instanceof AsphodelDecisionBroker.PendingDecision pd)) {
                fail("Unexpected non-priority pending decision: " + pending.pendingDecision());
            }
            AsphodelDecisionBroker.PendingDecision decision = (AsphodelDecisionBroker.PendingDecision) pending.pendingDecision();
            boolean isTarget = decision.playerId().equals("player-1")
                    && decision.context().activePlayerId().equals("player-1")
                    && decision.context().phase().equals("main1")
                    && decision.context().stackSize() == 0;
            Game game = gameRef.get();
            Player player1 = game.getPlayers().get(0);
            if (isTarget) {
                return new PausedGame(game, player1, player1.getCommanders().get(0), worker);
            }
            String passActionId = decision.actions().stream()
                    .filter(a -> a.type().equals("pass"))
                    .map(AsphodelDecisionBroker.ExternalAction::actionId)
                    .findFirst()
                    .orElseThrow(() -> new AssertionError("No pass action offered: " + decision.actions()));
            broker.submit(decision.decisionId(), passActionId, AsphodelDecisionBroker.SubmissionKind.ACTION);
        }
        throw new AssertionError("Never reached player-1's own Main Phase 1 within 200 priority windows.");
    }

    private static void floatMana(Player player, Card source, byte color, int count) {
        player.getManaPool().clearPool(false);
        for (int i = 0; i < count; i++) {
            player.getManaPool().addManaNoEvent(new Mana(color, source, null, player));
        }
    }

    private static ForgeLegalActionEnumerator.Candidate findCastCandidate(Game game, Player player, String cardName) {
        for (ForgeLegalActionEnumerator.Candidate candidate : new ForgeLegalActionEnumerator().enumerate(game, player)) {
            if (candidate.type() == ForgeLegalActionEnumerator.ActionType.CAST_SPELL
                    && cardName.equals(candidate.cardName())) {
                return candidate;
            }
        }
        return null;
    }

    /**
     * The reported scenario: 4 generic floating mana (deliberately non-black, so only the {4} can
     * be paid with it) plus ample life. Real Forge {@code Card.getAllPossibleAbilities} plus
     * {@code ComputerUtilCost.canPayCost} must expose the commander cast, paying the three
     * Phyrexian black symbols with 6 life -- exactly as MTG rule 118.4a/601.2 allows.
     */
    @Test
    public void krrikIsOfferedWithFourGenericManaAndLifeForPhyrexian() throws InterruptedException {
        PausedGame state = reachOwnMain1(
                deck("K'rrik, Son of Yawgmoth", "Swamp"),
                deck("Krenko, Tin Street Kingpin", "Mountain"),
                4242L);
        try {
            floatMana(state.actingPlayer(), state.commander(), MagicColor.GREEN, 4);
            assertEquals(40, state.actingPlayer().getLife());

            ForgeLegalActionEnumerator.Candidate krrik =
                    findCastCandidate(state.game(), state.actingPlayer(), "K'rrik, Son of Yawgmoth");

            assertNotNull("K'rrik must be offered as a legal cast_spell action: 4 generic mana pays "
                    + "{4}, and 40 life is enough to pay {B/P}{B/P}{B/P} with 6 life.", krrik);
            assertEquals("command", krrik.sourceZone());
            assertEquals("{4}{B/P}{B/P}{B/P}", krrik.manaCost());
        } finally {
            state.endAndJoin();
        }
    }

    /** Same mana, but too little life to survive paying 6 life for the Phyrexian symbols: illegal. */
    @Test
    public void krrikIsNotOfferedWhenLifeIsInsufficient() throws InterruptedException {
        PausedGame state = reachOwnMain1(
                deck("K'rrik, Son of Yawgmoth", "Swamp"),
                deck("Krenko, Tin Street Kingpin", "Mountain"),
                4243L);
        try {
            floatMana(state.actingPlayer(), state.commander(), MagicColor.GREEN, 4);
            state.actingPlayer().setLife(2, null);

            ForgeLegalActionEnumerator.Candidate krrik =
                    findCastCandidate(state.game(), state.actingPlayer(), "K'rrik, Son of Yawgmoth");

            assertNull("At 2 life, paying 6 life for the Phyrexian symbols must not become legal.", krrik);
        } finally {
            state.endAndJoin();
        }
    }

    /** Enough real black mana to pay every Phyrexian symbol without touching life: ordinary payment stays legal. */
    @Test
    public void krrikIsOfferedWithSufficientBlackManaInsteadOfLife() throws InterruptedException {
        PausedGame state = reachOwnMain1(
                deck("K'rrik, Son of Yawgmoth", "Swamp"),
                deck("Krenko, Tin Street Kingpin", "Mountain"),
                4244L);
        try {
            Player player = state.actingPlayer();
            player.getManaPool().clearPool(false);
            for (int i = 0; i < 4; i++) {
                player.getManaPool().addManaNoEvent(new Mana(MagicColor.GREEN, state.commander(), null, player));
            }
            for (int i = 0; i < 3; i++) {
                player.getManaPool().addManaNoEvent(new Mana(MagicColor.BLACK, state.commander(), null, player));
            }
            player.setLife(1, null); // life is irrelevant here: mana alone must cover the whole cost.

            ForgeLegalActionEnumerator.Candidate krrik =
                    findCastCandidate(state.game(), state.actingPlayer(), "K'rrik, Son of Yawgmoth");

            assertNotNull("With 4 generic + 3 real black mana floating, K'rrik must be payable by mana "
                    + "alone, independent of the (here, deliberately insufficient) life total.", krrik);
        } finally {
            state.endAndJoin();
        }
    }

    /** A previous command-zone cast raises the generic cost by {2} (commander tax); with only 4 mana this is unaffordable. */
    @Test
    public void krrikRespectsCommanderTaxWhenUnaffordable() throws InterruptedException {
        PausedGame state = reachOwnMain1(
                deck("K'rrik, Son of Yawgmoth", "Swamp"),
                deck("Krenko, Tin Street Kingpin", "Mountain"),
                4245L);
        try {
            state.actingPlayer().incCommanderCast(state.commander());
            assertEquals(1, state.actingPlayer().getCommanderCast(state.commander()));
            floatMana(state.actingPlayer(), state.commander(), MagicColor.GREEN, 4);
            assertEquals(40, state.actingPlayer().getLife());

            ForgeLegalActionEnumerator.Candidate krrik =
                    findCastCandidate(state.game(), state.actingPlayer(), "K'rrik, Son of Yawgmoth");

            assertNull("A second command-zone cast costs {6}{B/P}{B/P}{B/P} (commander tax); "
                    + "4 mana no longer covers the generic portion and must not be offered.", krrik);
        } finally {
            state.endAndJoin();
        }
    }
}
