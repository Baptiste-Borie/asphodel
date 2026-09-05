import type { AgentCardObservation as Card, AgentObservation, ForgePendingExternalDecision as Decision, ForgePendingCombatDecision as CombatDecision } from "../forge/forge-protocol.js";
import { BaselineAsphodelAgent, type AgentChoice } from "./baseline-agent.js";
import type { VersionedAsphodelAgent } from "./policy-version.js";

const firstBest = <T>(options: readonly T[], score: (option: T) => number): T => {
  const first = options[0];
  if (!first) throw new Error("agent_no_legal_options");
  return options.reduce((a, b) => score(b) > score(a) ? b : a, first);
};
const has = (card: Card | undefined, keyword: string) => card?.combatKeywords?.includes(keyword) ?? false;
const power = (card: Card | undefined) => Math.max(0, card?.power ?? 0);
const toughness = (card: Card | undefined) => Math.max(0, card?.toughness ?? 0);
const creature = (card: Card) => /Creature/i.test(card.typeLine ?? "");
function visible(o: AgentObservation) {
  const self = o.players.find(p => p.playerId === o.selfPlayerId);
  const foes = o.players.filter(p => p.playerId !== o.selfPlayerId);
  const cards = o.players.flatMap(p => [...p.battlefield, ...p.graveyard, ...p.command, ...p.exile,
    ...(p.role === "self" && p.playerId === o.selfPlayerId ? p.hand : [])]);
  const byId = new Map(cards.map(c => [c.cardRef, c]));
  const commanders = new Set(o.players.flatMap(p => p.commanders.map(c => c.cardRef)));
  const get = (id: string | null) => id === null ? undefined : byId.get(id);
  const score = (id: string | null) => {
    const card = get(id);
    return card ? power(card) * 2 + toughness(card) + (creature(card) ? 2 : /Land/i.test(card.typeLine ?? "") ? 1 : 3)
      + (id && commanders.has(id) ? 4 : 0) + (has(card, "flying") || has(card, "menace") ? 2 : 0)
      + (has(card, "deathtouch") ? 3 : 0) + (has(card, "indestructible") ? 5 : 0) : 0;
  };
  return { self, foes, get, score, commanders };
}
/** Parse only printed mana symbols, not rules text, discounts or affordability. */
function manaValue(cost: string | null) {
  if (!cost) return 0;
  const symbols = cost.toUpperCase().match(/\d+|[WUBRGCXYZ](?:\/[WUBRGPC])?/g) ?? [];
  return symbols.reduce((n, symbol) => n + (/^\d+$/.test(symbol) ? Number(symbol) : /^[XYZ]$/.test(symbol) ? 0 : 1), 0);
}
function intent(text: string): "damage" | "removal" | "benefit" | "unknown" {
  if (/\bdeals?\b.*\bdamage\b/i.test(text)) return "damage";
  if (/\b(destroy|exile)s?\b.*\btarget\b/i.test(text)) return "removal";
  if (/\b(draws?|gains?|creates?)\b|\+\d+\/\+\d+|put.*counter/i.test(text)) return "benefit";
  return "unknown";
}
const selfCost = (text: string) => /\b(sacrifice|discard|pay|lose)\b|destroy (?:a |target )?(?:permanent |creature )?you control/i.test(text);
function semanticScore(text: string) {
  if (selfCost(text)) return -20;
  return /\bdraw\b/i.test(text) ? 8 : /gain control/i.test(text) ? 7 : /create.*token/i.test(text) ? 6
    : /destroy.*opponent/i.test(text) ? 5 : /deal.*damage/i.test(text) ? 4 : /counter/i.test(text) ? 3 : /gain.*life/i.test(text) ? 1 : 0;
}
function combatOutcome(attacker: Card, blocker: Card) {
  const aFirst = has(attacker, "first_strike") || has(attacker, "double_strike");
  const bFirst = has(blocker, "first_strike") || has(blocker, "double_strike");
  let kills = !has(blocker, "indestructible") && power(attacker) > 0
    && (has(attacker, "deathtouch") || power(attacker) * (has(attacker, "double_strike") ? 2 : 1) >= toughness(blocker));
  let dies = !has(attacker, "indestructible") && power(blocker) > 0
    && (has(blocker, "deathtouch") || power(blocker) * (has(blocker, "double_strike") ? 2 : 1) >= toughness(attacker));
  // Only a lethal FIRST hit suppresses the other creature's normal hit.
  if (aFirst && !bFirst && (has(attacker, "deathtouch") || power(attacker) >= toughness(blocker)) && kills) dies = false;
  if (bFirst && !aFirst && (has(blocker, "deathtouch") || power(blocker) >= toughness(attacker)) && dies) kills = false;
  return { kills, dies };
}

