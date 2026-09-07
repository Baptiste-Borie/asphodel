import type { ForgeDeckSpec } from "../forge/forge-protocol.js";

/**
 * V2g Physical Companion — the "Physical Hidden-Zone / Card Identity layer" (spec §5).
 *
 * Deliberately NOT an independent accounting system: Forge's own library contents are the only
 * authoritative source for "what remains" (`ForgePendingPhysicalIdentityDecision.candidates`,
 * recomputed fresh by the bridge on every physical request). Re-deriving that count independently
 * here would create a second, driftable source of truth — exactly what spec §4 forbids. Instead
 * this ledger distinguishes the three things spec §5 asks for by construction:
 *
 * - KNOWN DECK COMPOSITION: `deckComposition`, static, from the resolved decklist at match start.
 * - KNOWN PHYSICAL CARD IDENTITY: `accounted()`, derived as composition minus Forge's own latest
 *   authoritative remaining count — i.e. every copy already placed in a non-library zone.
 * - UNKNOWN LIBRARY ORDER: never modeled at all. This ledger only ever tracks NAME COUNTS, never a
 *   position/order — there is no "next N cards" cache to invalidate on shuffle, because none is
 *   ever kept (see `PhysicalIdentityCoordinator` on the bridge side for the actual order semantics).
 *
 * Purely a presentation/diagnostic mirror: fast local fuzzy-search data and report material. It is
 * never consulted to decide whether a declaration is legal — the bridge is the only validator.
 */
export interface PhysicalLedgerSnapshot {
  deckComposition: Record<string, number>;
  /** Forge's own candidates from the most recent physical request; null before the first one. */
  lastKnownRemaining: Record<string, number> | null;
  lastEventKind: string | null;
  /** deckComposition minus lastKnownRemaining, floored at 0 — omits any name fully unaccounted. */
  accounted: Record<string, number>;
}

export class PhysicalLedger {
  private lastKnownRemaining: Record<string, number> | null = null;
  private lastEventKind: string | null = null;

  constructor(private readonly deckComposition: Record<string, number>) {}

  /** Called every time a physical request arrives — always mirrors, never recomputes. */
  observe(request: { eventKind: string; candidates: { name: string; remaining: number }[] }): void {
    this.lastKnownRemaining = Object.fromEntries(request.candidates.map(c => [c.name, c.remaining]));
    this.lastEventKind = request.eventKind;
  }

  snapshot(): PhysicalLedgerSnapshot {
    const remaining = this.lastKnownRemaining ?? this.deckComposition;
    const accounted: Record<string, number> = {};
    for (const [name, total] of Object.entries(this.deckComposition)) {
      const left = remaining[name] ?? total;
      if (total - left > 0) accounted[name] = total - left;
    }
    return {
      deckComposition: this.deckComposition,
      lastKnownRemaining: this.lastKnownRemaining,
      lastEventKind: this.lastEventKind,
      accounted,
    };
  }
}

/** Mainboard-only composition (name -> total quantity) — a commander never sits in the library. */
export function deckCompositionFrom(spec: ForgeDeckSpec): Record<string, number> {
  const composition: Record<string, number> = {};
  for (const card of spec.cards) {
    if (card.section !== "mainboard") continue;
    composition[card.name] = (composition[card.name] ?? 0) + card.quantity;
  }
  return composition;
}
