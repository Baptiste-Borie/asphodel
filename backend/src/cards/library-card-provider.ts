import { eq } from "drizzle-orm";
import type { AsphodelDatabase } from "../db/client.js";
import { cards } from "../db/schema.js";
import type { CardProvider, ResolvedCard } from "./card-provider.js";

/** Existing decks carry their own card metadata: editing/presenting them needs no network. */
export class LibraryCardProvider implements CardProvider {
  constructor(private readonly database: AsphodelDatabase, private readonly fallback: CardProvider) {}

  async findByExactName(name: string): Promise<ResolvedCard | null> {
    const normalizedName = name.trim().normalize("NFKC").toLowerCase();
    const card = await this.database.select().from(cards).where(eq(cards.normalizedName, normalizedName)).get();
    if (card) {
      const { id: _id, normalizedName: _normalizedName, ...resolved } = card;
      return resolved;
    }
    return this.fallback.findByExactName(name);
  }

  findBySetAndCollector(setCode: string, collectorNumber: string): Promise<ResolvedCard | null> {
    // A name-only library cache cannot verify an exact printing.
    return this.fallback.findBySetAndCollector(setCode, collectorNumber);
  }
}