export class BaselineAsphodelAgentV2b implements VersionedAsphodelAgent {
  readonly version = "v2b";
  private readonly fallback = new BaselineAsphodelAgent();
  choose(o: AgentObservation, d: Decision): AgentChoice {
    if (o.selfPlayerId !== d.playerId) throw new Error("agent_player_mismatch");
    const v = visible(o);
    const pick = (kind: Exclude<AgentChoice["kind"], "value">, choice: string, reason: string): AgentChoice => ({ decisionId: d.decisionId, kind, choice, reason });
    switch (d.type) {
      case "priority_action": {
        const ranked = d.actions.map(a => {
          const card = v.get(a.cardRef), type = card?.typeLine ?? "";
          const cost = manaValue(a.manaCost);
          if (a.type === "play_land") return { a, score: d.context.stackSize === 0 ? 1000 : 20, reason: "play_land_board_development" };
          if (a.type === "cast_spell") {
            const commander = v.commanders.has(a.cardRef);
            const permanent = /Creature|Artifact|Enchantment|Planeswalker|Battle/i.test(type);
            // Put a cheaper body into an empty board before an expensive commander; otherwise deploy the commander.
            const board = v.self?.battlefield.filter(creature).length ?? 0;
            const body = /Creature/i.test(type);
            return { a, score: (body ? 50 : permanent ? 35 : 15) + (commander ? 8 : 0)
              + (board === 0 ? 12 / (1 + cost) : Math.min(cost, 8)) + (has(card, "flying") || has(card, "menace") ? 4 : 0),
              reason: commander ? "cast_commander_board_development" : body ? "cast_creature_mana_efficiency" : permanent ? "cast_permanent_board_development" : "cast_other_legal_spell" };
          }
          const useful = a.type === "activate_ability" && intent(a.abilityText ?? "") !== "unknown" && !selfCost(a.abilityText ?? "");
          return { a, score: useful ? 25 : a.type === "pass" ? 0 : -1, reason: useful ? "activate_visible_benefit" : "pass_without_strong_action" };
        });
        const selected = firstBest(ranked, x => x.score);
        return pick("action", selected.a.actionId, selected.reason);
      }
      case "attackers_selection": return this.attack(o, d);
      case "blockers_selection": return this.block(o, d);
      case "target_selection": {
        if (d.canFinish && d.finishTargetId !== null && d.selectedTargetIds.length >= d.minTargets) return pick("target", d.finishTargetId, "finish_sufficient_targets");
        const text = d.source.abilityText ?? "", purpose = intent(text);
        const amount = Number(text.match(/deals?\s+(\d+)\s+damage/i)?.[1] ?? 0);
        const selected = firstBest(d.targets, t => {
          const friendly = t.controllerId === o.selfPlayerId;
          const hostile = t.controllerId !== null && !friendly;
          const targetLife = o.players.find(p => p.playerId === t.playerId)?.life ?? Infinity;
          if (purpose === "damage") {
            if (!hostile) return -10000;
            if (t.type === "player") return amount >= targetLife ? 10000 : 30;
            return amount > 0 && toughness(v.get(t.cardRef)) > 0 && amount >= toughness(v.get(t.cardRef)) ? 40 + v.score(t.cardRef) : 10;
          }
          if (purpose === "removal") return hostile ? 100 + v.score(t.cardRef) : -10000;
          if (purpose === "benefit") return friendly ? 100 + v.score(t.cardRef) : -10000;
          return 0;
        });
        return pick("target", selected.targetId, purpose === "unknown" ? "first_legal_target" : purpose === "removal" ? "target_highest_opponent_value" : `target_${purpose}_visible_value`);
      }
      case "mode_selection": {
        if (d.canFinish && d.finishModeId && d.selectedModeIds.length >= d.minModes) return pick("mode", d.finishModeId, "finish_sufficient_modes");
        return pick("mode", firstBest(d.modes, m => semanticScore(m.description ?? m.label)).modeId, "mode_visible_benefit_without_self_cost");
      }
      case "yes_no": {
        const text = `${d.prompt} ${d.source?.abilityText ?? ""}`;
        const positive = !selfCost(text) && intent(text) !== "unknown";
        const wanted = positive ? "Yes" : "No";
        return pick("object", (d.options.find(x => x.label === wanted) ?? firstBest(d.options, () => 0)).objectId,
          positive ? "accept_visible_benefit" : "decline_cost_or_unknown_effect");
      }
      case "value_selection": {
        if (d.valueKind !== "x") break;
        const scalable = /\bX\b.*\bdamage\b|\bdraw\s+X\b|create\s+X\b/i.test(d.source.abilityText ?? "");
        // maxValue is the supplied legal bound. No mana estimate from land counts.
        const value = scalable ? d.maxValue : Math.max(d.minValue, Math.min(1, d.maxValue));
        return { decisionId: d.decisionId, kind: "value", choice: value, reason: scalable ? "use_legal_scaling_x" : "minimum_positive_legal_x" };
      }
      case "optional_cost_selection": {
        // Current DTO exposes a cost label, not incremental benefit/affordability proof. Do not guess.
        return pick("optional_cost", d.declineCostId, "decline_unproven_optional_benefit");
      }
      case "mana_payment": {
        const selected = firstBest(d.options, m => {
          const colors = m.type === "spend_floating_mana" ? [m.color] : m.produces;
          const flexible = colors.some(c => /any|combo/i.test(c)) ? 6 : new Set(colors).size;
          const exact = colors.some(c => d.remainingCost.shards.includes(c));
          const waste = Math.max(0, colors.length - d.remainingCost.convertedManaCost);
          return (m.type === "spend_floating_mana" ? 10000 : 0) - waste * 1000 - flexible * 20 + (exact ? 10 : 0)
            - colors.length - (d.remainingCost.generic > 0 && colors.some(c => /^[WUBRG]$/.test(c)) ? 1 : 0);
        });
        return pick("mana", selected.manaOptionId, selected.type === "spend_floating_mana" ? "spend_legal_floating_mana" : "preserve_flexible_mana");
      }
    }
    return this.fallback.choose(o, d);
  }

