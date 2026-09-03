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

    Deck build(DeckSpec spec, boolean requireSingleCommander) {
        validate(spec, requireSingleCommander);

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

    private static void validate(DeckSpec spec, boolean requireSingleCommander) {
        if (spec == null) {
            throw new IllegalArgumentException("deck must be an object.");
        }
        if (spec.name() == null || spec.name().isBlank()) {
            throw new IllegalArgumentException("deck.name must be a non-empty string.");
        }
        if (spec.cards() == null) {
            throw new IllegalArgumentException("deck.cards must be an array.");
        }

        long commanderCards = 0;
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
                case "commander" -> commanderCards += card.quantity();
                case "mainboard" -> mainboardCards += card.quantity();
                default -> throw new IllegalArgumentException(
                        "card.section must be commander or mainboard: " + card.name()
                );
            }
        }

        if (mainboardCards == 0) {
            throw new IllegalArgumentException("Commander decks must contain a non-empty mainboard.");
        }
        if (requireSingleCommander && commanderCards == 0) {
            throw new IllegalArgumentException(
                    "Commander decks must contain exactly one commander; none was found."
            );
        }
        if (requireSingleCommander && commanderCards > 1) {
            throw new UnsupportedCommanderConfigurationException(commanderCards);
        }
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
            super("Asphodel Forge Deck Adapter V1b supports exactly one commander.");
            this.commanderCards = commanderCards;
        }

        long commanderCards() {
            return commanderCards;
        }
    }
}
