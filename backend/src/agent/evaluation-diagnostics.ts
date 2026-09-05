import { createHash } from "node:crypto";
import type { AgentObservation, ForgePendingExternalDecision as Decision } from "../forge/forge-protocol.js";
import type { AgentChoice } from "./baseline-agent.js";

/** Counters refer to observed decision opportunities, not hypothetical legal states between polls. */
export class EvaluationDiagnostics {
  selfPlayerId = "";
  readonly stateSamples: { turn: number; phase: string; hand: number; battlefield: number; untappedLands: number }[] = [];
  readonly combatSamples: { turn: number; phase: string; choice: AgentChoice; decision: Decision; observation: AgentObservation }[] = [];
  readonly passTurns = new Set<number>();
  readonly castTurns = new Set<number>();
  readonly attackWindows = new Map<string, { offered: Set<string>; taken: Set<string> }>();
  legalCastDecisions = 0;
  commanderOffered = 0;
  commanderNotCast = 0;
  passesWithAction = 0;
  private readonly sampled = new Set<string>();
  private window = 0;
  private windowKey: string | undefined;
  private readonly hash = createHash("sha256");
  constructor(private readonly keepCombatSamples = false) {}

  record(o: AgentObservation, d: Decision, choice: AgentChoice) {
    this.selfPlayerId = o.selfPlayerId;
    const self = o.players.find(p => p.playerId === o.selfPlayerId);
    const cards = o.players.flatMap(p => [...p.battlefield, ...p.graveyard, ...p.exile, ...p.command,
      ...(p.role === "self" ? p.hand : [])]);
    const cardLabel = (ref: string | null) => cards.find(c => c.cardRef === ref)?.name ?? (ref === o.selfPlayerId ? "self" : o.players.some(p => p.playerId === ref) ? "opponent" : null);
    let semanticChoice: unknown = choice.kind === "value" ? choice.choice : choice.reason;
    if (d.type === "priority_action") {
      const chosen = d.actions.find(a => a.actionId === choice.choice);
      semanticChoice = chosen ? [chosen.type, chosen.cardName, chosen.abilityText] : choice.reason;
      if (d.actions.some(a => a.type === "cast_spell")) { this.legalCastDecisions++; this.castTurns.add(d.context.turn); }
      const commanders = new Set(self?.commanders.map(c => c.cardRef));
      const offered = d.actions.filter(a => a.type === "cast_spell" && commanders.has(a.cardRef!));
      if (offered.length) {
        this.commanderOffered++;
        if (!offered.some(a => a.actionId === choice.choice)) this.commanderNotCast++;
      }
      if (chosen?.type === "pass" && d.actions.some(a => a.type !== "pass")) { this.passesWithAction++; this.passTurns.add(d.context.turn); }
    }
    if (d.type === "attackers_selection") {
      if (this.windowKey === undefined) this.windowKey = `${d.context.turn}:${++this.window}`;
      let window = this.attackWindows.get(this.windowKey);
      if (!window) { window = { offered: new Set(), taken: new Set() }; this.attackWindows.set(this.windowKey, window); }
      for (const option of d.options) if (option.operation === "add" && option.cardRef) window.offered.add(option.cardRef);
      const selected = d.options.find(x => x.objectId === choice.choice);
      if (selected?.operation === "add" && selected.cardRef) window.taken.add(selected.cardRef);
      if (selected?.operation === "remove" && selected.cardRef) window.taken.delete(selected.cardRef);
      if (selected?.operation === "finish") this.windowKey = undefined;
    }
    if (d.type === "attackers_selection" || d.type === "blockers_selection" || d.type === "combat_order_selection") {
      const selected = d.options.find(x => x.objectId === choice.choice);
      semanticChoice = selected ? [selected.operation, cardLabel(selected.cardRef), cardLabel(selected.relatedRef)] : choice.reason;
      if (this.keepCombatSamples && this.combatSamples.length < 150) this.combatSamples.push(structuredClone({ turn: d.context.turn, phase: d.context.phase, choice, decision: d, observation: o }));
    }
    // A compact semantic checksum, not proof of full state equality (duplicate names can coincide).
    this.hash.update(JSON.stringify([d.context.turn, d.context.phase, d.type, choice.reason, semanticChoice]) + "\n");
    const sampleKey = `${d.context.turn}:${d.context.phase}`;
    if (self && !this.sampled.has(sampleKey)) {
      this.sampled.add(sampleKey);
      this.stateSamples.push({ turn: d.context.turn, phase: d.context.phase, hand: self.handSize,
        battlefield: self.battlefieldSize, untappedLands: self.battlefield.filter(c => !c.tapped && /Land/i.test(c.typeLine ?? "")).length });
    }
  }
  result() {
    const windows = [...this.attackWindows.values()];
    const attackOpportunities = windows.reduce((n, w) => n + w.offered.size, 0);
    const attacksTaken = windows.reduce((n, w) => n + w.taken.size, 0);
    return { legalCastDecisions: this.legalCastDecisions, legalCastTurns: [...this.castTurns], passesWithAction: this.passesWithAction,
      turnsPassedWithAction: [...this.passTurns], commanderOffered: this.commanderOffered, commanderNotCast: this.commanderNotCast,
      attackOpportunities, attacksTaken, attackConversionRate: attackOpportunities ? attacksTaken / attackOpportunities : null,
      stateSamples: this.stateSamples, combatSamples: this.combatSamples, semanticTraceHash: this.hash.copy().digest("hex") };
  }
}
