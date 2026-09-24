import { ArchidektDeckSource } from "./archidekt-deck-source.js";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  CardsNotFoundError,
  DeckNotFoundError,
  InvalidDeckError,
} from "../app-errors.js";
import type { CardProvider, ResolvedCard } from "../cards/card-provider.js";
import type { AsphodelDatabase } from "../db/client.js";
import { cards, deckEntries, decks } from "../db/schema.js";
import {
  parseDeckList,
  type DeckSection,
  type ParsedCard,
} from "../deck-parser.js";

export interface DeckCardView {
  id: number;
  scryfallId: string;
  oracleId: string | null;
  name: string;
  manaCost: string | null;
  manaValue: number;
  typeLine: string;
  oracleText: string | null;
  colors: string[];
  colorIdentity: string[];
  imageUri: string | null;
  quantity: number;
  section: DeckSection;
  // The Builder's manual category for this row (e.g. "Ramp") — meaningful for mainboard rows only;
  // a commander-section row's category is never trusted as its group (see schema.ts's comment).
  category: string;
  categoryPosition: number;
}

export interface DeckDetailView {
  id: number;
  name: string;
  createdAt: string;
  updatedAt: string;
  totalCards: number;
  cards: DeckCardView[];
}

/** What the Builder sends on auto-save: its groups, in order, each with the cards it currently holds. */
export interface DeckEntryGroupInput {
  name: string;
  section: DeckSection;
  entries: { name: string; quantity: number }[];
}

interface AggregatedEntry extends ParsedCard {
  normalizedName: string;
}

interface CategorizedEntry extends AggregatedEntry {
  category: string;
  categoryPosition: number;
}

function normalizeCardName(name: string): string {
  return name.trim().normalize("NFKC").toLowerCase();
}

function aggregateEntries(parsedCards: ParsedCard[]): AggregatedEntry[] {
  const entries = new Map<string, AggregatedEntry>();

  for (const card of parsedCards) {
    const normalizedName = normalizeCardName(card.name);
    const key = `${card.section}\u0000${normalizedName}`;
    const existing = entries.get(key);

    if (existing) {
      existing.quantity += card.quantity;
    } else {
      entries.set(key, { ...card, normalizedName });
    }
  }

  return [...entries.values()];
}

/** Same idea as `aggregateEntries`, but keyed on category too — the Builder is free to (rarely, but
 *  legitimately) hold the same card in two different categories, and each must survive as its own row. */
function aggregateCategorizedEntries(groups: DeckEntryGroupInput[]): CategorizedEntry[] {
  const entries = new Map<string, CategorizedEntry>();

  groups.forEach((group, categoryPosition) => {
    const section = group.section;
    for (const entry of group.entries) {
      const name = entry.name.trim();
      if (!name || !Number.isSafeInteger(entry.quantity) || entry.quantity < 1) continue;
      const normalizedName = normalizeCardName(name);
      const key = `${section}\u0000${group.name}\u0000${normalizedName}`;
      const existing = entries.get(key);

      if (existing) {
        existing.quantity += entry.quantity;
      } else {
        entries.set(key, { name, quantity: entry.quantity, section, category: group.name, categoryPosition, normalizedName });
      }
    }
  });

  return [...entries.values()];
}

function serializeDate(value: Date): string {
  return value.toISOString();
}

export class DeckService {
  constructor(
    private readonly db: AsphodelDatabase,
    private readonly cardProvider: CardProvider,
    private readonly archidekt = new ArchidektDeckSource(),
  ) {}

  async listDecks() {
    const rows = await this.db
      .select({
        id: decks.id,
        name: decks.name,
        createdAt: decks.createdAt,
        updatedAt: decks.updatedAt,
        quantity: deckEntries.quantity,
        section: deckEntries.section,
        cardName: cards.name,
        imageUri: cards.imageUri,
      })
      .from(decks)
      .leftJoin(deckEntries, eq(deckEntries.deckId, decks.id))
      .leftJoin(cards, eq(cards.id, deckEntries.cardId))
      .orderBy(desc(decks.updatedAt), desc(decks.id));

    const result = new Map<
      number,
      {
        id: number;
        name: string;
        createdAt: string;
        updatedAt: string;
        totalCards: number;
        // Never a singleton: a real Commander deck can legally have two commanders (Partner,
        // Partner with, Friends forever, Background, Doctor's companion) — see V2f. Order follows
        // the query's own row order, never re-sorted or arbitrarily collapsed to "the last one".
        commanders: { name: string; imageUri: string | null }[];
      }
    >();

    for (const row of rows) {
      let deck = result.get(row.id);

      if (!deck) {
        deck = {
          id: row.id,
          name: row.name,
          createdAt: serializeDate(row.createdAt),
          updatedAt: serializeDate(row.updatedAt),
          totalCards: 0,
          commanders: [],
        };
        result.set(row.id, deck);
      }

      // Maybeboard cards are deliberately "not really in the deck" (Builder triage) — never counted.
      if (row.section !== "maybeboard") deck.totalCards += row.quantity ?? 0;
      if (row.section === "commander" && row.cardName) {
        deck.commanders.push({ name: row.cardName, imageUri: row.imageUri });
      }
    }

    return [...result.values()];
  }

