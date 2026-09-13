package com.asphodel.forgebridge;

import forge.game.card.Card;
import org.junit.Test;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNull;

public class PrintedStatPresentationTest {
    @Test
    public void printedReferencesStayIndependentOfOpposingForgeBoosts() {
        Card card = new Card(1, null);
        card.setBasePower(3);
        card.setBaseToughness(3);
        card.addPTBoost(2, -1, 1L, 0L);
        assertEquals(5, card.getNetPower());
        assertEquals(2, card.getNetToughness());
        assertEquals(Integer.valueOf(3), AgentObservationBuilder.numericPrintedStat(card.getBasePowerString()));
        assertEquals(Integer.valueOf(3), AgentObservationBuilder.numericPrintedStat(card.getBaseToughnessString()));
    }

    @Test
    public void variableCharacteristicsDoNotInventANumericReference() {
        assertNull(AgentObservationBuilder.numericPrintedStat("*"));
        assertNull(AgentObservationBuilder.numericPrintedStat("1+*"));
        assertNull(AgentObservationBuilder.numericPrintedStat(null));
        assertEquals(Integer.valueOf(-1), AgentObservationBuilder.numericPrintedStat("-1"));
        assertEquals(Integer.valueOf(0), AgentObservationBuilder.numericPrintedStat("0"));
    }
}
