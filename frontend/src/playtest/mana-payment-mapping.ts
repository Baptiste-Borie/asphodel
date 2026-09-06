import { isLandCard } from "./land-zone.js";
import type { AgentCardObservation, MenuItem } from "./types.js";

export interface ManaSourceGroup {
  cardRef: string;
  /** The real card, for display (image/name/typeLine) — presentation only. */
  card: AgentCardObservation;
  /** Every currently-legal Forge mana option tied to this exact source (more than one for a multi-color source, e.g. Command Tower). */
  options: MenuItem[];
}

export interface ManaPaymentGroups {
  lands: ManaSourceGroup[];
  other: ManaSourceGroup[];
  /** Floating mana — no physical card, `cardRef: null`. Each is already a complete, independent choice. */
  floating: MenuItem[];
}

/**
 * Pure. Groups a `mana_payment` menu's items by their exact Forge `sourceCardRef` — never by
 * name, so two same-named lands (two Mountains) always stay two separate groups. A source with
 * more than one currently-legal option (a multi-color permanent) keeps every one of those options
 * under its single group, in Forge's own order — never collapsed or arbitrarily picked. Floating
 * mana (`cardRef: null`) is separated out entirely, since it has no physical card to click.
 * `cardsByRef` supplies the real card for display; an item whose cardRef isn't found there is
 * dropped rather than shown as an uninspectable phantom — this should not happen in practice,
 * since Forge only ever offers a mana source that is genuinely on the battlefield.
 */
export function groupManaPaymentOptions(items: readonly MenuItem[], cardsByRef: ReadonlyMap<string, AgentCardObservation>): ManaPaymentGroups {
  const bySourceCardRef = new Map<string, MenuItem[]>();
  const order: string[] = [];
  const floating: MenuItem[] = [];
  for (const item of items) {
    if (!item.cardRef) {
      floating.push(item);
      continue;
    }
    const existing = bySourceCardRef.get(item.cardRef);
    if (existing) existing.push(item);
    else {
      bySourceCardRef.set(item.cardRef, [item]);
      order.push(item.cardRef);
    }
  }

  const lands: ManaSourceGroup[] = [];
  const other: ManaSourceGroup[] = [];
  for (const cardRef of order) {
    const card = cardsByRef.get(cardRef);
    if (!card) continue;
    const group: ManaSourceGroup = { cardRef, card, options: bySourceCardRef.get(cardRef)! };
    (isLandCard(card) ? lands : other).push(group);
  }
  return { lands, other, floating };
}