  private attack(o: AgentObservation, d: CombatDecision): AgentChoice {
    const v = visible(o), additions = d.options.filter(x => x.operation === "add");
    const finish = d.options.find(x => x.operation === "finish");
    const legalRefs = new Set([...additions.flatMap(x => x.cardRef ? [x.cardRef] : []), ...d.selected.map(x => x.cardRef)]);
    const attackers = [...legalRefs].flatMap(ref => v.get(ref) ? [v.get(ref)!] : []);
    const ranked = additions.map(option => {
      const a = v.get(option.cardRef);
      const defender = v.foes.find(p => p.playerId === option.relatedRef);
      if (!a || power(a) === 0 || !defender) return { option, score: -100, reason: "hold_unknown_attack" };
      const blockers = defender.battlefield.filter(c => creature(c) && !c.tapped);
      let relevant = blockers.filter(b => !has(a, "flying") || has(b, "flying") || has(b, "reach"));
      if (has(a, "menace") && relevant.length < 2) relevant = [];
      // Conservative count-only lower bound: assume every blocker stops the strongest attacker.
      const group = attackers.filter(c => d.selected.some(s => s.cardRef === c.cardRef && s.relatedRef === option.relatedRef)
        || additions.some(s => s.cardRef === c.cardRef && s.relatedRef === option.relatedRef));
      const groupDamage = group.map(power).sort((a, b) => b - a).slice(blockers.length).reduce((n, p) => n + p, 0);
      if (groupDamage >= defender.life) return { option, score: 1000 + power(a), reason: "attack_visible_lethal" };
      if (!relevant.length) return { option, score: 200 + power(a), reason: "attack_free_damage" };
      const trades = relevant.map(b => {
        const result = combatOutcome(a, b);
        return !result.dies ? 1 : result.kills && v.score(b.cardRef) >= v.score(a.cardRef) ? 0 : -1;
      });
      const unfavorable = trades.some(t => t < 0);
      // A modest body can trade for meaningful unblocked team damage. No tree search.
      if (unfavorable && groupDamage * 3 >= v.score(a.cardRef) && groupDamage > 0)
        return { option, score: 70 + power(a), reason: "attack_overloaded_defense" };
      const triggerBenefit = Math.max(0, ...(a.selfAttackTriggers ?? []).map(semanticScore));
      if (unfavorable && triggerBenefit >= 3 && triggerBenefit * 2 >= v.score(a.cardRef))
        return { option, score: 80 + triggerBenefit, reason: "attack_visible_trigger_value" };
      if (unfavorable) return { option, score: -100, reason: "hold_bad_trade" };
      const untappedAfter = (v.self?.battlefield.filter(c => creature(c) && !c.tapped && c.cardRef !== a.cardRef && !d.selected.some(s => s.cardRef === c.cardRef)).length ?? 0);
      const enemyDamage = blockers.filter(b => !has(b, "defender")).map(power).sort((a, b) => b - a).slice(untappedAfter).reduce((n, p) => n + p, 0);
      if (!has(a, "vigilance") && enemyDamage >= (v.self?.life ?? 40)) return { option, score: -20, reason: "hold_against_visible_lethal" };
      return { option, score: 100 + power(a), reason: trades.every(t => t > 0) ? "attack_no_profitable_block" : "attack_profitable_trade" };
    });
    const best = ranked.length ? firstBest(ranked, x => x.score) : undefined;
    if (best && (best.score > 0 || !finish)) return { decisionId: d.decisionId, kind: "object", choice: best.option.objectId,
      reason: best.score > 0 ? best.reason : "complete_required_combat_draft" };
    if (finish) return { decisionId: d.decisionId, kind: "object", choice: finish.objectId, reason: best?.reason ?? "finish_combat_declaration" };
    return this.fallback.choose(o, d);
  }

