package com.asphodel.forgebridge;

import forge.ai.LobbyPlayerAi;
import forge.card.MagicColor;
import forge.deck.Deck;
import forge.game.Game;
import forge.game.GameEndReason;
import forge.game.card.Card;
import forge.game.mana.Mana;
import forge.game.player.Player;
import forge.game.zone.ZoneType;
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
 *
 * <p><b>Real-decklist follow-up:</b> the actual reported deck (the one this investigation traces
 * back to) is a 100-card K'rrik list, not the minimal commander+40-basics fixture above. Building
 * it verbatim against the pinned Forge revision ({@code 6356c1ad565029c82513c96e42ad5492c1b09c4e})
 * originally threw {@link ForgeDeckFactory.CardsNotFoundException} for exactly one card:
 * <b>"Barad-dûr"</b> — every other of the 69 distinct named cards resolved. That was never a real
 * absence of Barad-dûr from Forge's card corpus ({@code cardsfolder/b/barad_dur.txt} exists, is
 * well-formed, and its {@code Name:} line is the correct "Barad-dûr"); it was a lookup-path bug:
 * {@code ForgeDataRepository} lazily resolves names via {@code
 * CardStorageReader.attemptToLoadCard}, which derives a filename via a generic transliteration
 * ({@code transformName}) that collapses any non a-z0-9 character — diacritics included — to a bare
 * underscore instead of folding it to its base letter. "Barad-dûr" transformed to {@code
 * barad_d_r}, matching no file, while the real vendor file is {@code barad_dur.txt}. Since {@code
 * ForgeDataRepository}/{@code ForgeDeckFactory} are the exact same singletons {@link BridgeMain}
 * uses for real matches, this was never merely a test artifact: any real Physical playtest deck
 * naming "Barad-dûr" (a real, legal, Scryfall-listed printing — LTR #253) would have failed to
 * build in production the same way.
 *
 * <p><b>Fixed</b> in {@code ForgeDataRepository.loadCardWithDiacriticFallback} — bridge code only,
 * no vendor Forge file touched and no Magic rule changed: when the normal lookup fails for a name
 * containing a non-ASCII character, it folds the diacritics itself, locates the matching
 * cardsfolder script directly, and parses it with vendor Forge's own {@code CardRules.Reader}. See
 * {@code ForgeDataRepositoryDiacriticFallbackTest} for a dedicated regression. The fixture below
 * therefore keeps the real, unmodified "Barad-dûr" line — no substitution needed anymore.</p>
 */
public class KrrikPhyrexianCastLegalityTest {

    private static Deck deck(String commander, String land) {
        ForgeDeckFactory.DeckSpec spec = new ForgeDeckFactory.DeckSpec(commander, List.of(
                new ForgeDeckFactory.CardSpec(commander, 1, "commander"),
                new ForgeDeckFactory.CardSpec(land, 40, "mainboard")
        ));
        return new ForgeDeckFactory().build(spec);
    }

    /**
     * The actual reported 100-card K'rrik deck, verbatim — including "Barad-dûr", now resolvable
     * via {@code ForgeDataRepository}'s diacritic fallback (see the class doc comment).
     */
    private static Deck realKrrikDeck() {
        List<ForgeDeckFactory.CardSpec> cards = new java.util.ArrayList<>();
        cards.add(new ForgeDeckFactory.CardSpec("K'rrik, Son of Yawgmoth", 1, "commander"));
        cards.add(new ForgeDeckFactory.CardSpec("Stir the Sands", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Blood Artist", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Mirkwood Bats", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Black Market Connections", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Blood Pact", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Dread Presence", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Harvester of Souls", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("High-Society Hunter", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Morbid Opportunist", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Phyrexian Arena", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Sign in Blood", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Teval's Judgment", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Vilis, Broker of Blood", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Yawgmoth, Thran Physician", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Exsanguinate", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Barad-dûr", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Barren Moor", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Bojuka Bog", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Command Tower", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Swamp", 31, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Alhammarret's Archive", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Cosmos Elixir", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Disciple of Bolas", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Kokusho, the Evening Star", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Agent of the Shadow Thieves", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Alesha's Legacy", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Gray Merchant of Asphodel", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Mithril Coat", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Swiftfoot Boots", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Arcane Signet", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Ashnod's Altar", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Cabal Ritual", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Charcoal Diamond", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Crowded Crypt", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Crypt Ghast", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Jet Medallion", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Mind Stone", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Pawn of Ulamog", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Phyrexian Altar", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Pitiless Plunderer", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Sol Ring", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Songs of the Damned", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Throne of Eldraine", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Endless Cockroaches", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Myojin of Grim Betrayal", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Nim Deathmantle", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Phyrexian Reclamation", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Reanimate", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Reassembling Skeleton", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Rise of the Dark Realms", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Tenacious Dead", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Thrilling Encore", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Tortured Existence", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Whip of Erebos", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Blasphemous Edict", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Drown in Ichor", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Eaten Alive", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Font of Agonies", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Murder", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("The Meathook Massacre", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Toxic Deluge", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Demon of Catastrophes", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Demon of Death's Gate", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Viscera Seer", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Desecrated Tomb", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("From Under the Floorboards", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Sengir Autocrat", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Grim Tutor", 1, "mainboard"));
        cards.add(new ForgeDeckFactory.CardSpec("Razaketh, the Foulblooded", 1, "mainboard"));
        ForgeDeckFactory.DeckSpec spec = new ForgeDeckFactory.DeckSpec("K'rrik Real Deck", cards);
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
                new ForgeGameRunner().runExternal("commander", seed, List.of(p1Deck, p2Deck), List.of(seatOne, seatTwo), gameRef::set),
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

    /**
     * Puts {@code count} real, untapped Swamps onto the battlefield straight from the library —
     * unlike {@link #floatMana}, this does NOT pre-fill the mana pool. The {@code N} untapped lands
     * are only mana SOURCES: {@link ForgeLegalActionEnumerator} must go through the same
     * {@code ComputerUtilMana} source-discovery/tap-simulation path a real match takes (a human never
     * has mana floating before they act), not the trivial floating-pool short-circuit the other tests
     * in this file exercise. This is the fixture the V2h/V2h.2 investigation notes
     * (`commander-cast-diagnostics.ts`) flagged as never having been isolated: "real-match state a
     * synthetic fixture doesn't represent".
     */
    private static void putUntappedSwampsInPlay(Game game, Player player, int count) {
        // Snapshot first: moveToPlay mutates the library zone in place, so iterating the live
        // CardCollectionView directly would throw ConcurrentModificationException.
        List<Card> library = new java.util.ArrayList<>(player.getCardsIn(ZoneType.Library));
        int moved = 0;
        for (Card card : library) {
            if (moved >= count) break;
            if (!"Swamp".equals(card.getName())) continue;
            Card inPlay = game.getAction().moveToPlay(card, player, null, null);
            inPlay.setTapped(false);
            moved++;
        }
        if (moved < count) {
            fail("Deck did not contain " + count + " Swamps to move to the battlefield (found " + moved + ").");
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

    /**
     * V2h/V2h.2 real-match threshold matrix, driven through REAL untapped Swamps (see
     * {@link #putUntappedSwampsInPlay}) instead of {@link #floatMana}'s floating-pool short-circuit.
     * {4}{B/P}{B/P}{B/P} with ample life must become legal at exactly 4 lands (the {4} generic paid
     * by tapping lands, the three Phyrexian symbols paid with 6 life) — not only once mana alone
     * covers the full {7}, which is the reported symptom ("K'rrik only appears around 7 mana").
     */
    private static void assertKrrikLegalityAtLandCount(int landCount, boolean expectedLegal, long seed) throws InterruptedException {
        assertKrrikLegalityAtLandCount(
                deck("K'rrik, Son of Yawgmoth", "Swamp"),
                deck("Krenko, Tin Street Kingpin", "Mountain"),
                landCount, expectedLegal, seed);
    }

    /** Same threshold check as above, but against a caller-supplied K'rrik deck (see {@link #realKrrikDeck()}). */
    private static void assertKrrikLegalityAtLandCount(Deck p1Deck, Deck p2Deck, int landCount, boolean expectedLegal, long seed) throws InterruptedException {
        PausedGame state = reachOwnMain1(p1Deck, p2Deck, seed);
        try {
            putUntappedSwampsInPlay(state.game(), state.actingPlayer(), landCount);
            assertEquals(40, state.actingPlayer().getLife());

            ForgeLegalActionEnumerator.Candidate krrik =
                    findCastCandidate(state.game(), state.actingPlayer(), "K'rrik, Son of Yawgmoth");

            if (expectedLegal) {
                assertNotNull("With " + landCount + " untapped Swamps (real mana sources, not floating "
                        + "pool) and 40 life, K'rrik must be offered: {4} taps 4 lands (or fewer once "
                        + landCount + " >= 4, with black covering Phyrexian symbols), remaining "
                        + "Phyrexian symbols paid with life.", krrik);
            } else {
                assertNull("With only " + landCount + " untapped Swamps, the {4} generic portion of "
                        + "{4}{B/P}{B/P}{B/P} cannot be paid: K'rrik must not be offered regardless of life.", krrik);
            }
        } finally {
            state.endAndJoin();
        }
    }

    @Test
    public void krrikIsNotOfferedWithThreeRealLands() throws InterruptedException {
        assertKrrikLegalityAtLandCount(3, false, 4300L);
    }

    @Test
    public void krrikIsOfferedWithFourRealLandsAndLifeForPhyrexian() throws InterruptedException {
        assertKrrikLegalityAtLandCount(4, true, 4301L);
    }

    @Test
    public void krrikIsOfferedWithFiveRealLandsAndLifeForPhyrexian() throws InterruptedException {
        assertKrrikLegalityAtLandCount(5, true, 4302L);
    }

    @Test
    public void krrikIsOfferedWithSixRealLandsAndLifeForPhyrexian() throws InterruptedException {
        assertKrrikLegalityAtLandCount(6, true, 4303L);
    }

    @Test
    public void krrikIsOfferedWithSevenRealLandsPayingFullManaCost() throws InterruptedException {
        assertKrrikLegalityAtLandCount(7, true, 4304L);
    }

    /**
     * The same 4/5/6/7-mana threshold matrix as above, but against the actual reported 100-card
     * K'rrik deck (see {@link #realKrrikDeck()}) instead of the minimal commander+40-basics fixture
     * — the "real-match state a synthetic fixture doesn't represent" gap the V2h/V2h.2 notes in
     * {@code commander-cast-diagnostics.ts} called out. The deck's other 66 nonland cards (rituals,
     * tutors, reanimation, etc.) sit untouched in the library throughout: nothing here is drawn,
     * played, or triggered before the acting player's own Main Phase 1 with an empty stack, so they
     * cannot influence whether "Cast K'rrik..." is offered — only the controlled Swamp count and life
     * total (both asserted below) can. Any legality mismatch against the synthetic-deck matrix above
     * would mean the bug is sensitive to real deck composition and not just to raw mana/life inputs.
     */
    private static void assertKrrikLegalityAtLandCountRealDeck(int landCount, boolean expectedLegal, long seed) throws InterruptedException {
        assertKrrikLegalityAtLandCount(
                realKrrikDeck(),
                deck("Krenko, Tin Street Kingpin", "Mountain"),
                landCount, expectedLegal, seed);
    }

    @Test
    public void krrikRealDeckIsNotOfferedWithThreeRealLands() throws InterruptedException {
        assertKrrikLegalityAtLandCountRealDeck(3, false, 4400L);
    }

    @Test
    public void krrikRealDeckIsOfferedWithFourRealLandsAndLifeForPhyrexian() throws InterruptedException {
        assertKrrikLegalityAtLandCountRealDeck(4, true, 4401L);
    }

    @Test
    public void krrikRealDeckIsOfferedWithFiveRealLandsAndLifeForPhyrexian() throws InterruptedException {
        assertKrrikLegalityAtLandCountRealDeck(5, true, 4402L);
    }

    @Test
    public void krrikRealDeckIsOfferedWithSixRealLandsAndLifeForPhyrexian() throws InterruptedException {
        assertKrrikLegalityAtLandCountRealDeck(6, true, 4403L);
    }

    @Test
    public void krrikRealDeckIsOfferedWithSevenRealLandsPayingFullManaCost() throws InterruptedException {
        assertKrrikLegalityAtLandCountRealDeck(7, true, 4404L);
    }
}
