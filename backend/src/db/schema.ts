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
    section: text("section", { enum: ["commander", "mainboard"] }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.deckId, table.cardId, table.section] }),
    index("deck_entries_deck_id_index").on(table.deckId),
    check("deck_entries_quantity_positive", sql`${table.quantity} > 0`),
    check(
      "deck_entries_section_valid",
      sql`${table.section} in ('commander', 'mainboard')`,
    ),
  ],
);
