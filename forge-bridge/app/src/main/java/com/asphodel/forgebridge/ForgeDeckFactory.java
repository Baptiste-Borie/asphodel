package com.asphodel.forgebridge;

import forge.deck.CardPool;
import forge.deck.Deck;
import forge.deck.DeckSection;
import forge.item.PaperCard;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

final class ForgeDeckFactory {
    private final ForgeDataRepository repository;

    ForgeDeckFactory() {
        this(ForgeDataRepository.instance());
    }

    ForgeDeckFactory(ForgeDataRepository repository) {
        this.repository = repository;
    }

    Deck build(DeckSpec spec) {
        return build(spec, true);
    }

    /**
     * @param requireCommanders false only for the legacy non-Commander engine-test fixture (see
     *                          {@code BridgeMain.handleRunTestGame}), which legitimately has ZERO
     *                          commander cards. Every real Commander-format deck always passes
     *                          {@code true}, and always ends up with exactly one or two commanders
     *                          — never zero, never three or more (V2f §"DUAL COMMANDERS").
     */
    Deck build(DeckSpec spec, boolean requireCommanders) {
        List<String> commanderNames = validate(spec, requireCommanders);

        Map<String, PaperCard> resolved = new LinkedHashMap<>();
        Set<String> missing = new LinkedHashSet<>();
        for (CardSpec cardSpec : spec.cards()) {
            if (resolved.containsKey(cardSpec.name()) || missing.contains(cardSpec.name())) {
                continue;
            }
            PaperCard paperCard = repository.findCard(cardSpec.name());
            if (paperCard == null) {
                missing.add(cardSpec.name());
            } else {
                resolved.put(cardSpec.name(), paperCard);
            }
        }

        if (!missing.isEmpty()) {
            throw new CardsNotFoundException(new ArrayList<>(missing));
        }

        // Legality of a SPECIFIC two-commander pair (Partner / Partner with / Friends forever /
        // Choose a Background / Doctor's companion) is Forge's own call, never Node's or ours to
        // invent: `CardRules.canBePartnerCommanders` is vendor Forge's own real rules-data method
        // (forge-core), reading each card's own printed keywords — not a reimplementation.
        if (commanderNames.size() == 2) {
            PaperCard first = resolved.get(commanderNames.get(0));
            PaperCard second = resolved.get(commanderNames.get(1));
            if (!first.getRules().canBePartnerCommanders(second.getRules())) {
                throw new IllegalCommanderPairException(first.getName(), second.getName());
            }
        }

        Deck deck = new Deck(spec.name());
        for (CardSpec cardSpec : spec.cards()) {
            DeckSection section = switch (cardSpec.section()) {
                case "commander" -> DeckSection.Commander;
                case "mainboard" -> DeckSection.Main;
                default -> throw new IllegalArgumentException(
                        "Unsupported deck section: " + cardSpec.section()
                );
            };
            deck.getOrCreate(section).add(resolved.get(cardSpec.name()), cardSpec.quantity());
        }
        return deck;
    }

    Map<String, Object> inspect(Deck deck) {
        CardPool main = deck.getMain();
        CardPool commander = deck.get(DeckSection.Commander);
        int mainboardCards = main == null ? 0 : main.countAll();
        int commanderCards = commander == null ? 0 : commander.countAll();
        List<String> commanders = commander == null
                ? List.of()
                : commander.toFlatList().stream().map(PaperCard::getName).toList();

        Map<String, Object> result = new LinkedHashMap<>();
        result.put("name", deck.getName());
        result.put("totalCards", deck.getAllCardsInASinglePool(true, false).countAll());
        result.put("mainboardCards", mainboardCards);
        result.put("commanderCards", commanderCards);
        result.put("commanders", commanders);
        result.put(
                "resolvedUniqueCards",
                deck.getAllCardsInASinglePool(true, false).countDistinct()
        );
        return result;
    }

