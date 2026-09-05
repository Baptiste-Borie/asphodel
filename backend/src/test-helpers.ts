import type { CardProvider, ResolvedCard } from "./cards/card-provider.js";
import { createDatabase } from "./db/client.js";

export class FakeCardProvider implements CardProvider {
  readonly calls: string[] = [];
  readonly printingCalls: string[] = [];

  constructor(
    private readonly missingNames = new Set<string>(),
    /** key: `${setCode.toLowerCase()}/${collectorNumber}` -> the card name that printing resolves to. */
    private readonly printings = new Map<string, string>(),
  ) {}

  async findByExactName(name: string): Promise<ResolvedCard | null> {
    this.calls.push(name);
    if (this.missingNames.has(name)) return null;
    return this.synthesizeCard(name);
  }

  async findBySetAndCollector(setCode: string, collectorNumber: string): Promise<ResolvedCard | null> {
    const key = `${setCode.toLowerCase()}/${collectorNumber}`;
    this.printingCalls.push(key);
    const name = this.printings.get(key);
    return name ? this.synthesizeCard(name) : null;
  }

  private synthesizeCard(name: string): ResolvedCard {
    const slug = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");

    return {
      scryfallId: `scryfall-${slug}`,
      oracleId: `oracle-${slug}`,
      name,
      manaCost: name === "Mountain" ? null : "{1}{R}",
      manaValue: name === "Mountain" ? 0 : 2,
      typeLine: name === "Mountain" ? "Basic Land — Mountain" : "Creature",
      oracleText: null,
      colors: name === "Mountain" ? [] : ["R"],
      colorIdentity: ["R"],
      imageUri: `https://cards.example/${slug}.jpg`,
    };
  }
}

export async function createTestDatabase() {
  return createDatabase("file::memory:");
}
