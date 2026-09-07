/**
 * V2g "Physical Companion": the architectural seam between "which play mode is this" and "how does
 * a seat look" — every rendering module branches on `emphasis` exactly once (via this function's
 * output), never scattered `if (physical) hide X` checks. Digital mode is untouched: both seats stay
 * "primary", the same symmetric Obsidian Table as before V2g. Physical mode makes the human's own
 * seat a compact mirror (they have real cards, they don't need a full clickable half) and lets
 * Asphodel's board dominate the screen, per spec's non-negotiable requirement.
 */
export type SeatEmphasis = "primary" | "secondary" | "compact";

export interface TableSeatPresentation {
  playerId: string;
  role: "human" | "agent";
  emphasis: SeatEmphasis;
}

/** Pure. `humanPlayerId`/`agentPlayerId` are carried through verbatim (never derived/guessed) so a caller can key DOM/state off the exact Forge id regardless of which physical seat renders it. */
export function computeSeatPresentations(
  playMode: "digital" | "physical",
  humanPlayerId: string,
  agentPlayerId: string,
): { human: TableSeatPresentation; opponent: TableSeatPresentation } {
  const humanEmphasis: SeatEmphasis = playMode === "physical" ? "compact" : "primary";
  return {
    human: { playerId: humanPlayerId, role: "human", emphasis: humanEmphasis },
    opponent: { playerId: agentPlayerId, role: "agent", emphasis: "primary" },
  };
}
