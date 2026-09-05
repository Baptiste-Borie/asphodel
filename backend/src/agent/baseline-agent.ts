import type { AgentCardObservation, AgentObservation, ForgePendingExternalDecision as Decision } from "../forge/forge-protocol.js";

export type AgentChoice = { decisionId: string; reason: string } & (
  | { kind: "action" | "target" | "mode" | "optional_cost" | "object" | "mana"; choice: string }
  | { kind: "value"; choice: number }
);
export interface AsphodelAgent {
  choose(observation: AgentObservation, decision: Decision): AgentChoice;
}

/** Equal scores retain the supplied option order. Never sort/mutate the input. */
function best<T>(options: readonly T[], score: (option: T) => number): T {
  if (!options.length) throw new Error("agent_no_legal_options");
  return options.reduce((a, b) => score(b) > score(a) ? b : a);
}
function context(observation: AgentObservation) {
  const cards = new Map<string, AgentCardObservation>();
  const commanders = new Set<string>();
  for (const player of observation.players) {
    for (const card of [...player.battlefield, ...player.graveyard, ...player.exile, ...player.command,
      ...(player.role === "self" && player.playerId === observation.selfPlayerId ? player.hand : [])]) {
      cards.set(card.cardRef, card);
    }
    for (const commander of player.commanders) commanders.add(commander.cardRef);
  }
  const card = (ref: string | null) => ref === null ? undefined : cards.get(ref);
  // Only sanitized DTO characteristics. No names, Oracle database, or hidden zone lookup.
  const value = (ref: string | null) => {
    const c = card(ref);
    return (ref !== null && commanders.has(ref) ? 1000 : 0) + (c ?
      Math.max(0, c.power ?? 0) * 2 + Math.max(0, c.toughness ?? 0)
      + (/Creature/i.test(c.typeLine ?? "") ? 4 : /Land/i.test(c.typeLine ?? "") ? 2 : 3)
      - (c.tapped ? 0.25 : 0) : 0);
  };
  const self = observation.players.find(p => p.playerId === observation.selfPlayerId);
  const foes = observation.players.filter(p => p.playerId !== observation.selfPlayerId);
  const enemyCreatures = foes.flatMap(p => p.battlefield).filter(c => /Creature/i.test(c.typeLine ?? ""));
  const pressure = (self?.life ?? 40) <= 10 || enemyCreatures.filter(c => !c.tapped)
    .reduce((n, c) => n + Math.max(0, c.power ?? 0), 0) >= (self?.life ?? 40);
  return { card, value, self, foes, enemyCreatures, pressure, commanders };
}
function effect(text: string): "damage" | "removal" | "benefit" | "unknown" {
  if (/\bdeal\w*\b.*\bdamage\b/i.test(text)) return "damage";
  if (/\b(destroy|exile) target\b/i.test(text)) return "removal";
  if (/\b(draw|gain|create)\b|\+\d+\/\+\d+|put.*counter/i.test(text)) return "benefit";
  return "unknown";
}

