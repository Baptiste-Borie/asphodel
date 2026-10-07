import type { LabCard } from '../../../shared/deck-lab';
import { commanderName, type CommanderFacts } from '../../../shared/commander.mjs';
import type { Sheet } from './deck-model';

export const MANA_TYPES = ['W', 'U', 'B', 'R', 'G', 'C'] as const;
export type ManaType = typeof MANA_TYPES[number];
export const MANA_LABELS: Record<ManaType, string> = { W: 'Blanc', U: 'Bleu', B: 'Noir', R: 'Rouge', G: 'Vert', C: 'Incolore' };
const COLORS = MANA_TYPES.slice(0, 5);
const BASIC: Record<string, ManaType> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
export type ManaDemand = { required: Record<ManaType, number>; flexible: Record<ManaType, number>; generic: number; variable: number; snow: number; unknown: boolean };
const counts = (): Record<ManaType, number> => ({ W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 });
const isMana = (s: string): s is ManaType => MANA_TYPES.includes(s as ManaType);
const words = (s: string) => s.split(/\s|—/);
function stripReminder(s: string): string {
  let depth = 0, result = '';
  for (const c of s) { if (c === '(') depth++; else if (c === ')' && depth) depth--; else if (!depth) result += c; }
  return result.replaceAll('’', "'");
}
/** Printed costs only. Flexible choices are never counted as mandatory colored pips. */
export function parseManaCost(cost: string | null): ManaDemand {
  const result: ManaDemand = { required: counts(), flexible: counts(), generic: 0, variable: 0, snow: 0, unknown: false };
  if (cost === null) { result.unknown = true; return result; }
  if (cost === '') return result; // No printed cost is different from {0}; neither implies normal castability.
  const tokens = [...cost.matchAll(/\{([^{}]+)\}/g)].map(m => m[1]!);
  if (!tokens.length || cost.replace(/\{[^{}]+\}/g, '').trim()) result.unknown = true;
  for (const token of tokens) {
    if (isMana(token)) result.required[token]++;
    else if (/^\d+$/.test(token) && Number.isSafeInteger(Number(token))) result.generic += Number(token);
    else if (['X', 'Y', 'Z'].includes(token)) result.variable++;
    else if (token === 'S') result.snow++;
    else {
      const parts = token.split('/');
      const hybrid = parts.length === 2 && parts.every(isMana) && parts[0] !== parts[1];
      const two = parts.length === 2 && parts[0] === '2' && isMana(parts[1]!);
      const phyrexian = (parts.length === 2 || parts.length === 3) && parts.at(-1) === 'P' && parts.slice(0, -1).every(isMana) && new Set(parts.slice(0, -1)).size === parts.length - 1;
      if (hybrid || two || phyrexian) { for (const p of parts) if (isMana(p)) result.flexible[p]++; }
      else result.unknown = true;
    }
  }
  if (!Number.isSafeInteger(result.generic)) result.unknown = true;
  if (result.unknown) { result.required = counts(); result.flexible = counts(); result.generic = result.variable = result.snow = 0; }
  return result;
}
type RuleCard = { name: string; type: string; oracle: string | null; cost: string | null; identity: string[] };
export type ManaSource = { name: string; quantity: number; kind: 'land' | 'permanent' | 'oneShot'; direct: ManaType[]; conditional: ManaType[]; unknown: boolean; entry: 'untapped' | 'tapped' | 'conditional' | 'unknown'; notes: string[] };
export type ManaReview = { name: string; quantity: number; reason: string };
function ruleCard(c: LabCard, facts?: CommanderFacts): RuleCard {
  return { name: facts?.name ?? c.name, type: facts?.typeLine ?? c.type_line, oracle: facts ? facts.oracleText : c.oracle_text,
    cost: facts?.manaCost === undefined ? c.mana_cost : facts.manaCost, identity: facts?.colorIdentity ?? c.color_identity };
}
function source(c: RuleCard, quantity: number, commanderColors: ManaType[] | null): ManaSource | undefined {
  const multi = c.name.includes(' // ') || c.type.includes(' // '), land = words(c.type.split(' // ')[0]!).includes('Land');
  const permanent = words(c.type).some(w => ['Creature', 'Artifact', 'Enchantment', 'Planeswalker', 'Battle', 'Land'].includes(w));
  // A basic land's entire production may be printed as reminder text (notably Wastes).
  const text = stripReminder((c.oracle ?? '').replace(/^\((\{T\}: Add \{[WUBRGC]\}\.)\)$/gm, '$1')), relevant = land || /\badd\b.*(?:mana|\{[WUBRGC])/i.test(text) || /\b(?:Treasure|Powerstone) tokens?\b|search your library.*land|mana ability|mana abilities|mana of (?:any|a) type|mana of any color/i.test(text);
  if (!relevant) return;
  const out: ManaSource = { name: c.name, quantity, kind: land ? 'land' : permanent ? 'permanent' : 'oneShot', direct: [], conditional: [], unknown: false, entry: 'unknown', notes: [] };
  if (multi) { out.unknown = true; out.notes.push('Carte à plusieurs faces : choix de face ou transformation non modélisé ; production non cumulée.'); return out; }
  const direct = new Set<ManaType>(), conditional = new Set<ManaType>();
  if (land) for (const [type, color] of Object.entries(BASIC)) if (words(c.type).includes(type)) direct.add(color);
  if (land) {
    if (c.oracle === null) out.entry = 'unknown';
    else if (/^[^\n]*\bif\b[^\n]*enters[^\n]*tapped/im.test(text)) out.entry = 'conditional';
    else if (/enters(?: the battlefield)? tapped unless|enters(?: the battlefield)? tapped if|as .* enters[\s\S]*pay[\s\S]*if you don't/i.test(text)) out.entry = 'conditional';
    else if (/^[^\n.]*enters(?: the battlefield)? tapped\./im.test(text)) out.entry = 'tapped';
    else if (/enters[^\n]*tapped|enters[^\n]*untapped/i.test(text)) out.entry = 'unknown';
    else out.entry = 'untapped';
  }
  let recognized = false;
  for (const line of text.split('\n').map(l => l.trim()).filter(Boolean)) {
    const activated = /^([^:]+): Add (.+)$/.exec(line);
    const oneShot = !permanent ? /^Add (.+)$/.exec(line) : null;
    if (!activated && !oneShot) {
      if (/\badd\b.*(?:mana|\{[WUBRGC])/i.test(line) || /\b(?:Treasure|Powerstone) tokens?\b|search your library.*land|mana ability|mana abilities/i.test(line)) out.unknown = true;
      continue;
    }
    if (activated && !/^(?:\{[^{}]+\}(?:,\s*|\s*)?)+(?:(?:Pay|Sacrifice|Discard|Remove|Tap) .+)?$|^(?:Pay|Sacrifice|Discard|Remove|Tap) .+$|^[+-]\d+$/.test(activated[1]!)) { out.unknown = true; continue; }
    const effect = activated?.[2] ?? oneShot![1]!, sentence = effect.split('.')[0]!;
    let types: ManaType[] = [], complete = false;
    if (/^\{[WUBRGC]\}(?:\{[WUBRGC]\})*$/.test(sentence)) { types = [...new Set([...sentence.matchAll(/\{([WUBRGC])\}/g)].map(m => m[1] as ManaType))]; complete = true; }
    else if (/^\{[WUBRGC]\}(?:, \{[WUBRGC]\})*(?:,? or \{[WUBRGC]\})+$/.test(sentence)) { types = [...new Set([...sentence.matchAll(/\{([WUBRGC])\}/g)].map(m => m[1] as ManaType))]; complete = true; }
    else if (/^(?:one|two|three) mana of any (?:one )?color$|^(?:one|two|three) mana in any combination of colors$/.test(sentence)) { types = [...COLORS]; complete = true; }
    else if (sentence === "one mana of any color in your commander's color identity" && commanderColors !== null) { types = commanderColors; complete = true; }
    if (!complete || !effect.includes('.')) { out.unknown = true; continue; }
    recognized = true;
    const restricted = /spend this mana only|use this mana only|spend this mana to|this mana can only|this mana can be spent only|this mana can't|this mana cannot|activate (?:this ability )?only/i.test(effect)
      || /^(?:Activate|You may activate) (?:this ability )?only/im.test(text) || !['{T}', '{T},'].includes(activated?.[1]?.trim() ?? '{T}');
    for (const color of types) (restricted ? conditional : direct).add(color);
    if (restricted) out.notes.push('Activation avec coût supplémentaire ou mana à usage restreint : potentiel conditionnel.');
    if (/damage|lose .*life/i.test(effect)) out.notes.push('La production peut coûter des points de vie.');
  }
  if (c.oracle === null || (!recognized && !direct.size)) out.unknown = true;
  if (out.unknown) out.notes.push('Production, accès indirect aux terrains ou texte incomplet à vérifier ; aucune couleur devinée.');
  if (out.kind === 'permanent') out.notes.push('Source à mettre en jeu ; coût, mal d’invocation et rythme non simulés.');
  if (out.kind === 'oneShot') out.notes.push('Production ponctuelle, exclue des sources permanentes.');
  out.direct = MANA_TYPES.filter(t => direct.has(t)); out.conditional = MANA_TYPES.filter(t => conditional.has(t) && !direct.has(t));
  out.notes = [...new Set(out.notes)]; return out;
}
/** Quantities matter; categories, zones, tags, candidates and cuts never create extra sources. */
export function analyzeMana(sheet: Sheet, catalog: ReadonlyMap<string, CommanderFacts> = new Map()) {
  const entries = sheet.groups.filter(g => !g.maybeboard).flatMap(g => g.entries.map(e => ({ ...e, commander: !!g.commander, rules: ruleCard(e.card, catalog.get(commanderName(e.card.name))) })));
  const commanders = entries.filter(e => e.commander);
  const commanderColors: ManaType[] | null = !commanders.length || commanders.some(e => e.rules.identity.some(c => !isMana(c) || c === 'C') || /before the game begins.*choose|choose .*colou?r.*before the game begins/i.test(e.rules.oracle ?? '')) ? null : COLORS.filter(c => commanders.some(e => e.rules.identity.includes(c)));
  const library = { required: counts(), flexible: counts(), generic: 0, variable: 0, snow: 0 }, command = { required: counts(), flexible: counts(), generic: 0, variable: 0, snow: 0 };
  const reviews: ManaReview[] = [], sources: ManaSource[] = []; let lands = 0, analyzedSpells = 0, missingCosts = 0;
  for (const e of entries) {
    const c = e.rules, multi = c.name.includes(' // ') || c.type.includes(' // '), land = words(c.type.split(' // ')[0]!).includes('Land');
    if (land) lands += e.quantity;
    if (multi || !land) {
      const cost = parseManaCost(c.cost);
      if (multi || cost.unknown) { missingCosts += e.quantity; reviews.push({ name: e.card.name, quantity: e.quantity, reason: multi ? 'Coûts et choix de plusieurs faces non modélisés ; exclus de la demande chiffrée.' : 'Coût absent ou symbole non reconnu ; demande non chiffrée.' }); }
      else { analyzedSpells += e.quantity; const target = e.commander ? command : library;
        for (const t of MANA_TYPES) { target.required[t] += cost.required[t] * e.quantity; target.flexible[t] += cost.flexible[t] * e.quantity; }
        for (const k of ['generic', 'variable', 'snow'] as const) target[k] += cost[k] * e.quantity;
      }
    }
    const s = source(c, e.quantity, commanderColors);
    if (s) { s.name = e.card.name; sources.push(s); if (s.unknown) reviews.push({ name: e.card.name, quantity: e.quantity, reason: s.notes.filter(n => /non modélisé|à vérifier/.test(n)).join(' ') }); }
    else if (c.oracle === null && !land) reviews.push({ name: e.card.name, quantity: e.quantity, reason: 'Texte Oracle absent : éventuelle production de mana non vérifiée.' });
  }
  const rows = MANA_TYPES.map(type => ({ type, required: library.required[type], flexible: library.flexible[type], commanderRequired: command.required[type], commanderFlexible: command.flexible[type],
    lands: sources.filter(s => s.kind === 'land' && s.direct.includes(type)).reduce((n, s) => n + s.quantity, 0),
    other: sources.filter(s => s.kind === 'permanent' && s.direct.includes(type)).reduce((n, s) => n + s.quantity, 0),
    conditional: sources.filter(s => s.kind !== 'oneShot' && s.conditional.includes(type)).reduce((n, s) => n + s.quantity, 0) }));
  const landEntry = (state: ManaSource['entry']) => sources.filter(s => s.kind === 'land' && s.entry === state).reduce((n, s) => n + s.quantity, 0);
  return { library, command, rows, sources, reviews, lands, analyzedSpells, missingCosts, total: entries.reduce((n, e) => n + e.quantity, 0),
    tapped: landEntry('tapped'), conditionalEntry: landEntry('conditional'), unknownEntry: landEntry('unknown'),
    directLands: sources.filter(s => s.kind === 'land' && s.direct.length).reduce((n, s) => n + s.quantity, 0),
    otherSources: sources.filter(s => s.kind === 'permanent' && (s.direct.length || s.conditional.length)).reduce((n, s) => n + s.quantity, 0),
    oneShot: sources.filter(s => s.kind === 'oneShot').reduce((n, s) => n + s.quantity, 0) };
}
