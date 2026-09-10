package com.asphodel.forgebridge;

import forge.ai.LobbyPlayerAi;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameEndReason;
import forge.game.player.Player;
import forge.game.zone.ZoneType;
import forge.util.MyRandom;
import org.junit.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.concurrent.atomic.AtomicReference;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;
import static org.junit.Assert.fail;

/**
 * Regression coverage for the real physical playtest crash report involving "From Under the
 * Floorboards" (no logs were retained for that specific incident -- the crashed session never
 * reached {@code writePlaytestReport}). The human said "the interaction felt abnormal before the
 * crash." Direct tracing of vendor Forge (see docs/physical-companion-v0.md and this change's own
 * investigation notes) confirmed two real, generic gaps that this class proves directly against a
 * real Forge game -- both fixed in {@link PhysicalIdentityCoordinator} and
 * {@link PlayerControllerAsphodel} respectively, never with any From-Under-the-Floorboards-specific
 * logic:
 *
 * <ol>
 * <li>Any token entering a physical seat's tracked zone (not just this card's Zombies) used to raise
 * a bogus {@code physical_identity_declare}, asking the human to "declare" a card that was never
 * physically hidden. Tokens are now excluded from {@link PhysicalIdentityCoordinator} tracking
 * entirely -- see {@code tokensFromANormalCastNeverRaiseABogusPhysicalDeclare}.
 * <li>A Madness cast (like every other "you may cast this card" effect Forge resolves via {@code
 * PlayerController.playSaFromPlayEffect} -- Cascade, Discover, impulse-draw, ...) never goes through
 * {@code chooseSpellAbilityToPlay}/{@code playChosenSpellAbility}, so its own X-announcement and
 * mana payment used to silently fall back to Forge's own AI logic instead of ever reaching the human
 * -- see {@code madnessCastRoutesXAndManaThroughTheHumanBridgeInsteadOfAiFallback}.
 * </ol>
 *
 * <p>Both tests pay every mana cost from REAL lands played one per turn (never a floated mana pool):
 * Forge empties mana pools at the end of every step/phase (rule 500.4), and a priority decision's
 * candidate list is a snapshot frozen at the moment Forge asked for it -- floating mana in reaction
 * to an already-pending decision can never retroactively add a cast candidate to it. Lands already
 * on the battlefield, by contrast, are read fresh on every single {@code chooseSpellAbilityToPlay}
 * call, so playing a land now genuinely makes a cast affordable on the very next decision.
 */
public class FromUnderTheFloorboardsPhysicalCompanionTest {

    private static Deck deckWithCommander(String commander, List<ForgeDeckFactory.CardSpec> mainboard) {
        List<ForgeDeckFactory.CardSpec> cards = new ArrayList<>();
        cards.add(new ForgeDeckFactory.CardSpec(commander, 1, "commander"));
        cards.addAll(mainboard);
        return new ForgeDeckFactory().build(new ForgeDeckFactory.DeckSpec(commander, cards));
    }

    private static List<String> declareGreedy(AsphodelDecisionBroker.PendingPhysicalIdentityDecision decision) {
        Map<String, Integer> remaining = new LinkedHashMap<>();
        for (AsphodelDecisionBroker.PhysicalCandidate candidate : decision.candidates()) {
            remaining.put(candidate.name(), candidate.remaining());
        }
        List<String> declared = new ArrayList<>();
        for (int i = 0; i < decision.count(); i++) {
            String pick = remaining.entrySet().stream()
                    .filter(e -> e.getValue() > 0)
                    .map(Map.Entry::getKey)
                    .findFirst()
                    .orElseThrow(() -> new AssertionError("No candidate left to declare: " + decision));
            declared.add(pick);
            remaining.merge(pick, -1, Integer::sum);
        }
        return declared;
    }

    private static Thread startExternalMatch(
            AsphodelDecisionBroker broker,
            Deck p1Deck,
            Deck p2Deck,
            long seed,
            AtomicReference<Game> gameRef
    ) {
        MyRandom.setRandom(new Random(seed));
        LobbyPlayerAsphodel seatOne = new LobbyPlayerAsphodel("External P1", broker);
        LobbyPlayerAi seatTwo = ForgeGameRunner.createAiLobbyPlayer("Forge AI P2");
        Thread worker = new Thread(() ->
                new ForgeGameRunner().runExternal("commander", seed, p1Deck, p2Deck, seatOne, seatTwo, gameRef::set),
                "floorboards-physical-test-worker");
        worker.setDaemon(true);
        worker.start();
        return worker;
    }

