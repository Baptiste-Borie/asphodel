import type {
  AgentCardObservation,
  AgentObservation,
  AgentOpponentPlayerObservation,
  AgentSelfPlayerObservation,
} from "../forge/forge-protocol.js";
import type { PublicGameEvent } from "./playtest-session-manager.js";

/**
 * The exact same shape as `AgentObservation`, with one extra guarantee enforced entirely by how
 * it is constructed (see `sanitizeAgentObservation` below): `selfPlayerId` is always the HUMAN,
 * and the "opponent" (Asphodel) player entry never carries a `hand` field — structurally, not
 * just by convention, since `AgentOpponentPlayerObservation` has no `hand` property at all. A
 * distinct type alias (rather than reusing `AgentObservation` silently) documents that invariant
 * at every call site that touches a `PublicGameFrame`.
 */
export type HumanSafePublicBoardObservation = AgentObservation;

/**
 * One step of Asphodel's turn the human is allowed to watch, captured after a real accepted
 * action / meaningful state transition. `event` is the same human-readable text already used for
 * the recent-actions timeline (`describeAgentAction`), or `null` for a state change with nothing
 * worth narrating (e.g. a mana ability tapping a land while paying a cost) — the frame is still
 * captured so the board visually updates, even without a log line.
 */
export interface PublicGameFrame {
  id: number;
  event: PublicGameEvent | null;
  observation: HumanSafePublicBoardObservation;
}

/**
 * Redacts an Asphodel-perspective `AgentObservation` (self = Asphodel, whose OWN hand is fully
 * visible to itself — genuinely secret information) into a human-safe one.
 *
 * This never re-derives anything Forge did not already report: every public zone
 * (battlefield/graveyard/exile/command/commanders/life) is identical from either player's own
 * perspective — Forge already computed it once — so this function only ever relabels roles and
 * drops the one field that must never reach the browser (Asphodel's `hand`). The human's own hand
 * is not present in an agent-self observation at all (`AgentOpponentPlayerObservation` has no
 * `hand` field, structurally) so it is restored from `lastKnownHumanHand`, a copy that only ever
 * came from a real, already-isolated human-perspective observation (see
 * `PlaytestSessionManager`'s `lastHumanHand` cache) — never fabricated, never Asphodel's.
 */
export function sanitizeAgentObservation(
  agentObservation: AgentObservation,
  humanPlayerId: string,
  lastKnownHumanHand: AgentCardObservation[],
): HumanSafePublicBoardObservation {
  const agentSelf = agentObservation.players.find(p => p.playerId === agentObservation.selfPlayerId);
  const humanPublic = agentObservation.players.find(p => p.playerId === humanPlayerId);
  if (!agentSelf || agentSelf.role !== "self" || !humanPublic) {
    throw new Error("sanitize_agent_observation_missing_players");
  }
  // Drop Asphodel's own hand (and its "self" role) — every other field is a public zone.
  const { hand: _agentHand, role: _agentRole, ...agentPublicFields } = agentSelf as AgentSelfPlayerObservation;
  const sanitizedAgent: AgentOpponentPlayerObservation = { ...agentPublicFields, role: "opponent" };
  const sanitizedHuman: AgentSelfPlayerObservation = { ...humanPublic, role: "self", hand: lastKnownHumanHand };
  return {
    gameRef: agentObservation.gameRef,
    game: agentObservation.game,
    stack: agentObservation.stack,
    selfPlayerId: humanPlayerId,
    players: [sanitizedHuman, sanitizedAgent],
  };
}
