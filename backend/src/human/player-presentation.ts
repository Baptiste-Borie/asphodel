import type { AgentObservation } from "../forge/forge-protocol.js";

export interface PlayerPresentation {
  displayName: string;
  life: number | null;
  role: "self" | "opponent";
}

/**
 * A human-readable presentation for `playerId`, derived ONLY from the CURRENT `AgentObservation` —
 * never from a raw Forge/engine identifier such as the real registered player name
 * ("External Player 1"/"External Player 2", set once at match start purely so Forge has something
 * to call an external seat — see `ExternalMatchSession`). Returns `null` only when `playerId` isn't
 * one of `observation.players` at all — a genuine last-resort case the caller must still handle,
 * never assumed away.
 *
 * N-player-ready (V2f.1 §9): opponents are distinguished by their stable POSITION among the other
 * (non-self) players in `observation.players` — never by comparing `playerId` against a hardcoded
 * "player-1"/"player-2". Today's 1v1 has exactly one opponent, so it reads simply as "Asphodel"; a
 * future multiplayer match with several would read "Asphodel A"/"Asphodel B"/... automatically,
 * with no special-casing required at any call site.
 */
export function resolvePlayerPresentation(playerId: string, observation: AgentObservation): PlayerPresentation | null {
  const player = observation.players.find((p) => p.playerId === playerId);
  if (!player) return null;
  if (player.role === "self") return { displayName: "You", life: player.life, role: "self" };
  const opponents = observation.players.filter((p) => p.role !== "self");
  const index = opponents.findIndex((p) => p.playerId === playerId);
  const suffix = opponents.length > 1 && index >= 0 ? ` ${String.fromCharCode(65 + index)}` : "";
  return { displayName: `Asphodel${suffix}`, life: player.life, role: "opponent" };
}
