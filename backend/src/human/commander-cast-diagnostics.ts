import type { AgentObservation, ForgePendingExternalDecision } from "../forge/forge-protocol.js";

/**
 * V2h "K'RRIK REAL-MATCH ISSUE" / V2h.2 follow-up: a real Physical Companion game reported
 * "Cast K'rrik..." missing from the action dock despite (by the player's own account) affordable
 * mana and life, and zero commander tax. A dedicated regression (`KrrikPhyrexianCastLegalityTest.java`)
 * proves the isolated Forge legal-action path is correct for exactly that scenario (4 generic mana +
 * 6 life for the Phyrexian symbols) — this exists for the case that could NOT be reproduced in
 * isolation: the discrepancy may be in real-match state a synthetic fixture doesn't represent (an
 * extra land tapped for a different color, priority not genuinely with the human yet, stack
 * non-empty, a second commander's tax interacting, …).
 *
 * V2h.2: the first real follow-up report ("2-1") that reproduced this again turned out to carry NO
 * usable forensic data at all — the match had been ended by the human before Asphodel ever received
 * a single decision, and `DecisionRecorder`/`playtest-report.ts` only ever persist Asphodel's OWN
 * decisions (spec: never the human's — see `playtest-report.ts`'s doc comments), so the human's own
 * offered `priority_action` actions for that exact turn were never written anywhere, live-console
 * `ASPHODEL_DEBUG_COMMANDER_CAST=1` diagnostic or not. `buildCommanderCastSnapshot` is the pure,
 * always-cheap core extracted so `playtest-session-manager.ts` can now ALSO feed it into the
 * persisted report unconditionally (no env var, no console) — see `RecordedCommanderCastSnapshot` in
 * playtest-report.ts — so the NEXT real occurrence leaves an actual, reviewable trail instead of
 * requiring the toggle to have been remembered in advance.
 */
export interface CommanderCastSnapshot {
  turn: number;
  phase: string;
  activePlayerId: string;
  priorityPlayerId: string;
  stackSize: number;
  actingPlayerId: string;
  life: number;
  commanders: {
    name: string;
    cardRef: string;
    castsFromCommand: number;
    commanderTaxGeneric: number | undefined;
    /** True iff some offered action's `cardRef` is this exact commander — i.e. Forge itself is
     *  currently offering to cast it. False is the interesting case to investigate. */
    castOffered: boolean;
  }[];
  offeredActions: {
    type: string;
    label: string;
    cardName: string | null;
    cardRef: string | null;
    manaCost: string | null;
    sourceZone: string | null;
  }[];
}

/**
 * Pure. `null` when nothing commander-shaped is currently pending for the acting player (nothing to
 * capture — never a signal either way). Never itself decides anything or alters a decision; a
 * read-only mirror of exactly the fields needed to investigate "why was Cast <commander> absent".
 */
export function buildCommanderCastSnapshot(
  observation: AgentObservation,
  decision: Extract<ForgePendingExternalDecision, { type: "priority_action" }>,
): CommanderCastSnapshot | null {
  const actingPlayer = observation.players.find((p) => p.playerId === decision.playerId);
  if (!actingPlayer) return null;
  const commandersInZone = actingPlayer.commanders.filter((c) => c.inCommandZone);
  if (commandersInZone.length === 0) return null;

  const offeredActions = decision.actions.map((a) => ({
    type: a.type, label: a.label, cardName: a.cardName, cardRef: a.cardRef, manaCost: a.manaCost, sourceZone: a.sourceZone,
  }));
  return {
    turn: decision.context.turn,
    phase: decision.context.phase,
    activePlayerId: decision.context.activePlayerId,
    priorityPlayerId: decision.context.priorityPlayerId,
    stackSize: decision.context.stackSize,
    actingPlayerId: actingPlayer.playerId,
    life: actingPlayer.life,
    commanders: commandersInZone.map((c) => ({
      name: c.name, cardRef: c.cardRef, castsFromCommand: c.castsFromCommand, commanderTaxGeneric: c.commanderTaxGeneric,
      castOffered: offeredActions.some((a) => a.cardRef === c.cardRef),
    })),
    offeredActions,
  };
}

/**
 * Opt-in interactive console mirror (`ASPHODEL_DEBUG_COMMANDER_CAST=1`) — never fires otherwise, so
 * normal/production play produces zero extra console output. `playtest-session-manager.ts`'s
 * unconditional, PERSISTED capture (see this file's own doc comment) is the reliable path now;
 * this remains only for a developer actively watching a live session.
 */
export function logCommanderCastDiagnostics(
  observation: AgentObservation,
  decision: Extract<ForgePendingExternalDecision, { type: "priority_action" }>,
): void {
  // Read at call time (never cached at module-load time) — this is the ONLY branch that decides
  // whether anything is emitted, so a toggle always takes effect immediately.
  if (process.env.ASPHODEL_DEBUG_COMMANDER_CAST !== "1") return;
  const snapshot = buildCommanderCastSnapshot(observation, decision);
  if (!snapshot) return;
  // eslint-disable-next-line no-console -- opt-in developer diagnostic, never fires unless explicitly enabled.
  console.debug("[commander-cast-diagnostics]", JSON.stringify(snapshot));
}