  private block(o: AgentObservation, d: CombatDecision): AgentChoice {
    const v = visible(o), additions = d.options.filter(x => x.operation === "add"), finish = d.options.find(x => x.operation === "finish");
    const blocked = new Set(d.selected.map(s => s.relatedRef));
    // The union includes attackers this player can block; other attackers may be unblockable and absent.
    const attackRefs = new Set(d.attackers
      ? d.attackers.filter(a => a.relatedRef === o.selfPlayerId).map(a => a.cardRef)
      : [...d.options.flatMap(x => x.relatedRef ? [x.relatedRef] : []), ...blocked]);
    const incoming = [...attackRefs].filter(ref => !blocked.has(ref)).reduce((n, ref) => n + power(v.get(ref)), 0);
    const pressure = incoming >= Math.max(1, (v.self?.life ?? 40) - 3);
    const ranked = additions.map(option => {
      const own = v.get(option.cardRef), enemy = v.get(option.relatedRef);
      if (!own || !enemy) return { option, score: -100, reason: "hold_unknown_block" };
      if (blocked.has(enemy.cardRef)) {
        const partners = d.selected.filter(s => s.relatedRef === enemy.cardRef).flatMap(s => v.get(s.cardRef) ? [v.get(s.cardRef)!] : []);
        const alreadyKills = partners.reduce((n, c) => n + power(c), 0) >= toughness(enemy);
        const combinedKills = partners.reduce((n, c) => n + power(c), power(own)) >= toughness(enemy);
        const loss = partners.reduce((n, c) => n + v.score(c.cardRef), v.score(own.cardRef));
        return { option, score: !alreadyKills && combinedKills && loss <= v.score(enemy.cardRef) ? 50 : -100, reason: "block_useful_double_trade" };
      }
      const result = combatOutcome(enemy, own);
      if (!result.kills) return { option, score: 120 + (result.dies ? v.score(enemy.cardRef) : 0), reason: "block_without_loss" };
      if (result.dies && v.score(enemy.cardRef) >= v.score(own.cardRef)) return { option, score: 80 + v.score(enemy.cardRef) - v.score(own.cardRef), reason: "block_profitable_trade" };
      return { option, score: pressure ? 20 + power(enemy) - v.score(own.cardRef) / 10 : -100, reason: pressure ? "block_prevent_lethal_pressure" : "hold_bad_block" };
    });
    const best = ranked.length ? firstBest(ranked, x => x.score) : undefined;
    if (best && (best.score > 0 || !finish)) return { decisionId: d.decisionId, kind: "object", choice: best.option.objectId, reason: best.score > 0 ? best.reason : "complete_required_combat_draft" };
    if (finish) return { decisionId: d.decisionId, kind: "object", choice: finish.objectId, reason: "finish_without_bad_block" };
    return this.fallback.choose(o, d);
  }
}