  async getDeck(id: number): Promise<DeckDetailView> {
    const [deck] = await this.db
      .select()
      .from(decks)
      .where(eq(decks.id, id))
      .limit(1);

    if (!deck) throw new DeckNotFoundError();

    const entries = await this.db
      .select({
        id: cards.id,
        scryfallId: cards.scryfallId,
        oracleId: cards.oracleId,
        name: cards.name,
        manaCost: cards.manaCost,
        manaValue: cards.manaValue,
        typeLine: cards.typeLine,
        oracleText: cards.oracleText,
        colors: cards.colors,
        colorIdentity: cards.colorIdentity,
        imageUri: cards.imageUri,
        quantity: deckEntries.quantity,
        section: deckEntries.section,
        category: deckEntries.category,
        categoryPosition: deckEntries.categoryPosition,
      })
      .from(deckEntries)
      .innerJoin(cards, eq(cards.id, deckEntries.cardId))
      .where(eq(deckEntries.deckId, id))
      .orderBy(asc(deckEntries.section), asc(deckEntries.categoryPosition), asc(cards.name));

    return {
      id: deck.id,
      name: deck.name,
      createdAt: serializeDate(deck.createdAt),
      updatedAt: serializeDate(deck.updatedAt),
      // Maybeboard cards are deliberately "not really in the deck" (Builder triage) — never counted.
      totalCards: entries.filter((entry) => entry.section !== "maybeboard").reduce((sum, entry) => sum + entry.quantity, 0),
      cards: entries,
    };
  }

  async createDeck(name: string, decklist: string): Promise<DeckDetailView> {
    const parsed = parseDeckList(decklist);
    if (parsed.issues.length > 0) throw new InvalidDeckError(parsed.issues);

    return this.createDeckFromEntries(name, parsed.cards);
  }

  async importArchidektDeck(url: string): Promise<DeckDetailView> {
    const spec = await this.archidekt.fetchDeckSpec(url);
    return this.createDeckFromEntries(spec.name, spec.cards.map(card => ({ ...card, section: card.section as DeckSection })));
  }

  /** Resolves every requested card (cache hit, or a fresh Scryfall lookup) and makes sure each one
   *  has a row in `cards`, without touching `decks`/`deckEntries` — shared by deck creation and by
   *  `updateDeckCards`, which only ever replaces entries for a deck that already exists. */
  private async resolveEntries(entries: AggregatedEntry[]): Promise<Map<string, number>> {
    const requestedNames = new Map<string, string>();
    const requestedPrintings = new Map<string, { setCode: string; collectorNumber: string }>();
    for (const entry of entries) {
      requestedNames.set(entry.normalizedName, entry.name);
      if (entry.setCode && entry.collectorNumber) {
        requestedPrintings.set(entry.normalizedName, { setCode: entry.setCode, collectorNumber: entry.collectorNumber });
      }
    }

    const normalizedNames = [...requestedNames.keys()];
    const cachedCards =
      normalizedNames.length === 0
        ? []
        : await this.db
            .select()
            .from(cards)
            .where(inArray(cards.normalizedName, normalizedNames));

    const resolutionByRequestedName = new Map<
      string,
      { scryfallId: string; card?: ResolvedCard }
    >();

    for (const card of cachedCards) {
      resolutionByRequestedName.set(card.normalizedName, {
        scryfallId: card.scryfallId,
      });
    }

    const notFound: string[] = [];

    for (const [normalizedName, requestedName] of requestedNames) {
      if (resolutionByRequestedName.has(normalizedName)) continue;

      // Preferred resolution: the exact printing the decklist named (set + collector number).
      // Never silently drop it — only fall back to a plain name lookup when the printing itself
      // is unavailable, and only fail the import once neither resolves.
      const printing = requestedPrintings.get(normalizedName);
      const resolved =
        (printing && (await this.cardProvider.findBySetAndCollector(printing.setCode, printing.collectorNumber))) ||
        (await this.cardProvider.findByExactName(requestedName));
      if (!resolved) {
        notFound.push(requestedName);
        continue;
      }

      resolutionByRequestedName.set(normalizedName, {
        scryfallId: resolved.scryfallId,
        card: resolved,
      });
    }

    if (notFound.length > 0) throw new CardsNotFoundError(notFound);

    const newCards = [...resolutionByRequestedName.values()]
      .map((resolution) => resolution.card)
      .filter((card): card is ResolvedCard => Boolean(card));

    if (newCards.length > 0) {
      await this.db
        .insert(cards)
        .values(
          newCards.map((card) => ({
            scryfallId: card.scryfallId,
            oracleId: card.oracleId,
            name: card.name,
            normalizedName: normalizeCardName(card.name),
            manaCost: card.manaCost,
            manaValue: card.manaValue,
            typeLine: card.typeLine,
            oracleText: card.oracleText,
            colors: card.colors,
            colorIdentity: card.colorIdentity,
            imageUri: card.imageUri,
          })),
        )
        .onConflictDoNothing();
    }

    const scryfallIds = [
      ...new Set(
        [...resolutionByRequestedName.values()].map(
          (resolution) => resolution.scryfallId,
        ),
      ),
    ];
    const storedCards =
      scryfallIds.length === 0
        ? []
        : await this.db
            .select({ id: cards.id, scryfallId: cards.scryfallId })
            .from(cards)
            .where(inArray(cards.scryfallId, scryfallIds));
    const cardIdByScryfallId = new Map(
      storedCards.map((card) => [card.scryfallId, card.id]),
    );

    const cardIdByNormalizedName = new Map<string, number>();
    for (const [normalizedName, resolution] of resolutionByRequestedName) {
      const cardId = cardIdByScryfallId.get(resolution.scryfallId);
      if (cardId) cardIdByNormalizedName.set(normalizedName, cardId);
    }
    return cardIdByNormalizedName;
  }

