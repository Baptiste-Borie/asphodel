import type {
  AgentCardObservation,
  AgentObservation,
  AgentPlayerObservation,
  ForgeExternalMatchProgress,
  ForgeGameResult,
  ForgePendingExternalDecision,
} from "../forge/forge-protocol.js";
import type { AgentChoice } from "../agent/baseline-agent.js";
import type { EvaluationDiagnostics } from "../agent/evaluation-diagnostics.js";

/** One selectable line in a rendered decision. `choice` is a complete, already-legal answer. */
export interface MenuItem {
  /** Presentation hint for an explicit Forge cancellation choice. */
  control?: "cancel";
  label: string;
  choice: AgentChoice;
  /**
   * The Forge cardRef this specific action refers to, taken verbatim from Forge's own decision
   * data (`ForgeExternalAction.cardRef`, a target's/option's `cardRef`, a mana option's
   * `sourceCardRef`, …) — populated for `priority_action` (V2e.4), every other card-object decision
   * family (V2e.5: `target_selection`, `cost_object_selection`, `attackers_selection`,
   * `blockers_selection`, `combat_order_selection`, `yes_no`/`object_selection`/`ordering_selection`),
   * and `mana_payment` (V2e.5.1) so the tabletop can make a battlefield card itself submit the
   * choice, not just a dock button. `null` for an action with no associated card ("Pass priority",
   * "Finish", floating mana); `undefined` only for decision families that never had a per-item card
   * at all (`mode_selection`, `value_selection`, `optional_cost_selection`). Never a name — a stable
   * id, so two physically
   * distinct cards sharing a name (two Mountains) are never conflated.
   */
  cardRef?: string | null;
}

/** A decision the human must answer: either a numbered menu, or a bounded numeric value. */
export type DecisionPrompt =
  | { kind: "menu"; title: string; items: MenuItem[] }
  | { kind: "value"; title: string; decisionId: string; min: number; max: number; suggested: number[] };

function cardMap(observation: AgentObservation): Map<string, AgentCardObservation> {
  const map = new Map<string, AgentCardObservation>();
  for (const player of observation.players) {
    const zones = [player.battlefield, player.graveyard, player.exile, player.command,
      ...(player.role === "self" ? [player.hand] : [])];
    for (const zone of zones) for (const card of zone) map.set(card.cardRef, card);
  }
  return map;
}

function playerName(observation: AgentObservation, playerId: string | null): string | null {
  if (playerId === null) return null;
  return observation.players.find(p => p.playerId === playerId)?.name ?? playerId;
}

/** Card display: name, type, P/T, tapped/counters/commander marker — never a hidden identity. */
export function describeCard(card: AgentCardObservation | undefined, cardRef: string | null): string {
  if (!card) return cardRef ?? "unknown";
  if (card.hidden || card.name === null) return card.faceDown ? "face-down card" : "hidden card";
  const parts = [card.name];
  const stats = card.power !== null && card.toughness !== null ? `${card.power}/${card.toughness}` : null;
  const tags = [
    stats,
    card.tapped ? "tapped" : null,
    card.summoningSick ? "summoning sick" : null,
    card.counters && Object.keys(card.counters).length
      ? Object.entries(card.counters).map(([type, n]) => `${n} ${type}`).join(", ")
      : null,
  ].filter((tag): tag is string => tag !== null);
  if (tags.length) parts.push(`(${tags.join(", ")})`);
  return parts.join(" ");
}

function describeCardRef(observation: AgentObservation, ref: string | null): string {
  if (ref === null) return "";
  const byPlayer = observation.players.find(p => p.playerId === ref);
  if (byPlayer) return byPlayer.name;
  return describeCard(cardMap(observation).get(ref), ref);
}

