import type { AgentChoice, AgentCardObservation, DecisionPrompt, MenuItem } from "./types.js";

export interface HandActionMap {
  /** Every legal action that refers to a card genuinely in the human's own visible hand right now, keyed by Forge's own cardRef — never by name, so two same-named cards (two Mountains) stay distinct entries. */
  byCardRef: Map<string, MenuItem[]>;
  /** Everything else — no card reference at all (e.g. "Pass priority"), or a cardRef that isn't currently a card in this hand (an ability sourced from the battlefield, say). Stays in the decision dock, unchanged. */
  unmapped: MenuItem[];
}

const EMPTY_MAP: HandActionMap = { byCardRef: new Map(), unmapped: [] };

/**
 * Pure. Splits a priority_action menu's already-legal items into "one visible hand card can
 * represent this" vs "keep it in the dock" — using ONLY the exact `cardRef`/`AgentChoice` Forge
 * already provided. Never infers legality from card metadata (name, type line, mana cost, …) and
 * never invents an action: every returned item is copied verbatim from `prompt.items`. Only a
 * `"menu"`-kind prompt can map anything (a `"value"` prompt — an X spell's amount — is untouched,
 * per V2e.4's scope: this patch replaces only the first card-based priority action interaction).
 */
export function mapPriorityActionsToHand(prompt: DecisionPrompt, hand: readonly AgentCardObservation[]): HandActionMap {
  if (prompt.kind !== "menu") return EMPTY_MAP;
  const handRefs = new Set(hand.map((card) => card.cardRef));
  const byCardRef = new Map<string, MenuItem[]>();
  const unmapped: MenuItem[] = [];
  for (const item of prompt.items) {
    if (item.cardRef && handRefs.has(item.cardRef)) {
      const existing = byCardRef.get(item.cardRef);
      if (existing) existing.push(item);
      else byCardRef.set(item.cardRef, [item]);
    } else {
      unmapped.push(item);
    }
  }
  return { byCardRef, unmapped };
}

export type PriorityCardActionDecision =
  | { kind: "submit"; choice: AgentChoice }
  | { kind: "menu"; items: MenuItem[] };

/**
 * Pure. What clicking a playable hand card should do, given the exact legal actions mapped to it:
 * a single legal action submits it directly; more than one opens a contextual menu of exactly
 * those Forge-provided options. Never invents a third option and never collapses multiple options
 * into one guess.
 */
export function decidePriorityCardAction(items: readonly MenuItem[]): PriorityCardActionDecision {
  if (items.length === 1) return { kind: "submit", choice: items[0]!.choice };
  return { kind: "menu", items: [...items] };
}