    private static AsphodelDecisionBroker.PendingAgentTurn awaitDecision(AsphodelDecisionBroker broker) throws InterruptedException {
        AsphodelDecisionBroker.PendingAgentTurn pending = null;
        for (int wait = 0; wait < 400 && pending == null; wait++) {
            pending = broker.pendingAgentTurn();
            if (pending == null) Thread.sleep(25);
        }
        if (pending == null) {
            fail("Forge match never reached a pending decision (game ended, hung, or crashed).");
        }
        return pending;
    }

    private static void endAndJoin(Game game, Thread worker) {
        game.setGameOver(GameEndReason.Draw);
        try {
            worker.join(5_000);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }

    /** Generic safety net: player-1 never has an attacker in either fixture, but Krenko (P2's
     *  commander) can attack unblocked after a few turns -- decline blocking rather than fail. */
    private static boolean handleCombatDecisionIfPresent(AsphodelDecisionBroker broker,
            AsphodelDecisionBroker.DecisionSnapshot snapshot) {
        if (!(snapshot instanceof AsphodelDecisionBroker.PendingCombatDecision combat)) {
            return false;
        }
        AsphodelDecisionBroker.CombatOption finish = combat.options().stream()
                .filter(o -> "finish".equals(o.operation()))
                .findFirst()
                .orElseThrow(() -> new AssertionError("No 'finish' combat option offered: " + combat));
        broker.submit(combat.decisionId(), finish.objectId(), AsphodelDecisionBroker.SubmissionKind.OBJECT);
        return true;
    }

    /**
     * Hypothesis #2 (confirmed): casts "From Under the Floorboards" for its Madness cost with a
     * discard forced by a real "draw two, discard a card" spell (Tormenting Voice), using 1 Mountain
     * + 3 Swamp played one per turn (real lands, never floated pool mana -- see class doc) so the
     * Madness cost's only affordable X is 0 (a plain, fully deterministic "B B" after Tormenting
     * Voice's {@code {1}{R}} is paid), and asserts the Madness spell's own X-announcement and mana
     * payment are requested through {@link AsphodelDecisionBroker} -- i.e. actually offered to the
     * human -- not silently resolved by {@code AuditedPlayerControllerAi}. Before the fix in
     * {@link PlayerControllerAsphodel#playSaFromPlayEffect}, no such decisions were ever raised at
     * all for the Madness spell (this test would instead exhaust its bounded pass loop and fail the
     * assertions below with "never requested").
     */
    @Test
    public void madnessCastRoutesXAndManaThroughTheHumanBridgeInsteadOfAiFallback() throws InterruptedException {
        long seed = 778899L;
        AsphodelDecisionBroker broker = new AsphodelDecisionBroker(waiting -> { });
        broker.physicalPlayerId = "player-1";
        AtomicReference<Game> gameRef = new AtomicReference<>();

        Deck p1Deck = deckWithCommander("Krenko, Tin Street Kingpin", List.of(
                new ForgeDeckFactory.CardSpec("From Under the Floorboards", 1, "mainboard"),
                new ForgeDeckFactory.CardSpec("Tormenting Voice", 1, "mainboard"),
                new ForgeDeckFactory.CardSpec("Mountain", 5, "mainboard"),
                new ForgeDeckFactory.CardSpec("Swamp", 35, "mainboard")
        ));
        Deck p2Deck = deckWithCommander("Krenko, Tin Street Kingpin", List.of(
                new ForgeDeckFactory.CardSpec("Mountain", 40, "mainboard")
        ));

        Thread worker = startExternalMatch(broker, p1Deck, p2Deck, seed, gameRef);

        // 1 Mountain + 3 Swamp: Tormenting Voice ({1}{R}) taps Mountain + 1 Swamp, leaving exactly 2
        // Swamp (both black) for the Madness cost's "B B" -- X's only affordable value is then 0.
        List<String> openingHand = List.of(
                "From Under the Floorboards", "Tormenting Voice",
                "Mountain", "Swamp", "Swamp", "Swamp", "Swamp"
        );

        boolean openingHandDeclared = false;
        boolean tormentingVoiceCast = false;
        boolean floorboardsDiscarded = false;
        boolean valueSeenAfterConfirm = false;
        int manaDecisionsAfterConfirm = 0;
        AsphodelDecisionBroker.Progress beforeMadnessCast = null;

        try {
            for (int i = 0; i < 250; i++) {
                AsphodelDecisionBroker.PendingAgentTurn pending = awaitDecision(broker);
                AsphodelDecisionBroker.DecisionSnapshot snapshot = pending.pendingDecision();
                if (handleCombatDecisionIfPresent(broker, snapshot)) continue;

                if (snapshot instanceof AsphodelDecisionBroker.PendingPhysicalIdentityDecision phys) {
                    List<String> declared = openingHandDeclared ? declareGreedy(phys) : openingHand;
                    openingHandDeclared = true;
                    broker.submitPhysicalIdentity(phys.decisionId(), declared);
                    continue;
                }

                if (snapshot instanceof AsphodelDecisionBroker.PendingCostObjectDecision costObj) {
                    // Tormenting Voice's discard is "As an additional cost to cast this spell,
                    // discard a card" -- a COST object choice (AsphodelCostDecision#visit(CostDiscard)
                    // -> PendingCostObjectDecision), not a resolution-time chooseCardsToDiscardFrom.
                    AsphodelDecisionBroker.ExternalCostObject target = costObj.options().stream()
                            .filter(o -> "From Under the Floorboards".equals(o.name()))
                            .findFirst()
                            .orElseThrow(() -> new AssertionError(
                                    "Floorboards was not offered as a discard candidate: " + costObj));
                    floorboardsDiscarded = true;
                    broker.submit(costObj.decisionId(), target.objectId(), AsphodelDecisionBroker.SubmissionKind.OBJECT);
                    continue;
                }

                if (snapshot instanceof AsphodelDecisionBroker.PendingSelectionDecision sel) {
                    if ("confirm_action".equals(sel.selectionKind())) {
                        AsphodelDecisionBroker.SelectionOption yes = sel.options().stream()
                                .filter(o -> "Yes".equals(o.label()))
                                .findFirst()
                                .orElseThrow(() -> new AssertionError("No 'Yes' option offered: " + sel));
                        // The Madness "do you want to cast this?" confirmation always precedes the
                        // spell's own X/mana decisions -- snapshot broker counters right here so the
                        // assertions below measure exactly this cast, nothing earlier (e.g. Tormenting
                        // Voice's own unrelated mana payment).
                        beforeMadnessCast = broker.progress();
                        broker.submit(sel.decisionId(), yes.objectId(), AsphodelDecisionBroker.SubmissionKind.OBJECT);
                        continue;
                    }
                    AsphodelDecisionBroker.SelectionOption first = sel.options().stream()
                            .filter(o -> !o.finish())
                            .findFirst()
                            .orElseGet(() -> sel.options().get(0));
                    broker.submit(sel.decisionId(), first.objectId(), AsphodelDecisionBroker.SubmissionKind.OBJECT);
                    continue;
                }

                if (snapshot instanceof AsphodelDecisionBroker.PendingValueDecision value) {
                    assertNotNull("The Madness spell's X announcement must not be requested before "
                            + "its own confirm_action.", beforeMadnessCast);
                    assertEquals("Only 2 untapped Swamp (both reserved for B B) must force X's only "
                            + "legal value to 0.", 0, value.minValue());
                    assertEquals(0, value.maxValue());
                    valueSeenAfterConfirm = true;
                    broker.submitValue(value.decisionId(), 0);
                    continue;
                }

                if (snapshot instanceof AsphodelDecisionBroker.PendingManaPaymentDecision mana) {
                    if (beforeMadnessCast != null) {
                        manaDecisionsAfterConfirm++;
                    }
                    AsphodelDecisionBroker.ExternalManaPaymentOption option = mana.options().stream()
                            .findFirst()
                            .orElseThrow(() -> new AssertionError("No mana option offered: " + mana));
                    broker.submit(mana.decisionId(), option.manaOptionId(), AsphodelDecisionBroker.SubmissionKind.MANA);
                    continue;
                }

                if (snapshot instanceof AsphodelDecisionBroker.PendingDecision priority) {
                    if (beforeMadnessCast != null && valueSeenAfterConfirm && manaDecisionsAfterConfirm > 0) {
                        // Back to an ordinary priority window: the whole Madness cast fully resolved.
                        break;
                    }
                    if (!tormentingVoiceCast) {
                        AsphodelDecisionBroker.ExternalAction cast = priority.actions().stream()
                                .filter(a -> "cast_spell".equals(a.type()) && "Tormenting Voice".equals(a.cardName()))
                                .findFirst()
                                .orElse(null);
                        if (cast != null) {
                            tormentingVoiceCast = true;
                            broker.submit(priority.decisionId(), cast.actionId(), AsphodelDecisionBroker.SubmissionKind.ACTION);
                            continue;
                        }
                        AsphodelDecisionBroker.ExternalAction land = priority.actions().stream()
                                .filter(a -> "play_land".equals(a.type()))
                                .findFirst()
                                .orElse(null);
                        if (land != null) {
                            broker.submit(priority.decisionId(), land.actionId(), AsphodelDecisionBroker.SubmissionKind.ACTION);
                            continue;
                        }
                    }
                    String passActionId = priority.actions().stream()
                            .filter(a -> a.type().equals("pass"))
                            .map(AsphodelDecisionBroker.ExternalAction::actionId)
                            .findFirst()
                            .orElseThrow(() -> new AssertionError("No pass action offered: " + priority.actions()));
                    broker.submit(priority.decisionId(), passActionId, AsphodelDecisionBroker.SubmissionKind.ACTION);
                    continue;
                }

                fail("Unexpected pending decision kind: " + snapshot);
            }

            assertTrue("Tormenting Voice must have been cast to force the discard.", tormentingVoiceCast);
            assertTrue("From Under the Floorboards must have actually been discarded.", floorboardsDiscarded);
            assertNotNull("The Madness confirm_action must have been reached.", beforeMadnessCast);
            assertTrue("The Madness spell's own X announcement must have reached the human bridge.",
                    valueSeenAfterConfirm);
            assertTrue("The Madness spell's own mana payment must have reached the human bridge.",
                    manaDecisionsAfterConfirm > 0);

            AsphodelDecisionBroker.Progress after = broker.progress();
            assertTrue("valueDecisionsRequested must have increased for the Madness cast's X.",
                    after.valueDecisionsRequested() > beforeMadnessCast.valueDecisionsRequested());
            assertTrue("manaPaymentDecisionsRequested must have increased for the Madness cast's mana.",
                    after.manaPaymentDecisionsRequested() > beforeMadnessCast.manaPaymentDecisionsRequested());
            assertEquals("No AI fallback should have been needed for the Madness spell's mana payment.",
                    beforeMadnessCast.manaPaymentsFallbackToAi(), after.manaPaymentsFallbackToAi());
        } finally {
            endAndJoin(gameRef.get(), worker);
        }
    }

    /**
     * Hypothesis #1 (confirmed, generic, not specific to this card): casts "From Under the
     * Floorboards" NORMALLY (full {@code 3 B B} cost, paid from 5 real Swamps played one per turn --
     * no Madness/discard involved at all) so it creates 3 tapped Zombie tokens and gains 3 life, and
     * asserts no bogus {@code physical_identity_declare} is ever raised for the resulting tokens
     * entering the physical seat's battlefield -- while confirming the tokens and life gain are real
     * (the fix must not silently drop the cast's own effect, only stop tracking tokens for physical
     * reconciliation).
     */
    @Test
    public void tokensFromANormalCastNeverRaiseABogusPhysicalDeclare() throws InterruptedException {
        long seed = 5566L;
        AsphodelDecisionBroker broker = new AsphodelDecisionBroker(waiting -> { });
        broker.physicalPlayerId = "player-1";
        AtomicReference<Game> gameRef = new AtomicReference<>();

        Deck p1Deck = deckWithCommander("Krenko, Tin Street Kingpin", List.of(
                new ForgeDeckFactory.CardSpec("From Under the Floorboards", 1, "mainboard"),
                new ForgeDeckFactory.CardSpec("Swamp", 40, "mainboard")
        ));
        Deck p2Deck = deckWithCommander("Krenko, Tin Street Kingpin", List.of(
                new ForgeDeckFactory.CardSpec("Mountain", 40, "mainboard")
        ));

        Thread worker = startExternalMatch(broker, p1Deck, p2Deck, seed, gameRef);

        List<String> openingHand = List.of(
                "From Under the Floorboards",
                "Swamp", "Swamp", "Swamp", "Swamp", "Swamp", "Swamp"
        );

        boolean openingHandDeclared = false;
        boolean floorboardsCast = false;
        boolean bogusTokenDeclareSeen = false;
        int passesSinceCast = 0;
        long lifeBeforeCast = -1;

        try {
            for (int i = 0; i < 300; i++) {
                AsphodelDecisionBroker.PendingAgentTurn pending = awaitDecision(broker);
                AsphodelDecisionBroker.DecisionSnapshot snapshot = pending.pendingDecision();
                if (handleCombatDecisionIfPresent(broker, snapshot)) continue;

                if (snapshot instanceof AsphodelDecisionBroker.PendingPhysicalIdentityDecision phys) {
                    if ("library_to_battlefield".equals(phys.eventKind())) {
                        bogusTokenDeclareSeen = true;
                    }
                    List<String> declared = openingHandDeclared ? declareGreedy(phys) : openingHand;
                    openingHandDeclared = true;
                    broker.submitPhysicalIdentity(phys.decisionId(), declared);
                    continue;
                }

                if (snapshot instanceof AsphodelDecisionBroker.PendingManaPaymentDecision mana) {
                    AsphodelDecisionBroker.ExternalManaPaymentOption option = mana.options().stream()
                            .findFirst()
                            .orElseThrow(() -> new AssertionError("No mana option offered: " + mana));
                    broker.submit(mana.decisionId(), option.manaOptionId(), AsphodelDecisionBroker.SubmissionKind.MANA);
                    continue;
                }

                if (snapshot instanceof AsphodelDecisionBroker.PendingSelectionDecision sel) {
                    AsphodelDecisionBroker.SelectionOption first = sel.options().stream()
                            .filter(o -> !o.finish())
                            .findFirst()
                            .orElseGet(() -> sel.options().get(0));
                    broker.submit(sel.decisionId(), first.objectId(), AsphodelDecisionBroker.SubmissionKind.OBJECT);
                    continue;
                }

                if (snapshot instanceof AsphodelDecisionBroker.PendingDecision priority) {
                    if (floorboardsCast) {
                        passesSinceCast++;
                        if (passesSinceCast > 6) {
                            // Several ordinary priority windows have passed since the cast resolved
                            // with no bogus declare surfacing: enough to be confident none is coming.
                            break;
                        }
                    }
                    if (!floorboardsCast) {
                        AsphodelDecisionBroker.ExternalAction cast = priority.actions().stream()
                                .filter(a -> "cast_spell".equals(a.type())
                                        && "From Under the Floorboards".equals(a.cardName()))
                                .findFirst()
                                .orElse(null);
                        if (cast != null) {
                            // Captured right here, not as a fixed constant: any incidental combat
                            // damage from P2's Krenko while we were still playing lands must not
                            // make the life-gain assertion below flaky -- only the delta this cast
                            // itself produces matters.
                            lifeBeforeCast = gameRef.get().getPlayers().get(0).getLife();
                            floorboardsCast = true;
                            broker.submit(priority.decisionId(), cast.actionId(), AsphodelDecisionBroker.SubmissionKind.ACTION);
                            continue;
                        }
                        AsphodelDecisionBroker.ExternalAction land = priority.actions().stream()
                                .filter(a -> "play_land".equals(a.type()))
                                .findFirst()
                                .orElse(null);
                        if (land != null) {
                            broker.submit(priority.decisionId(), land.actionId(), AsphodelDecisionBroker.SubmissionKind.ACTION);
                            continue;
                        }
                    }
                    String passActionId = priority.actions().stream()
                            .filter(a -> a.type().equals("pass"))
                            .map(AsphodelDecisionBroker.ExternalAction::actionId)
                            .findFirst()
                            .orElseThrow(() -> new AssertionError("No pass action offered: " + priority.actions()));
                    broker.submit(priority.decisionId(), passActionId, AsphodelDecisionBroker.SubmissionKind.ACTION);
                    continue;
                }

                fail("Unexpected pending decision kind: " + snapshot);
            }

            Player player1 = gameRef.get().getPlayers().get(0);
            assertTrue("From Under the Floorboards must have been cast normally.", floorboardsCast);
            assertFalse("Tokens must never raise a physical_identity_declare: they are never "
                    + "physically hidden information and have no library-composition counterpart.",
                    bogusTokenDeclareSeen);

            long zombieTokens = player1.getCardsIn(ZoneType.Battlefield).stream()
                    .filter(c -> "Zombie Token".equals(c.getName()) && c.isToken())
                    .count();
            assertEquals("A normal (non-Madness) cast creates exactly 3 Zombie tokens.", 3, zombieTokens);
            assertTrue("Life before the cast must have been captured.", lifeBeforeCast >= 0);
            assertEquals("A normal cast gains exactly 3 life.", lifeBeforeCast + 3, player1.getLife());
        } finally {
            endAndJoin(gameRef.get(), worker);
        }
    }
}