/** Board header: turn/phase/priority and both life totals. Never dumps raw JSON by default. */
export function renderHeader(observation: AgentObservation): string[] {
  const self = observation.players.find(p => p.playerId === observation.selfPlayerId);
  const opponent = observation.players.find(p => p.playerId !== observation.selfPlayerId);
  const priority = observation.game.priorityPlayerId === observation.selfPlayerId ? "You"
    : observation.game.priorityPlayerId === opponent?.playerId ? opponent.name : observation.game.priorityPlayerId;
  return [
    `Turn ${observation.game.turn} — ${formatPhase(observation.game.phase)}`,
    `Priority: ${priority}`,
    `Life: You ${self?.life ?? "?"} / ${opponent?.name ?? "Opponent"} ${opponent?.life ?? "?"}`,
  ];
}

export function formatPhase(phase: string): string {
  return phase.split("_").map(word => word[0]!.toUpperCase() + word.slice(1)).join(" ");
}

function renderZone(cards: AgentCardObservation[], label: string): string[] {
  if (!cards.length) return [`${label}: (empty)`];
  return [`${label}:`, ...cards.map((card, i) => `  ${i + 1}. ${describeCard(card, card.cardRef)}`)];
}

/** Full board view for a self-paced human read (not shown before every single decision). */
export function renderBoard(observation: AgentObservation): string[] {
  const self = observation.players.find(p => p.playerId === observation.selfPlayerId);
  const opponent = observation.players.find(p => p.playerId !== observation.selfPlayerId);
  const lines: string[] = [];
  if (self?.role === "self") lines.push(...renderZone(self.hand, "Your hand"));
  if (self) lines.push(...renderZone(self.battlefield, "Your battlefield"));
  if (opponent) lines.push(...renderZone(opponent.battlefield, `${opponent.name}'s battlefield`));
  if (observation.stack.length) {
    lines.push("Stack:", ...observation.stack.map(item =>
      `  ${item.position + 1}. ${item.hidden || item.sourceCardName === null ? "hidden spell/ability" : item.description ?? item.sourceCardName}`));
  } else lines.push("Stack: (empty)");
  return lines;
}

