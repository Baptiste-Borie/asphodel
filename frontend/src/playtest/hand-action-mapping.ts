import type { AgentChoice, AgentCardObservation, DecisionPrompt, MenuItem } from "./types.js";

export interface CardActionMap {
  /** Every legal action that refers to a card genuinely visible right now, keyed by Forge's own cardRef — never by name, so two same-named cards (two Mountains, two Goblin tokens) stay distinct entries. */
  byCardRef: Map<string, MenuItem[]>;
  /** Everything else — no card reference at all (e.g. "Pass priority", "Finish"), or a cardRef that isn't currently one of the supplied visible cards. Stays in the decision dock, unchanged. */
  unmapped: MenuItem[];
}

const EMPTY_MAP: CardActionMap = { byCardRef: new Map(), unmapped: [] };

/**
 * Pure. Splits a menu decision's already-legal items into "one visible card can represent this"
 * vs "keep it in the dock" — using ONLY the exact `cardRef`/`AgentChoice` Forge already provided.
 * Never infers legality from card metadata (name, type line, mana cost, …) and never invents an
 * action: every returned item is copied verbatim from `prompt.items`. Only a `"menu"`-kind prompt
 * can map anything (a `"value"` prompt — an X spell's amount — is always left untouched).
 *
 * Introduced in V2e.4 for the human's own hand during `priority_action`; generalized in V2e.5 to
 * any set of currently-visible cardRefs (e.g. battlefield permanents during
 * attackers/blockers/target/cost-object selection — see `playtest-view.ts`), since
 * `describeDecision` now populates `cardRef` for those families too.
 */
export function mapActionsToCards(prompt: DecisionPrompt, visibleCardRefs: Iterable<string>): CardActionMap {
  if (prompt.kind !== "menu") return EMPTY_MAP;
  const known = new Set(visibleCardRefs);
  const byCardRef = new Map<string, MenuItem[]>();
  const unmapped: MenuItem[] = [];
  for (const item of prompt.items) {
    if (item.cardRef && known.has(item.cardRef)) {
      const existing = byCardRef.get(item.cardRef);
      if (existing) existing.push(item);
      else byCardRef.set(item.cardRef, [item]);
    } else {
      unmapped.push(item);
    }
  }
  return { byCardRef, unmapped };
}

/** Convenience wrapper over `mapActionsToCards` for the human's own hand specifically. */
export function mapPriorityActionsToHand(prompt: DecisionPrompt, hand: readonly AgentCardObservation[]): CardActionMap {
  return mapActionsToCards(prompt, hand.map((card) => card.cardRef));
}

export interface SplitCardActionMap {
  hand: CardActionMap;
  board: CardActionMap;
}

/**
 * Pure. Splits one combined `CardActionMap` into a "hand" bucket and a "board" bucket, based on
 * which of its mapped cardRefs are among the supplied `handCardRefs`. Introduced in V2e.6 so a
 * single `priority_action` decision can highlight BOTH a castable hand card (e.g. Krenko) AND an
 * activatable battlefield permanent (e.g. Skirk Prospector) at the same time — previously
 * `priority_action` was special-cased to the hand only, which meant an activated ability already
 * on the battlefield was never presented as a clickable card. Both buckets share the exact SAME
 * `unmapped` array reference (nothing is filtered twice) — the decision dock only needs to read it
 * from either side.
 */
export function splitCardActionMapByHand(map: CardActionMap, handCardRefs: Iterable<string>): SplitCardActionMap {
  const handRefs = new Set(handCardRefs);
  const hand: CardActionMap = { byCardRef: new Map(), unmapped: map.unmapped };
  const board: CardActionMap = { byCardRef: new Map(), unmapped: map.unmapped };
  for (const [cardRef, items] of map.byCardRef) {
    (handRefs.has(cardRef) ? hand : board).byCardRef.set(cardRef, items);
  }
  return { hand, board };
}

export type CardActionDecision =
  | { kind: "submit"; choice: AgentChoice }
  | { kind: "menu"; items: MenuItem[] };

/**
 * Pure. What clicking a card mapped to one-or-more legal actions should do: a single legal action
 * submits it directly; more than one opens a contextual menu of exactly those Forge-provided
 * options. Never invents a third option and never collapses multiple options into one guess.
 */
export function decideCardAction(items: readonly MenuItem[]): CardActionDecision {
  if (items.length === 1) return { kind: "submit", choice: items[0]!.choice };
  return { kind: "menu", items: [...items] };
}

/**
 * Pure. Decides which already-legal menu items belong in the explicit decision dock, given the
 * current Play Mode (V2g). This is the exact seam `playtest-view.ts` was missing (V2g.1): mapping a
 * hand action onto a cardRef is not, by itself, a reason to hide it — that's only true where the
 * matching card is ALSO a clickable digital surface.
 *
 * DIGITAL: unchanged from V2e.6 — both hand and board cards are clickable digital surfaces, so
 * every hand/board-mapped action is represented there instead and only `unmapped` reaches the dock.
 *
 * PHYSICAL ("Physical Companion"): the human's own hand is real cardboard, never a clickable
 * digital surface (`renderCompactHand`, not `renderHand`) — so every action mapped to a HAND
 * cardRef must still surface here, verbatim (exact label, exact `AgentChoice`), alongside the
 * unmapped items. Board/commander-mapped actions keep their existing direct-card affordance in
 * BOTH modes and are deliberately left out of the dock here — including them would duplicate an
 * action that's already reachable by clicking the card, which is the "IMPORTANT DISTINCTION" this
 * function exists to preserve (do not simply disable all filtering in Physical mode).
 *
 * Never re-derives legality and never invents an item: every returned `MenuItem` is one already
 * present in `mapping.hand.byCardRef`/`mapping.unmapped`, untouched — so its `choice` (the exact
 * Forge `AgentChoice`) submits exactly as it would have from a clickable card.
 */
export function buildDockItems(
  mapping: { hand: CardActionMap; board: CardActionMap; unmapped: MenuItem[] },
  playMode: "digital" | "physical",
): MenuItem[] {
  if (playMode !== "physical") return mapping.unmapped;
  const handItems = [...mapping.hand.byCardRef.values()].flat();
  return [...mapping.unmapped, ...handItems];
}
