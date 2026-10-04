package com.asphodel.forgebridge;

import forge.item.PaperCard;
import org.junit.Test;
import static org.junit.Assert.*;

public class ForgeDataRepositoryDesktopNamesTest {
    @Test
    public void joinedScryfallNamesResolveToTheirRealForgeFrontFace() {
        ForgeDataRepository repository = ForgeDataRepository.instance();
        PaperCard aang = repository.findCard("Avatar Aang // Aang, Master of Elements");
        assertNotNull(aang);
        assertEquals("Avatar Aang", aang.getName());
        assertEquals("Aang, Master of Elements", aang.getRules().getOtherPart().getName());
        assertNotNull(repository.findCard("Sea Gate Restoration // Sea Gate, Reborn"));
        assertNotNull(repository.findCard("The Legend of Kyoshi // Avatar Kyoshi"));
    }

    @Test
    public void punctuationFilenameFallbackUsesTheExactScriptHeader() {
        PaperCard vats = ForgeDataRepository.instance().findCard("V.A.T.S.");
        assertNotNull(vats);
        assertEquals("V.A.T.S.", vats.getName());
    }

    @Test
    public void inventedBackFacesAreNeverAccepted() {
        assertNull(ForgeDataRepository.instance().findCard("Sol Ring // Imaginary Back"));
        assertNull(ForgeDataRepository.instance().findCard("Avatar Aang // Wrong Avatar"));
    }
}