/** Builds the numbered menu (or numeric prompt) for one pending decision. Every item is already a complete, legal AgentChoice — no free-text/arbitrary input is ever possible. */
export function describeDecision(observation: AgentObservation, d: ForgePendingExternalDecision): DecisionPrompt {
  const reason = "human_choice";
  switch (d.type) {
    case "priority_action": {
      const items = d.actions.map((a): MenuItem => {
        if (a.type === "pass") return { label: "Pass priority", choice: { decisionId: d.decisionId, kind: "action", choice: a.actionId, reason }, cardRef: null };
        const cost = a.manaCost ? ` [${a.manaCost}]` : "";
        const verb = a.type === "play_land" ? "Play" : a.type === "cast_spell" ? "Cast" : "Activate";
        return { label: `${verb} ${a.cardName}${cost}`, choice: { decisionId: d.decisionId, kind: "action", choice: a.actionId, reason }, cardRef: a.cardRef };
      });
      return { kind: "menu", title: "Choose an action", items };
    }
    case "target_selection": {
      const items = d.targets.map((t): MenuItem => ({
        label: `Target ${t.type === "player" ? t.name : describeCard(cardMap(observation).get(t.cardRef ?? ""), t.cardRef)}`,
        choice: { decisionId: d.decisionId, kind: "target", choice: t.targetId, reason },
        cardRef: t.type === "card" ? t.cardRef : null,
      }));
      if (d.canFinish && d.finishTargetId) items.push({ label: "Finish selecting targets", choice: { decisionId: d.decisionId, kind: "target", choice: d.finishTargetId, reason } });
      return { kind: "menu", title: d.prompt || "Choose a target", items };
    }
    case "mode_selection": {
      const items = d.modes.map((m): MenuItem => ({ label: m.description ?? m.label, choice: { decisionId: d.decisionId, kind: "mode", choice: m.modeId, reason } }));
      if (d.canFinish && d.finishModeId) items.push({ label: "Finish choosing modes", choice: { decisionId: d.decisionId, kind: "mode", choice: d.finishModeId, reason } });
      return { kind: "menu", title: d.prompt ?? "Choose a mode", items };
    }
    case "value_selection":
      return { kind: "value", title: d.prompt ?? `Choose a value (${d.valueKind})`, decisionId: d.decisionId, min: d.minValue, max: d.maxValue, suggested: d.suggestedValues };
    case "optional_cost_selection": {
      const items = d.costs.map((c): MenuItem => ({ label: `${c.label} (${c.costText})`, choice: { decisionId: d.decisionId, kind: "optional_cost", choice: c.costId, reason } }));
      items.push({ label: "Decline", choice: { decisionId: d.decisionId, kind: "optional_cost", choice: d.declineCostId, reason } });
      return { kind: "menu", title: d.prompt ?? "Choose an optional cost", items };
    }
    case "cost_object_selection": {
      const items = d.options.map((o): MenuItem => ({ label: describeCard(cardMap(observation).get(o.cardRef), o.cardRef), choice: { decisionId: d.decisionId, kind: "object", choice: o.objectId, reason }, cardRef: o.cardRef }));
      if (d.canFinish && d.finishChoiceId) items.push(finishItem(d.decisionId, d.finishChoiceId, "object"));
      return { kind: "menu", title: d.prompt ?? "Choose a cost object", items };
    }
    case "mana_payment": {
      const items = d.options.map((o): MenuItem => {
        const source = o.type === "spend_floating_mana" ? `Floating ${o.color} mana` : `${o.sourceCardName ?? o.sourceCardRef} (produces ${o.produces.join("/")})`;
        // V2e.5.1: sourceCardRef (never the name) identifies the exact underlying permanent — two
        // same-named lands (two Mountains) always keep distinct cardRefs here, so the tabletop can
        // render each as its own clickable card. Floating mana has no physical source: `null`.
        return { label: source, choice: { decisionId: d.decisionId, kind: "mana", choice: o.manaOptionId, reason }, cardRef: o.sourceCardRef };
      });
      if (d.cancelChoiceId) items.push({ control: "cancel", label: "Cancel action", choice: { decisionId: d.decisionId, kind: "mana", choice: d.cancelChoiceId, reason }, cardRef: null });
      return { kind: "menu", title: `Pay mana: ${d.remainingCost.text || "(paid)"}`, items };
    }
    case "attackers_selection":
    case "blockers_selection": {
      const items = d.options.map((o): MenuItem => {
        const label = o.operation === "finish" ? "Finish declaring attackers/blockers"
          : `${o.operation === "add" ? "Add" : "Remove"} ${describeCardRef(observation, o.cardRef)}`
            + (d.type === "attackers_selection" ? ` attacking ${describeCardRef(observation, o.relatedRef)}` : ` blocking ${describeCardRef(observation, o.relatedRef)}`);
        return { label, choice: { decisionId: d.decisionId, kind: "object", choice: o.objectId, reason }, cardRef: o.operation === "finish" ? null : o.cardRef };
      });
      return { kind: "menu", title: d.type === "attackers_selection" ? "Declare attackers" : "Declare blockers", items };
    }
    case "combat_order_selection": {
      const items = d.options.map((o): MenuItem => ({ label: `${describeCardRef(observation, o.cardRef)}`, choice: { decisionId: d.decisionId, kind: "object", choice: o.objectId, reason }, cardRef: o.cardRef }));
      return { kind: "menu", title: "Choose combat damage order", items };
    }
    case "yes_no":
    case "object_selection":
    case "ordering_selection": {
      const items = d.options.map((o): MenuItem => ({
        label: o.finish ? "Finish selection" : o.cardRef ? describeCard(cardMap(observation).get(o.cardRef), o.cardRef) : o.label,
        choice: { decisionId: d.decisionId, kind: "object", choice: o.objectId, reason },
        cardRef: o.finish ? null : o.cardRef,
      }));
      return { kind: "menu", title: d.prompt, items };
    }
  }
}

function finishItem(decisionId: string, objectId: string, kind: "object"): MenuItem {
  return { label: "Finish", choice: { decisionId, kind, choice: objectId, reason: "human_choice" } };
}