  private async createDeckFromEntries(name: string, cardsToStore: ParsedCard[]): Promise<DeckDetailView> {
    const entries = aggregateEntries(cardsToStore);
    const cardIdByNormalizedName = await this.resolveEntries(entries);

    const deckId = await this.db.transaction(async (transaction) => {
      const [createdDeck] = await transaction
        .insert(decks)
        .values({ name })
        .returning({ id: decks.id });

      if (!createdDeck) throw new Error("La création du deck a échoué.");

      if (entries.length > 0) {
        await transaction.insert(deckEntries).values(
          entries.map((entry) => {
            const cardId = cardIdByNormalizedName.get(entry.normalizedName);
            if (!cardId) throw new Error(`Carte non persistée : ${entry.name}`);

            return {
              deckId: createdDeck.id,
              cardId,
              quantity: entry.quantity,
              section: entry.section,
            };
          }),
        );
      }

      return createdDeck.id;
    });

    return this.getDeck(deckId);
  }

  /** Replaces a deck's entire card list in place (Deck Lab's Builder auto-save) — same resolution
   *  path as creation/import, but the deck row and its id survive; only `deckEntries` is swapped.
   *  Structured groups (not decklist text) so the Builder's manual categories — not just the
   *  commander/mainboard split — round-trip through a save/reload. */
  async updateDeckCards(id: number, groups: DeckEntryGroupInput[]): Promise<DeckDetailView> {
    const entries = aggregateCategorizedEntries(groups);
    const cardIdByNormalizedName = await this.resolveEntries(entries);

    await this.db.transaction(async (transaction) => {
      const existing = await transaction
        .select({ id: decks.id })
        .from(decks)
        .where(eq(decks.id, id))
        .limit(1);
      if (existing.length === 0) throw new DeckNotFoundError();

      await transaction.delete(deckEntries).where(eq(deckEntries.deckId, id));

      if (entries.length > 0) {
        await transaction.insert(deckEntries).values(
          entries.map((entry) => {
            const cardId = cardIdByNormalizedName.get(entry.normalizedName);
            if (!cardId) throw new Error(`Carte non persistée : ${entry.name}`);

            return {
              deckId: id,
              cardId,
              quantity: entry.quantity,
              section: entry.section,
              category: entry.category,
              categoryPosition: entry.categoryPosition,
            };
          }),
        );
      }

      await transaction.update(decks).set({ updatedAt: new Date() }).where(eq(decks.id, id));
    });

    return this.getDeck(id);
  }

  async renameDeck(id: number, name: string): Promise<DeckDetailView> {
    const updated = await this.db
      .update(decks)
      .set({ name, updatedAt: new Date() })
      .where(and(eq(decks.id, id)))
      .returning({ id: decks.id });

    if (updated.length === 0) throw new DeckNotFoundError();
    return this.getDeck(id);
  }

  async deleteDeck(id: number): Promise<void> {
    const deleted = await this.db
      .delete(decks)
      .where(eq(decks.id, id))
      .returning({ id: decks.id });

    if (deleted.length === 0) throw new DeckNotFoundError();
  }
}