/** V0: pure, deterministic, shallow heuristics over the external-controller DTOs. */
export class BaselineAsphodelAgent implements AsphodelAgent {
  choose(observation: AgentObservation, d: Decision): AgentChoice {
    if (d.playerId !== observation.selfPlayerId) throw new Error("agent_player_mismatch");
    const c = context(observation);
    const pick = (kind: Exclude<AgentChoice["kind"], "value">, choice: string, reason: string): AgentChoice =>
      ({ decisionId: d.decisionId, kind, choice, reason });
    switch (d.type) {
      case "priority_action": {
        const scored = d.actions.map(a => {
          const type = c.card(a.cardRef)?.typeLine ?? "";
          if (a.type === "play_land") return { a, score: 70, reason: "play_land_before_spells" };
          if (a.type === "cast_spell") {
            if (a.sourceZone === "command" && c.commanders.has(a.cardRef)) return { a, score: 60, reason: "cast_commander" };
            if (/Creature/i.test(type)) return { a, score: 50, reason: "cast_creature" };
            if (/Artifact|Enchantment|Planeswalker|Battle/i.test(type)) return { a, score: 40, reason: "cast_permanent" };
            return { a, score: 20, reason: "cast_other_spell" };
          }
          if (a.type === "activate_ability" && effect(a.abilityText ?? "") !== "unknown") {
            return { a, score: 30, reason: "activate_useful_ability" };
          }
          return { a, score: a.type === "pass" ? 10 : 0, reason: a.type === "pass" ? "pass_priority" : "first_legal_action" };
        });
        const result = best(scored, a => a.score);
        return pick("action", result.a.actionId, result.reason);
      }
      case "target_selection": {
        if (d.canFinish && d.finishTargetId !== null && d.selectedTargetIds.length >= d.minTargets)
          return pick("target", d.finishTargetId, "finish_sufficient_targets");
        const intent = effect(d.source.abilityText ?? "");
        const target = best(d.targets, t => {
          const friendly = t.controllerId === observation.selfPlayerId;
          const hostile = t.controllerId !== null && !friendly;
          if (intent === "damage") return hostile ? t.type === "player" ? 30 : 20 : 0;
          if (intent === "removal") return hostile ? t.type === "card" ? 30 : 20 : 0;
          if (intent === "benefit") return friendly ? 30 : 0;
          return 0;
        });
        return pick("target", target.targetId, intent === "unknown" ? "first_legal_target" : `target_${intent}`);
      }
      case "mode_selection": {
        if (d.canFinish && d.finishModeId !== null && d.selectedModeIds.length >= d.minModes)
          return pick("mode", d.finishModeId, "finish_sufficient_modes");
        const mode = best(d.modes, m => {
          const text = m.description ?? m.label;
          return /\bdraw\b/i.test(text) ? 6 : /\bcreate\b.*\btoken/i.test(text) ? 5
            : /\bdamage\b/i.test(text) ? 4 : /\bdestroy|\bexile/i.test(text) ? 3
            : /\bcounter/i.test(text) ? 2 : /\bgain.*life/i.test(text) ? 1 : 0;
        });
        return pick("mode", mode.modeId, "highest_static_mode_score");
      }
      case "value_selection":
        return { decisionId: d.decisionId, kind: "value", choice: d.valueKind === "x"
          ? Math.max(d.minValue, Math.min(1, d.maxValue)) : d.minValue, reason: d.valueKind === "x" ? "minimum_positive_legal_x" : "minimum_legal_value" };
      case "optional_cost_selection":
        return pick("optional_cost", d.declineCostId, "decline_optional_cost");
      case "cost_object_selection": {
        if (d.canFinish && d.finishChoiceId !== null) return pick("object", d.finishChoiceId, "finish_sufficient_cost_objects");
        const alternatives = d.options.filter(o => !c.commanders.has(o.cardRef));
        return pick("object", best(alternatives.length ? alternatives : d.options, o => -c.value(o.cardRef)).objectId, "lowest_visible_cost_object_score");
      }
      case "mana_payment": {
        const option = best(d.options, o => {
          const exact = o.produces.some(color => d.remainingCost.shards.includes(color));
          const waste = Math.max(0, o.produces.length - d.remainingCost.convertedManaCost);
          return (o.type === "spend_floating_mana" ? 10000 : 0) - waste * 100 + (exact ? 10 : 0) - o.produces.length;
        });
        return pick("mana", option.manaOptionId, option.type === "spend_floating_mana" ? "spend_legal_floating_mana" : "least_waste_exact_mana_source");
      }
      case "attackers_selection":
      case "blockers_selection":
      case "combat_order_selection": {
        if (d.type === "combat_order_selection") return pick("object", best(d.options, o => c.value(o.cardRef)).objectId, "stable_combat_order");
        const finish = d.options.find(o => o.operation === "finish");
        const additions = d.options.filter(o => o.operation === "add");
        const score = (o: typeof d.options[number]) => {
          const own = c.card(o.cardRef);
          if (d.type === "attackers_selection") {
            const power = own?.power ?? 0, toughness = own?.toughness ?? 0;
            const suicide = c.enemyCreatures.some(e => !e.tapped && (e.power ?? 0) >= toughness && (e.toughness ?? 0) > power);
            const heldBack = (c.self?.battlefield.filter(x => /Creature/i.test(x.typeLine ?? "") && !x.tapped).length ?? 0) - d.selected.length;
            if (suicide || power <= 0 || (c.pressure && heldBack <= c.enemyCreatures.length)) return -100;
            return (c.foes.some(p => p.playerId === o.relatedRef) ? 20 : 10) + power;
          }
          const enemy = c.card(o.relatedRef);
          // Missing characteristics do not justify a speculative sacrifice.
          if (!own || !enemy || own.power === null || own.toughness === null || enemy.power === null || enemy.toughness === null) return -100;
          const survives = own.toughness > enemy.power;
          const kills = own.power >= enemy.toughness;
          if (survives && kills) return 100 + c.value(o.relatedRef);
          if (kills && c.value(o.relatedRef) >= c.value(o.cardRef)) return 50 + c.value(o.relatedRef);
          if (c.pressure) return 20 - c.value(o.cardRef) / 100;
          return -100;
        };
        if (additions.length) {
          const option = best(additions, score);
          if (score(option) > 0) return pick("object", option.objectId, d.type === "attackers_selection" ? "attack_without_obvious_suicide" : "block_trade_or_life_pressure");
          if (!finish) return pick("object", option.objectId, "complete_required_combat_draft");
        }
        if (finish) return pick("object", finish.objectId, "finish_combat_declaration");
        // Some compound native restrictions require editing a draft. The runner bounds cycles.
        return pick("object", best(d.options, () => 0).objectId, "first_legal_combat_edit");
      }
      case "yes_no": {
        const text = `${d.prompt} ${d.source?.abilityText ?? ""}`;
        const harmful = /\b(pay|sacrifice|discard|lose)\b/i.test(text);
        const wanted = harmful ? "No" : "Yes";
        return pick("object", (d.options.find(o => o.label === wanted) ?? best(d.options, () => 0)).objectId,
          harmful ? "decline_optional_self_cost" : "accept_optional_effect");
      }
      case "object_selection":
      case "ordering_selection": {
        const finish = d.options.find(o => o.finish);
        const options = d.options.filter(o => !o.finish);
        const top = /^(scry|surveil)_top$/.test(d.selectionKind);
        if (top) {
          // Unknown revealed library cards have no characteristics in v1; keep in supplied order.
          const keep = options.filter(o => !c.card(o.cardRef) || c.value(o.cardRef) >= 3);
          if (keep.length) return pick("object", best(keep, o => c.value(o.cardRef)).objectId, "keep_visible_scry_card");
          if (finish) return pick("object", finish.objectId, "send_low_value_scry_cards");
        }
        if (options.length) {
          const legend = /legend/i.test(d.selectionKind) || /legendary/i.test(d.prompt);
          return pick("object", best(options, o => legend || d.type === "ordering_selection" ? c.value(o.cardRef) : 0).objectId,
            legend ? "keep_highest_visible_legend" : d.type === "ordering_selection" ? "stable_visible_impact_order" : "first_legal_object");
        }
        if (finish) return pick("object", finish.objectId, "finish_selection");
        throw new Error("agent_no_legal_options");
      }
    }
  }
}