/** Safe display-only deltas between two observations of the SAME player. No parallel rules log. */
export function renderEventDelta(previous: AgentObservation | null, next: AgentObservation): string[] {
  if (!previous) return [];
  const lines: string[] = [];
  for (const nextPlayer of next.players) {
    const prevPlayer = previous.players.find(p => p.playerId === nextPlayer.playerId);
    if (!prevPlayer) continue;
    if (prevPlayer.life !== nextPlayer.life) {
      const delta = nextPlayer.life - prevPlayer.life;
      lines.push(`${nextPlayer.name} life ${prevPlayer.life} -> ${nextPlayer.life} (${delta > 0 ? "+" : ""}${delta})`);
    }
    if (prevPlayer.battlefieldSize !== nextPlayer.battlefieldSize) {
      lines.push(`${nextPlayer.name} battlefield ${prevPlayer.battlefieldSize} -> ${nextPlayer.battlefieldSize}`);
    }
    if (nextPlayer.role === "self" && prevPlayer.role === "self" && prevPlayer.handSize !== nextPlayer.handSize) {
      lines.push(`Your hand ${prevPlayer.handSize} -> ${nextPlayer.handSize}`);
    }
  }
  if (previous.stack.length !== next.stack.length) lines.push(`Stack ${previous.stack.length} -> ${next.stack.length}`);
  return lines;
}

/** Concise, hand-free public description of an accepted Asphodel action for the human to read. */
export function describeAgentAction(observation: AgentObservation, d: ForgePendingExternalDecision, choice: AgentChoice): string | null {
  if (d.type === "priority_action") {
    const action = d.actions.find(a => a.actionId === choice.choice);
    if (!action || action.type === "pass") return null;
    const verb = action.type === "play_land" ? "plays" : action.type === "cast_spell" ? "casts" : "activates";
    return `Asphodel ${verb} ${action.cardName}`;
  }
  if (d.type === "attackers_selection") {
    const selected = d.options.find(o => o.objectId === choice.choice);
    if (selected?.operation !== "add") return null;
    return `Asphodel attacks with ${describeCardRef(observation, selected.cardRef)}`;
  }
  if (d.type === "blockers_selection") {
    const selected = d.options.find(o => o.objectId === choice.choice);
    if (selected?.operation !== "add") return null;
    return `Asphodel blocks with ${describeCardRef(observation, selected.cardRef)}`;
  }
  return null;
}

/** Final game-end summary. Reports the documented combat-damage fallback explicitly, never hides it. */
export function renderGameEnd(
  result: ForgeGameResult | null,
  progress: ForgeExternalMatchProgress | null,
  fallbacks: { family: string; method: string }[],
  humanIsWinner: boolean | null,
): string[] {
  const winner = humanIsWinner === null ? "Draw" : humanIsWinner ? "Human" : "Asphodel";
  const lines = ["", "GAME OVER", "", `Winner: ${winner}`];
  if (result) {
    lines.push(`Turns: ${result.turns}`);
    for (const player of result.players) lines.push(`${player.name}: ${player.startingLife} starting life`);
  }
  if (progress) {
    lines.push(`Spells cast: ${progress.spellsCast}`, `Lands played: ${progress.landsPlayed}`,
      `Commander/priority decisions: ${progress.decisionsSubmitted}`);
  }
  const combatDamage = fallbacks.filter(f => f.family === "combat_damage" && f.method === "assignCombatDamage").length;
  const unexpected = fallbacks.length - combatDamage;
  lines.push("", "Engine delegated decisions:", `  combat damage assignment: ${combatDamage}`);
  if (unexpected > 0) lines.push(`  other (unexpected): ${unexpected}`);
  return lines;
}

export function renderDiagnosticsSummary(diagnostics: ReturnType<EvaluationDiagnostics["result"]>): string[] {
  return [`Attack conversion: ${diagnostics.attacksTaken}/${diagnostics.attackOpportunities}`];
}

export function playerLabelFor(observation: AgentObservation, playerId: string): string {
  return playerName(observation, playerId) ?? playerId;
}
