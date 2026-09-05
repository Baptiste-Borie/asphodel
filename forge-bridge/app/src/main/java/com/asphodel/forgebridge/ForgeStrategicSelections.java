package com.asphodel.forgebridge;

import forge.game.GameEntity;
import forge.game.card.Card;
import forge.game.player.Player;
import forge.game.replacement.ReplacementEffect;
import forge.game.spellability.SpellAbility;

import java.util.ArrayList;
import java.util.List;

/** Transport for candidate sets already supplied by native Forge controller callers. */
final class ForgeStrategicSelections {
    <T> List<T> select(AsphodelDecisionBroker broker, AgentObservationBuilder observations,
            Player player, String type, String kind, String prompt, SpellAbility source,
            Iterable<T> candidates, int min, int max, boolean optional) {
        return selectVisible(broker, observations, player, type, kind, prompt, source,
                candidates, min, max, optional, false);
    }

    <T> List<T> selectVisible(AsphodelDecisionBroker broker, AgentObservationBuilder observations,
            Player player, String type, String kind, String prompt, SpellAbility source,
            Iterable<T> candidates, int min, int max, boolean optional, boolean revealed) {
        List<T> remaining = new ArrayList<>();
        candidates.forEach(remaining::add);
        List<T> result = new ArrayList<>();
        List<String> selected = new ArrayList<>();
        int required = Math.min(min, remaining.size());
        while (!remaining.isEmpty() && result.size() < max) {
            if (remaining.size() == 1 && !optional && result.size() < required) {
                result.add(remaining.remove(0));
                continue;
            }
            List<String> labels = remaining.stream().map(value -> label(value, player, revealed)).toList();
            List<String> refs = remaining.stream().map(ForgeStrategicSelections::ref).toList();
            boolean canFinish = result.size() >= required || (optional && result.isEmpty());
            int index = broker.requestSelection(player.getGame(), player, type, kind,
                    AgentObservationBuilder.shortText(prompt), source, remaining, labels, refs,
                    selected, required, max, canFinish, observations.build(player.getGame(), player));
            if (index < 0) break;
            T chosen = remaining.remove(index);
            result.add(chosen);
            selected.add(ref(chosen) == null ? label(chosen, player, revealed) : ref(chosen));
        }
        return result;
    }

    private static String ref(Object value) {
        if (value instanceof GameEntity entity) return ForgeCombatDecisions.ref(entity);
        if (value instanceof SpellAbility sa) return ForgeCombatDecisions.ref(sa.getHostCard());
        if (value instanceof ReplacementEffect re) return ForgeCombatDecisions.ref(re.getHostCard());
        return null;
    }

    private static String label(Object value, Player observer, boolean revealed) {
        if (value instanceof forge.game.card.CounterType counter) return counter.getName();
        if (value instanceof Boolean yes) return yes ? "Yes" : "No";
        Card card = value instanceof Card c ? c
                : value instanceof SpellAbility sa ? sa.getHostCard()
                : value instanceof ReplacementEffect re ? re.getHostCard() : null;
        if (card != null) {
            if (!(revealed && !card.isFaceDown()) && !AgentObservationBuilder.identityVisible(card, observer)) return "Hidden object " + ref(card);
            if (value instanceof SpellAbility sa) return AgentObservationBuilder.shortText(sa.getDescription());
            if (value instanceof ReplacementEffect re) return AgentObservationBuilder.shortText(re.toString());
            return card.getName();
        }
        if (value instanceof Player player) return player.getName();
        return "Object";
    }
}
