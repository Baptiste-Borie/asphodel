import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const cards = sqliteTable(
  "cards",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    scryfallId: text("scryfall_id").notNull(),
    oracleId: text("oracle_id"),
    name: text("name").notNull(),
    normalizedName: text("normalized_name").notNull(),
    manaCost: text("mana_cost"),
    manaValue: real("mana_value").notNull().default(0),
    typeLine: text("type_line").notNull(),
    oracleText: text("oracle_text"),
    colors: text("colors", { mode: "json" }).$type<string[]>().notNull(),
    colorIdentity: text("color_identity", { mode: "json" })
      .$type<string[]>()
      .notNull(),
    imageUri: text("image_uri"),
  },
  (table) => [
    uniqueIndex("cards_scryfall_id_unique").on(table.scryfallId),
    uniqueIndex("cards_normalized_name_unique").on(table.normalizedName),
  ],
);

export const decks = sqliteTable("decks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  createdAt: integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
});

export const deckEntries = sqliteTable(
  "deck_entries",
  {
    deckId: integer("deck_id")
      .notNull()
      .references(() => decks.id, { onDelete: "cascade" }),
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id),
    quantity: integer("quantity").notNull(),
    // "maybeboard" (Deck Lab's Builder triage: cards set aside as interesting but not included)
    // is a real section like the other two, but is always excluded from a deck's totalCards and
    // from what ForgeDeckAdapter sends to an actual game — see deck-service.ts / forge-deck-adapter.ts.
    section: text("section", { enum: ["commander", "mainboard", "maybeboard"] }).notNull(),
    // The Builder's manual categories (e.g. "Ramp", "Lands") — free text, only meaningful within
    // mainboard: commander-section rows always render as one pinned "Commander" group regardless
    // of what's stored here (see deck-service.ts getDeck / deck-lab-view.ts sheetFromDeckDetail).
    // Defaults to "Mainboard" so a deck created via plain decklist import (no category concept)
    // still opens as the familiar two-bucket view.
    category: text("category").notNull().default("Mainboard"),
    // Position of this row's category among the deck's categories, so re-opening a deck in the
    // Builder restores category order (drag/reorder), not just membership.
    categoryPosition: integer("category_position").notNull().default(0),
  },
  (table) => [
    primaryKey({ columns: [table.deckId, table.cardId, table.section, table.category] }),
    index("deck_entries_deck_id_index").on(table.deckId),
    check("deck_entries_quantity_positive", sql`${table.quantity} > 0`),
    check(
      "deck_entries_section_valid",
      sql`${table.section} in ('commander', 'mainboard', 'maybeboard')`,
    ),
  ],
);
