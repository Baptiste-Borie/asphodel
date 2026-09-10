import type { AgentCommanderObservation } from "./types.js";

/**
 * V2h "COMMANDER TAX VISIBILITY": pure. The exact badge text for a commander's currently-in-effect
 * generic-mana tax, or `null` when nothing should be shown — either the tax is genuinely zero (never
 * cast from the command zone yet), or `commanderTaxGeneric` simply isn't present on this
 * observation (an older bridge). Never guesses/derives a tax value from `castsFromCommand` itself —
 * that multiplication is Forge's own rule (`forge.game.cost.CostAdjustment`), computed bridge-side
 * and relayed verbatim; this function only ever formats what's already there.
 */
export function commanderTaxLabel(commander: Pick<AgentCommanderObservation, "commanderTaxGeneric">): string | null {
  const tax = commander.commanderTaxGeneric;
  if (tax === undefined || tax <= 0) return null;
  return `+${tax}`;
}
