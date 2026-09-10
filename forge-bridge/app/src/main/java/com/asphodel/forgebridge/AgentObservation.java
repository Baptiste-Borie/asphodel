package com.asphodel.forgebridge;

import java.util.List;
import java.util.Map;

record AgentObservation(
        String gameRef,
        GameContext game,
        String selfPlayerId,
        List<PlayerObservation> players,
        List<StackItem> stack
) {
    record GameContext(
            int turn,
            String phase,
            String activePlayerId,
            String priorityPlayerId
    ) {
    }

    sealed interface PlayerObservation permits SelfPlayer, OpponentPlayer {
    }

    record SelfPlayer(
            String role,
            String playerId,
            String name,
            int life,
            int startingLife,
            int handSize,
            int librarySize,
            int graveyardSize,
            int exileSize,
            int commandZoneSize,
            int battlefieldSize,
            boolean externalController,
            List<CardObservation> hand,
            List<CardObservation> battlefield,
            List<CardObservation> graveyard,
            List<CardObservation> exile,
            List<CardObservation> command,
            List<CommanderObservation> commanders
    ) implements PlayerObservation {
    }

    /** Deliberately has no hand field, so Gson cannot serialize hidden identities. */
    record OpponentPlayer(
            String role,
            String playerId,
            String name,
            int life,
            int startingLife,
            int handSize,
            int librarySize,
            int graveyardSize,
            int exileSize,
            int commandZoneSize,
            int battlefieldSize,
            boolean externalController,
            List<CardObservation> battlefield,
            List<CardObservation> graveyard,
            List<CardObservation> exile,
            List<CardObservation> command,
            List<CommanderObservation> commanders
    ) implements PlayerObservation {
    }

    record CardObservation(
            String cardRef,
            String name,
            String zone,
            String ownerId,
            String controllerId,
            boolean faceDown,
            boolean hidden,
            Boolean tapped,
            Boolean summoningSick,
            Map<String, Integer> counters,
            Integer power,
            Integer toughness,
            String typeLine,
            List<String> combatKeywords,
            List<String> selfAttackTriggers,
            boolean token,
            boolean ringBearer
    ) {
    }

    record CommanderObservation(
            String cardRef,
            String name,
            boolean inCommandZone,
            int castsFromCommand,
            /**
             * The generic-mana commander tax currently in effect for this commander (V2h,
             * "COMMANDER TAX VISIBILITY") — computed the exact same way Forge itself applies it when
             * building the real cast cost, see {@code forge.game.cost.CostAdjustment} ({@code n =
             * activator.getCommanderCast(host) * 2}). This is Forge's own rule constant, not a
             * frontend/backend guess: rule 903.8 always adds {2} generic per previous command-zone
             * cast. Zero when the commander has never been cast from the command zone.
             */
            int commanderTaxGeneric
    ) {
    }

    record StackItem(
            String stackRef,
            int position,
            String sourceCardRef,
            String sourceCardName,
            String controllerId,
            String description,
            boolean faceDown,
            boolean hidden
    ) {
    }
}
