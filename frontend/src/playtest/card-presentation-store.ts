import { fetchCardPresentations } from "../api/card-presentation-api.js";
import type { CardPresentation } from "./types.js";

export type CardPresentationFetcher = (names: readonly string[]) => Promise<Record<string, CardPresentation>>;

/** Pure: names not already cached, deduplicated, in first-seen order. Never re-requests a name the store already resolved (found or not found). */
export function selectMissingNames(cache: ReadonlyMap<string, CardPresentation | null>, names: readonly string[]): string[] {
  const seen = new Set<string>();
  const missing: string[] = [];
  for (const name of names) {
    if (seen.has(name) || cache.has(name)) continue;
    seen.add(name);
    missing.push(name);
  }
  return missing;
}

/**
 * One name -> one network round trip, ever, for the lifetime of a playtest: `ensure()` is the only
 * entry point, and it only ever fetches names this store has never seen before. A card not found by
 * the backend is cached as `null` so a persistently-unresolvable name is not retried every poll.
 * Concurrent `ensure()` calls for overlapping names share one in-flight request per name.
 */
export class CardPresentationStore {
  private readonly cache = new Map<string, CardPresentation | null>();
  private readonly inFlight = new Map<string, Promise<void>>();
  private readonly fetcher: CardPresentationFetcher;

  constructor(fetcher: CardPresentationFetcher = fetchCardPresentations) {
    this.fetcher = fetcher;
  }

  /** `undefined` = never requested; `null` = requested, not found; otherwise the resolved presentation. */
  get(name: string): CardPresentation | null | undefined {
    return this.cache.get(name);
  }

  /** Returns whether any name was newly resolved this call — callers use it to know whether a re-render is worth doing. */
  async ensure(names: readonly string[]): Promise<boolean> {
    const toFetch = selectMissingNames(this.cache, names).filter(name => !this.inFlight.has(name));
    if (toFetch.length) {
      const request = this.fetcher(toFetch)
        .then(result => {
          for (const name of toFetch) this.cache.set(name, result[name] ?? null);
        })
        .finally(() => {
          for (const name of toFetch) this.inFlight.delete(name);
        });
      for (const name of toFetch) this.inFlight.set(name, request);
    }
    const outstanding = new Set(names.flatMap(name => this.inFlight.has(name) ? [this.inFlight.get(name)!] : []));
    await Promise.all(outstanding);
    return toFetch.length > 0;
  }
}
