import type {
  AgentCardObservation,
  AgentObservation,
  AgentOpponentPlayerObservation,
  AgentPlayerObservation,
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
 * Redacts an Asphodel-perspective `AgentObservation` (self = whichever Asphodel seat is currently
 * deciding, whose OWN hand is fully visible to itself — genuinely secret information) into a
 * human-safe one, for ANY number of players — one human seat plus one or more Asphodel seats.
 *
 * This never re-derives anything Forge did not already report: every public zone
 * (battlefield/graveyard/exile/command/commanders/life) is identical from any player's own
 * perspective — Forge already computed it once — so this function only ever relabels roles and
 * drops the one field that must never reach the browser (the currently-deciding Asphodel seat's
 * `hand` — every OTHER Asphodel seat already arrives as `role: "opponent"`, which structurally has
 * no `hand` field, nothing to drop). The human's own hand is not present in an agent-self
 * observation at all (`AgentOpponentPlayerObservation` has no `hand` field, structurally) so it is
 * restored from `lastKnownHumanHand`, a copy that only ever came from a real, already-isolated
 * human-perspective observation (see `PlaytestSessionManager`'s `lastHumanHand` cache) — never
 * fabricated, never Asphodel's.
 */
export function sanitizeAgentObservation(
  agentObservation: AgentObservation,
  humanPlayerId: string,
  lastKnownHumanHand: AgentCardObservation[],
): HumanSafePublicBoardObservation {
  const humanPublic = agentObservation.players.find(p => p.playerId === humanPlayerId);
  if (!humanPublic) throw new Error("sanitize_agent_observation_missing_players");
  const players: AgentPlayerObservation[] = agentObservation.players.map((player): AgentPlayerObservation => {
    if (player.playerId === humanPlayerId) {
      const sanitizedHuman: AgentSelfPlayerObservation = { ...humanPublic, role: "self", hand: lastKnownHumanHand };
      return sanitizedHuman;
    }
    if (player.role === "self") {
      // The currently-deciding Asphodel seat — drop its hand (and "self" role); every other field
      // is a public zone. Any OTHER Asphodel seat is already `role: "opponent"` and passes through
      // unchanged below (structurally no hand to drop).
      const { hand: _agentHand, role: _agentRole, ...agentPublicFields } = player as AgentSelfPlayerObservation;
      const sanitizedAgent: AgentOpponentPlayerObservation = { ...agentPublicFields, role: "opponent" };
      return sanitizedAgent;
    }
    return player;
  });
  return {
    gameRef: agentObservation.gameRef,
    game: agentObservation.game,
    stack: agentObservation.stack,
    selfPlayerId: humanPlayerId,
    players,
  };
}
