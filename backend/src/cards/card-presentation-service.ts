import type { CardProvider } from "./card-provider.js";

/**
 * Pure presentation metadata for one card — never a rules/legality input, never sent through the
 * Forge protocol. Deliberately separate from `AgentCardObservation` and `ResolvedCard`: this is
 * what the browser needs to render a card, not what Forge needs to play one.
 */
export interface CardPresentation {
  name: string;
  manaCost: string | null;
  manaValue: number;
  typeLine: string;
  oracleText: string | null;
  imageUri: string | null;
}

/** A single request never resolves more names than this — a personal-tool batch, not an unbounded fan-out. */
export const MAX_CARD_PRESENTATION_NAMES = 75;

function normalize(name: string): string {
  return name.trim().normalize("NFKC").toLowerCase();
}

/**
 * Batch name -> presentation, backed by `CardProvider.findByExactName` (itself already an
 * in-memory Scryfall bulk-data lookup after its first load — no network call per name). Adds one
 * more cache keyed by normalized name so repeated requests for the same card across many playtest
 * polls never re-resolve it, and so one card's lookup failure never fails the whole batch.
 */
export class CardPresentationService {
  private readonly cache = new Map<string, CardPresentation | null>();

  constructor(private readonly cardProvider: CardProvider) {}

  /** Only ever called with card names the caller already knows are publicly visible (never a hidden identity). Names absent from the result were not found — not an error. */
  async resolveMany(names: readonly string[]): Promise<Record<string, CardPresentation>> {
    const requested = [...new Set(names.map(name => name.trim()).filter(name => name.length > 0))]
      .slice(0, MAX_CARD_PRESENTATION_NAMES);
    const result: Record<string, CardPresentation> = {};
    await Promise.all(requested.map(async name => {
      const presentation = await this.resolveOne(name);
      if (presentation) result[name] = presentation;
    }));
    return result;
  }

  private async resolveOne(name: string): Promise<CardPresentation | null> {
    const key = normalize(name);
    if (this.cache.has(key)) return this.cache.get(key)!;
    let presentation: CardPresentation | null;
    try {
      const resolved = await this.cardProvider.findByExactName(name);
      presentation = resolved && {
        name: resolved.name, manaCost: resolved.manaCost, manaValue: resolved.manaValue,
        typeLine: resolved.typeLine, oracleText: resolved.oracleText, imageUri: resolved.imageUri,
      };
    } catch {
      // One card's provider failure (e.g. a transient bulk-file issue) must never fail the batch.
      presentation = null;
    }
    this.cache.set(key, presentation);
    return presentation;
  }
}