    /**
     * @return the distinct commander card names, in first-seen order (never a summed quantity —
     *         two entries naming the same card, or one entry with quantity &gt; 1, is a malformed
     *         decklist, not "two commanders"; see the quantity check below).
     */
    private static List<String> validate(DeckSpec spec, boolean requireCommanders) {
        if (spec == null) {
            throw new IllegalArgumentException("deck must be an object.");
        }
        if (spec.name() == null || spec.name().isBlank()) {
            throw new IllegalArgumentException("deck.name must be a non-empty string.");
        }
        if (spec.cards() == null) {
            throw new IllegalArgumentException("deck.cards must be an array.");
        }

        Map<String, Long> commanderQuantities = new LinkedHashMap<>();
        long mainboardCards = 0;
        for (CardSpec card : spec.cards()) {
            if (card == null) {
                throw new IllegalArgumentException("deck.cards must not contain null values.");
            }
            if (card.name() == null || card.name().isBlank()) {
                throw new IllegalArgumentException("card.name must be a non-empty string.");
            }
            if (card.quantity() < 1) {
                throw new IllegalArgumentException(
                        "card.quantity must be a positive integer: " + card.name()
                );
            }
            if (card.section() == null) {
                throw new IllegalArgumentException(
                        "card.section must be commander or mainboard: " + card.name()
                );
            }
            switch (card.section()) {
                case "commander" -> commanderQuantities.merge(card.name(), (long) card.quantity(), Long::sum);
                case "mainboard" -> mainboardCards += card.quantity();
                default -> throw new IllegalArgumentException(
                        "card.section must be commander or mainboard: " + card.name()
                );
            }
        }

        if (mainboardCards == 0) {
            throw new IllegalArgumentException("Commander decks must contain a non-empty mainboard.");
        }
        if (commanderQuantities.values().stream().anyMatch(quantity -> quantity != 1)) {
            throw new IllegalArgumentException("Each commander must appear exactly once.");
        }
        if (requireCommanders && commanderQuantities.isEmpty()) {
            throw new IllegalArgumentException(
                    "Commander decks must contain one or two commanders; none was found."
            );
        }
        if (requireCommanders && commanderQuantities.size() > 2) {
            throw new UnsupportedCommanderConfigurationException(commanderQuantities.size());
        }
        return List.copyOf(commanderQuantities.keySet());
    }

    record CardSpec(String name, int quantity, String section) {
    }

    record DeckSpec(String name, List<CardSpec> cards) {
    }

    static final class CardsNotFoundException extends RuntimeException {
        private final List<String> cards;

        CardsNotFoundException(List<String> cards) {
            super("Some cards are not available in the pinned Forge card database.");
            this.cards = List.copyOf(cards);
        }

        List<String> cards() {
            return cards;
        }
    }

    static final class UnsupportedCommanderConfigurationException extends RuntimeException {
        private final long commanderCards;

        UnsupportedCommanderConfigurationException(long commanderCards) {
            super("Asphodel supports one or two commanders; found " + commanderCards + ".");
            this.commanderCards = commanderCards;
        }

        long commanderCards() {
            return commanderCards;
        }
    }

    /**
     * Thrown when exactly two named commander cards are supplied but Forge's own rules data
     * (vendor {@code CardRules.canBePartnerCommanders}) says this specific pair cannot share a
     * command zone — e.g. two unrelated legendary creatures with no Partner/Partner-with/Friends-
     * forever/Background/Doctor's-companion relationship. Asphodel never invents legality for an
     * arbitrary pair; this is Forge's own real rules-data check, surfaced as-is.
     */
    static final class IllegalCommanderPairException extends RuntimeException {
        private final String first;
        private final String second;

        IllegalCommanderPairException(String first, String second) {
            super("\"" + first + "\" and \"" + second + "\" cannot share a command zone: Forge's own "
                    + "commander rules (Partner, Partner with, Friends forever, Choose a Background, "
                    + "Doctor's companion) do not allow this specific pair.");
            this.first = first;
            this.second = second;
        }

        String first() {
            return first;
        }

        String second() {
            return second;
        }
    }
}
