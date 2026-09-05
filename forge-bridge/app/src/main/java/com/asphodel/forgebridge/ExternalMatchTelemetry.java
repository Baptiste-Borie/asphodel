package com.asphodel.forgebridge;

import com.google.common.eventbus.Subscribe;
import forge.game.card.CardView;
import forge.game.event.*;
import forge.game.player.PlayerView;
import java.util.LinkedHashMap;
import java.util.Map;

/** Public game events only; counters never enter the agent's observation or decision. */
public final class ExternalMatchTelemetry {
    private final Map<String, Map<String, Integer>> players = new LinkedHashMap<>();

    private void add(PlayerView player, String metric, int amount) {
        if (player == null) return;
        players.computeIfAbsent("player-" + (player.getId() + 1), ignored -> new LinkedHashMap<>())
                .merge(metric, amount, Integer::sum);
    }

    @Subscribe public synchronized void attacked(GameEventAttackersDeclared event) {
        add(event.player(), "attacks", event.attackersMap().size());
    }
    @Subscribe public synchronized void blocked(GameEventBlockersDeclared event) {
        add(event.defendingPlayer(), "blocks", (int) event.blockers().values().stream().flatMap(m -> m.entries().stream())
                // Forge includes attacker -> itself as a sentinel for unblocked attackers.
                .filter(pair -> pair.getKey().getId() != pair.getValue().getId()).count());
    }
    @Subscribe public synchronized void playerDamaged(GameEventPlayerDamaged event) {
        if (event.source() != null) add(event.source().getController(), "damageToPlayers", event.amount());
    }
    @Subscribe public synchronized void cardDamaged(GameEventCardDamaged event) {
        if (event.source() != null) add(event.source().getController(), "damageToCards", event.amount());
    }
    @Subscribe public synchronized void cast(GameEventSpellAbilityCast event) {
        if (!event.sa().isSpell()) return;
        add(event.si().getActivatingPlayer(), "spellsCast", 1);
        CardView source = event.sa().getHostCard();
        if (source != null && source.isCommander()) add(event.si().getActivatingPlayer(), "commanderCasts", 1);
    }
    public synchronized Map<String, Map<String, Integer>> snapshot() {
        Map<String, Map<String, Integer>> result = new LinkedHashMap<>();
        players.forEach((id, counts) -> result.put(id, new LinkedHashMap<>(counts)));
        return result;
    }
}
