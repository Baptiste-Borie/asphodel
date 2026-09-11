package com.asphodel.forgebridge;

import forge.item.PaperCard;
import org.junit.Test;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;

/**
 * Regression coverage for {@code ForgeDataRepository}'s diacritic-fallback card lookup.
 *
 * <p>Discovered via the K'rrik real-decklist investigation ({@code
 * KrrikPhyrexianCastLegalityTest}): building the reported deck verbatim against the pinned Forge
 * revision ({@code 6356c1ad565029c82513c96e42ad5492c1b09c4e}, never modified here) threw {@code
 * ForgeDeckFactory.CardsNotFoundException} for "Barad-dûr" — a real, legal, Scryfall-listed card
 * (LTR #253) whose script ({@code cardsfolder/b/barad_dur.txt}) is present and correct in the
 * pinned card database. The failure was in {@code ForgeDataRepository}'s own name-to-file
 * resolution, not in Forge's data: vendor {@code CardStorageReader.transformName} collapses any
 * non a-z0-9 character — including a diacritic like "û" — to a bare underscore rather than folding
 * it to its base letter, so "Barad-dûr" transformed to {@code barad_d_r} instead of matching the
 * real {@code barad_dur.txt}. Left unfixed, this would ALSO break a real Physical playtest deck
 * naming this exact card in production, since {@code ForgeDataRepository} is the same singleton
 * {@link BridgeMain} uses for real matches — not merely a test-fixture inconvenience.
 *
 * <p>{@code ForgeDataRepository.loadCardWithDiacriticFallback} fixes this in bridge code only — no
 * vendor Forge file is modified, no Magic rule changes, and the pinned revision is untouched.</p>
 */
public class ForgeDataRepositoryDiacriticFallbackTest {

    @Test
    public void baradDurResolvesDespiteDiacriticInName() {
        PaperCard card = ForgeDataRepository.instance().findCard("Barad-dûr");

        assertNotNull("\"Barad-dûr\" must resolve: the card script exists in the pinned Forge "
                + "database (cardsfolder/b/barad_dur.txt) — only vendor Forge's own filename "
                + "transliteration mishandles the \"û\", which ForgeDataRepository's diacritic "
                + "fallback must work around.", card);
        assertEquals("Barad-dûr", card.getName());
    }

    @Test
    public void baradDurDeckBuildsSuccessfully() {
        // End-to-end: the same ForgeDeckFactory.build path production uses to resolve a real
        // decklist must no longer throw CardsNotFoundException for this card.
        ForgeDeckFactory.DeckSpec spec = new ForgeDeckFactory.DeckSpec("Barad-dûr smoke test", java.util.List.of(
                new ForgeDeckFactory.CardSpec("K'rrik, Son of Yawgmoth", 1, "commander"),
                new ForgeDeckFactory.CardSpec("Barad-dûr", 1, "mainboard"),
                new ForgeDeckFactory.CardSpec("Swamp", 39, "mainboard")
        ));

        forge.deck.Deck deck = new ForgeDeckFactory().build(spec);

        assertEquals(40, deck.getMain().countAll());
    }

    @Test
    public void unrelatedMissingCardStillReportsMissing() {
        // The fallback must not paper over genuinely nonexistent/misspelled names: it only
        // resolves names whose script actually exists in the pinned database under a differently
        // transliterated filename.
        PaperCard card = ForgeDataRepository.instance().findCard("Not A Real Card Æøå");

        assertEquals(null, card);
    }
}
