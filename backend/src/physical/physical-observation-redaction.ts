import type { AgentCardObservation, AgentObservation, AgentSelfPlayerObservation, ForgePendingPhysicalIdentityDecision } from "../forge/forge-protocol.js";

/**
 * V2g.2 "PHYSICAL DRAW PRESENTATION BUG": which of the physical seat's own zones an `eventKind` can
 * silently grow, mapped to the exact `AgentSelfPlayerObservation` field it lands in — see
 * docs/physical-companion-v0.md §2/§6. `scry_reveal`/`surveil_reveal` never move a zone at all (the
 * peeked cards stay in the library, only reordered), and `library_event` is a generic, untested
 * fallback whose target zone is not knowable in advance (see `describePhysicalDeclare`,
 * human-decision-render.ts) — neither is redacted here; see `redactPendingPhysicalIdentity`'s own
 * doc comment for why an unhandled `eventKind` is a safe no-op, never a guess.
 */
const EVENT_ZONE: Partial<Record<ForgePendingPhysicalIdentityDecision["eventKind"], "hand" | "battlefield" | "graveyard" | "exile" | "command">> = {
  draw: "hand",
  mill: "graveyard",
  exile_from_library: "exile",
  library_to_battlefield: "battlefield",
  library_to_command: "command",
};

type SelfZoneKey = NonNullable<(typeof EVENT_ZONE)[keyof typeof EVENT_ZONE]>;

/**
 * The exact same "concealed" shape `card-view.ts#createTableCard`/`human-decision-render.ts#describeCard`
 * already treat as a plain, nameless card back (`card.hidden || card.faceDown` -> "Face-down card",
 * no image, no caption, no P/T) — every other identifying field is stripped too so nothing pins the
 * real card behind the placeholder (a tooltip built from `typeLine`, stats shown despite the blank
 * face, ...).
 */
function concealCard(card: AgentCardObservation): AgentCardObservation {
  return {
    ...card,
    name: null, hidden: true, typeLine: null, power: null, toughness: null, counters: null,
    combatKeywords: null, selfAttackTriggers: null, token: false, ringBearer: false,
  };
}

function withZone(player: AgentSelfPlayerObservation, zoneKey: SelfZoneKey, map: (cards: AgentCardObservation[]) => AgentCardObservation[]): AgentSelfPlayerObservation {
  switch (zoneKey) {
    case "hand": return { ...player, hand: map(player.hand) };
    case "battlefield": return { ...player, battlefield: map(player.battlefield) };
    case "graveyard": return { ...player, graveyard: map(player.graveyard) };
    case "exile": return { ...player, exile: map(player.exile) };
    case "command": return { ...player, command: map(player.command) };
  }
}

/**
 * Forge silently placed `eventKind`'s cards into one of the physical seat's own zones using its own
 * internally-shuffled library order (docs/physical-companion-v0.md §2) — but the `AgentObservation`
 * built for the STILL-PENDING `physical_identity_declare` decision necessarily reflects that
 * pre-declaration state: reconciliation (`PhysicalIdentityCoordinator.reconcile`) only ever runs once
 * the human's declaration is actually submitted, never before. Left as-is, the frontend would render
 * Forge's own provisional — and, for the physical human, meaningless, since it is not the real
 * shuffle order — card identity as if it were the human's actual drawn card: fully named, fully
 * imaged, inspectable, before they have declared anything at all.
 *
 * This never touches Magic state — it is a presentation-layer redaction of the copy handed to the
 * browser for THIS decision, built fresh every call; Forge's own game/session state, and the
 * observation object this function is given, are never mutated. Every entry in the target zone
 * (`EVENT_ZONE[eventKind]`) not already present in `lastReconciledObservation` (the human's own last
 * genuinely-settled observation, from strictly before this event — see
 * `playtest-session-manager.ts`'s `lastReconciledObservation`, which deliberately never advances
 * across a still-unanswered physical decision, so it can never itself be a tainted baseline) is
 * concealed exactly like any other hidden/face-down card. In ordinary operation this is always
 * exactly the `count` cards Forge just placed — the diff is keyed on `cardRef`, never position, since
 * these are unordered zones (docs §2.1) — but nothing here assumes that count; a missing/stale
 * baseline (e.g. the very first physical decision of the match, before any zone has ever been
 * observed) only ever conceals MORE, never less, so this can under-reveal but never leak a real,
 * undeclared identity.
 */
export function redactPendingPhysicalIdentity(
  observation: AgentObservation,
  eventKind: ForgePendingPhysicalIdentityDecision["eventKind"],
  lastReconciledObservation: AgentObservation | null,
): AgentObservation {
  const zoneKey = EVENT_ZONE[eventKind];
  if (!zoneKey) return observation;
  return {
    ...observation,
    players: observation.players.map((player) => {
      if (player.role !== "self") return player;
      const lastSelf = lastReconciledObservation?.players.find(p => p.playerId === player.playerId && p.role === "self") as AgentSelfPlayerObservation | undefined;
      const knownRefs = new Set((lastSelf ? withZoneCards(lastSelf, zoneKey) : []).map(c => c.cardRef));
      return withZone(player, zoneKey, cards => cards.map(card => knownRefs.has(card.cardRef) ? card : concealCard(card)));
    }),
  };
}

function withZoneCards(player: AgentSelfPlayerObservation, zoneKey: SelfZoneKey): AgentCardObservation[] {
  switch (zoneKey) {
    case "hand": return player.hand;
    case "battlefield": return player.battlefield;
    case "graveyard": return player.graveyard;
    case "exile": return player.exile;
    case "command": return player.command;
  }
}
