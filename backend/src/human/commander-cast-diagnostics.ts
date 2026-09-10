import type { AgentObservation, ForgePendingExternalDecision } from "../forge/forge-protocol.js";

/**
 * V2h "K'RRIK REAL-MATCH ISSUE": a real Physical Companion game reported "Cast K'rrik..." missing
 * from the action dock despite (by the player's own account) affordable mana and life, and zero
 * commander tax. A dedicated regression (`KrrikPhyrexianCastLegalityTest.java`) proves the isolated
 * Forge legal-action path is correct for exactly that scenario (4 generic mana + 6 life for the
 * Phyrexian symbols) — this file exists for the case that could NOT be reproduced in this pass: the
 * discrepancy may be in real-match state this fixture doesn't represent (an extra land tapped for a
 * different color, priority not genuinely with the human yet, stack non-empty, a second commander's
 * tax interacting, …).
 *
 * Opt-in only (`ASPHODEL_DEBUG_COMMANDER_CAST=1`) — never fires otherwise, so normal/production play
 * produces zero extra output (the spec explicitly asks for diagnostics, not noisy logging). When
 * enabled, dumps exactly the fields needed to investigate the NEXT occurrence: active player,
 * priority holder, phase/stack, each command-zone commander's tax/cast count, the acting player's
 * life, and the exact `priority_action` actions Forge actually offered — a read-only observation,
 * never used to alter any decision or invent a fallback action.
 */
export function logCommanderCastDiagnostics(
  observation: AgentObservation,
  decision: Extract<ForgePendingExternalDecision, { type: "priority_action" }>,
): void {
  // Read at call time (never cached at module-load time) — this is the ONLY branch that decides
  // whether anything is emitted, so a toggle always takes effect immediately.
  if (process.env.ASPHODEL_DEBUG_COMMANDER_CAST !== "1") return;
  const actingPlayer = observation.players.find((p) => p.playerId === decision.playerId);
  if (!actingPlayer) return;
  const commandersInZone = actingPlayer.commanders.filter((c) => c.inCommandZone);
  if (commandersInZone.length === 0) return; // Nothing commander-shaped pending right now — no signal to capture.

  // eslint-disable-next-line no-console -- opt-in developer diagnostic, never fires unless explicitly enabled.
  console.debug("[commander-cast-diagnostics]", JSON.stringify({
    turn: decision.context.turn,
    phase: decision.context.phase,
    activePlayerId: decision.context.activePlayerId,
    priorityPlayerId: decision.context.priorityPlayerId,
    stackSize: decision.context.stackSize,
    actingPlayerId: actingPlayer.playerId,
    life: actingPlayer.life,
    commanders: commandersInZone.map((c) => ({
      name: c.name,
      cardRef: c.cardRef,
      castsFromCommand: c.castsFromCommand,
      commanderTaxGeneric: c.commanderTaxGeneric,
    })),
    offeredActions: decision.actions.map((a) => ({
      type: a.type,
      label: a.label,
      cardName: a.cardName,
      cardRef: a.cardRef,
      manaCost: a.manaCost,
      sourceZone: a.sourceZone,
    })),
  }));
}