/** Validate the exact pending DTO before any transport call. Forge remains the rules authority. */
export function validateChoice(d: Decision, choice: AgentChoice): void {
  if (choice.decisionId !== d.decisionId || !choice.reason) throw new Error("agent_invalid_choice");
  let kind: AgentChoice["kind"];
  let options: (string | number | null)[];
  switch (d.type) {
    case "priority_action": kind = "action"; options = d.actions.map(a => a.actionId); break;
    case "target_selection": kind = "target"; options = [...d.targets.map(t => t.targetId), ...(d.canFinish ? [d.finishTargetId] : [])]; break;
    case "mode_selection": kind = "mode"; options = [...d.modes.map(m => m.modeId), ...(d.canFinish ? [d.finishModeId] : [])]; break;
    case "optional_cost_selection": kind = "optional_cost"; options = [...d.costs.map(c => c.costId), d.declineCostId]; break;
    case "mana_payment": kind = "mana"; options = d.options.map(o => o.manaOptionId); break;
    case "cost_object_selection": kind = "object"; options = [...d.options.map(o => o.objectId), ...(d.canFinish ? [d.finishChoiceId] : [])]; break;
    case "value_selection":
      if (choice.kind !== "value" || !Number.isInteger(choice.choice) || choice.choice < d.minValue || choice.choice > d.maxValue) throw new Error("agent_invalid_choice");
      return;
    default: kind = "object"; options = d.options.map(o => o.objectId);
  }
  if (choice.kind !== kind || !options.includes(choice.choice)) throw new Error("agent_invalid_choice");
}
