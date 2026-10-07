import type { LabCard } from '../../../shared/deck-lab';
import { commanderName, type CommanderFacts } from '../../../shared/commander.mjs';
import type { Sheet } from './deck-model';

export type CheckStatus = 'ok' | 'error' | 'unknown';
export type CommanderIssue = { status: 'error' | 'unknown'; message: string; cards: string[] };
export type CommanderCheck = { id: string; label: string; status: CheckStatus; summary: string; issues: CommanderIssue[] };
type Rules = { name: string; oracleId?: string; type: string; oracle: string | null; identity: string[]; legal?: string; power: string | null; toughness: string | null };
export const COMMANDER_RULES_DATE = '2026-09-25';
const COLORS = ['W', 'U', 'B', 'R', 'G'];
const LAND_COLORS: Record<string, string> = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
function rules(card: LabCard, facts?: CommanderFacts): Rules {
  return facts ? { name: facts.name, oracleId: facts.oracleId, type: facts.typeLine, oracle: facts.oracleText, identity: facts.colorIdentity, legal: facts.commanderLegal, power: facts.power, toughness: facts.toughness }
    : { name: card.name, type: card.type_line, oracle: card.oracle_text, identity: card.color_identity, legal: card.commander_legal, power: card.power, toughness: card.toughness };
}
const frontName = (c: Rules) => c.name.split(' // ')[0]!;
const frontType = (c: Rules) => c.type.split(' // ')[0]!;
/** The search index joins face texts with a blank line; the back cannot grant eligibility. */
function frontOracle(c: Rules): string | null {
  if (c.oracle === null) return null;
  return c.type.includes(' // ') || c.name.includes(' // ') ? c.oracle.split('\n\n')[0]! : c.oracle;
}
function withoutReminder(value: string): string {
  let depth = 0, output = '';
  for (const char of value) { if (char === '(') depth++; else if (char === ')' && depth) depth--; else if (!depth) output += char; }
  return output.replaceAll('’', "'");
}
const lines = (c: Rules) => withoutReminder(frontOracle(c) ?? '').split('\n').map(l => l.trim().replace(/\.$/, ''));
const hasType = (c: Rules, word: string) => frontType(c).split(/\s|—/).includes(word);
function eligibility(c: Rules): { status: CheckStatus; reason: string } {
  if (!frontType(c).trim()) return { status: 'unknown', reason: 'Type du recto indisponible.' };
  if (hasType(c, 'Legendary') && (hasType(c, 'Creature') || hasType(c, 'Vehicle'))) return { status: 'ok', reason: 'Recto légendaire éligible.' };
  if (hasType(c, 'Legendary') && hasType(c, 'Spacecraft')) return c.power !== null && c.toughness !== null
    ? { status: 'ok', reason: 'Vaisseau légendaire avec force/endurance.' } : { status: 'unknown', reason: 'Le vaisseau doit avoir une case de force/endurance ; données insuffisantes.' };
  if (lines(c).some(l => commanderName(l) === commanderName(`${frontName(c)} can be your commander`) || l === 'This card can be your commander')) return { status: 'ok', reason: 'Autorisation explicite dans le texte Oracle.' };
  if (commanderName(frontName(c)) === 'grist, the hunger tide' && /isn't on the battlefield.*creature/i.test(frontOracle(c) ?? '')) return { status: 'ok', reason: 'Grist est une créature pendant la construction du deck.' };
  if (frontOracle(c) === null || /can be your commander|isn't on the battlefield|not on the battlefield/i.test(frontOracle(c) ?? '')) return { status: 'unknown', reason: 'Éligibilité spéciale ou texte Oracle incomplet : à vérifier.' };
  return { status: 'error', reason: 'Ce recto ne remplit pas les conditions pour être commandant.' };
}
type PairAbilities = { variants: Set<string>; withNames: string[]; background: boolean; companion: boolean; uncertain: boolean };
function pairAbilities(c: Rules): PairAbilities {
  const result: PairAbilities = { variants: new Set(), withNames: [], background: false, companion: false, uncertain: frontOracle(c) === null };
  for (const line of lines(c)) {
    if (line === 'Partner') result.variants.add('partner');
    else if (line === 'Friends forever') result.variants.add('friends forever');
    else if (/^Partner\s*[—–-]\s*/i.test(line)) {
      const variant = line.replace(/^Partner\s*[—–-]\s*/i, '').toLowerCase();
      if (['character select', 'father & son', 'friends forever', 'survivors'].includes(variant)) result.variants.add(variant);
      else result.uncertain = true;
    } else if (line.startsWith('Partner with ')) result.withNames.push(commanderName(line.slice(13)));
    else if (line === 'Choose a Background') result.background = true;
    else if (line === "Doctor's companion") result.companion = true;
  }
  return result;
}
function isDoctor(c: Rules): boolean {
  if (!hasType(c, 'Legendary') || !hasType(c, 'Creature')) return false;
  const subtypes = frontType(c).split('—')[1]?.trim().replace(/Time Lord/g, 'Time_Lord').split(/\s+/).sort();
  return subtypes?.join(' ') === 'Doctor Time_Lord';
}
function compatiblePair(a: Rules, b: Rules): { status: CheckStatus; reason: string; background?: string } {
  const pa = pairAbilities(a), pb = pairAbilities(b);
  const background = (c: Rules) => hasType(c, 'Legendary') && hasType(c, 'Enchantment') && hasType(c, 'Background');
  if (pa.background && background(b)) return { status: 'ok', reason: 'Choisir un background + enchantement de background légendaire.', background: b.name };
  if (pb.background && background(a)) return { status: 'ok', reason: 'Choisir un background + enchantement de background légendaire.', background: a.name };
  if ((pa.companion && isDoctor(b) && hasType(a, 'Legendary') && hasType(a, 'Creature')) || (pb.companion && isDoctor(a) && hasType(b, 'Legendary') && hasType(b, 'Creature'))) return { status: 'ok', reason: 'Doctor’s companion + Time Lord Doctor sans autre type de créature.' };
  if ([...pa.variants].some(v => pb.variants.has(v))) return { status: 'ok', reason: 'Même capacité de partenariat sur les deux cartes.' };
  if (pa.withNames.includes(commanderName(frontName(b))) && pb.withNames.includes(commanderName(frontName(a)))) return { status: 'ok', reason: 'Les partenaires nommés se désignent réciproquement.' };
  if (pa.uncertain || pb.uncertain) return { status: 'unknown', reason: 'Texte manquant ou variante de partenariat non reconnue.' };
  return { status: 'error', reason: 'Aucune capacité reconnue ne permet d’associer ces deux commandants.' };
}
const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
function copyLimit(c: Rules): number | null {
  if (hasType(c, 'Basic') && hasType(c, 'Land')) return Infinity;
  if (c.oracle === null) return null;
  const text = withoutReminder(c.oracle);
  for (const line of text.split('\n').map(l => l.trim())) {
    const any = /^A deck can have any number of cards named (.+)\.$/.exec(line);
    if (any && commanderName(any[1]!) === commanderName(c.name)) return Infinity;
    const upTo = /^A deck can have up to (\d+|[a-z]+) cards named (.+)\.$/.exec(line);
    if (upTo && commanderName(upTo[2]!) === commanderName(c.name)) return WORD_NUMBERS[upTo[1]!] ?? (/^\d+$/.test(upTo[1]!) ? Number(upTo[1]) : null);
  }
  return /a deck can have/i.test(text) ? null : 1;
}
function makeCheck(id: string, label: string, summary: string, issues: CommanderIssue[]): CommanderCheck {
  return { id, label, summary, issues, status: issues.some(i => i.status === 'error') ? 'error' : issues.length ? 'unknown' : 'ok' };
}
/** Pure, advisory checks. No deck edits, network, image changes or gameplay restrictions. */
export function analyzeCommander(sheet: Sheet, catalog: ReadonlyMap<string, CommanderFacts> = new Map()) {
  const entries = sheet.groups.filter(g => !g.maybeboard).flatMap(g => g.entries.map(e => ({ ...e, commander: !!g.commander, rules: rules(e.card, catalog.get(commanderName(e.card.name))) })));
  const total = entries.reduce((n, e) => n + e.quantity, 0), command = entries.filter(e => e.commander), commandCount = command.reduce((n, e) => n + e.quantity, 0);
  const commanders: CommanderIssue[] = [], colors: CommanderIssue[] = [], copies: CommanderIssue[] = [], legality: CommanderIssue[] = [];
  if (commandCount < 1 || commandCount > 2 || command.some(e => e.quantity !== 1)) commanders.push({ status: 'error', message: 'Désigne un commandant, ou deux commandants compatibles, avec une seule copie de chacun.', cards: command.map(e => e.card.name) });
  const pair = command.length === 2 && commandCount === 2 ? compatiblePair(command[0]!.rules, command[1]!.rules) : undefined;
  if (pair && pair.status !== 'ok') commanders.push({ status: pair.status, message: pair.reason, cards: command.map(e => e.card.name) });
  for (const e of command) {
    if (pair?.background === e.rules.name) continue;
    if (pair?.status === 'unknown' && hasType(e.rules, 'Background')) { commanders.push({ status: 'unknown', message: 'L’autre commandant doit autoriser ce background ; texte à vérifier.', cards: [e.card.name] }); continue; }
    const eligible = eligibility(e.rules);
    if (eligible.status !== 'ok') commanders.push({ status: eligible.status, message: eligible.reason, cards: [e.card.name] });
  }
  const identity = COLORS.filter(c => command.some(e => e.rules.identity.includes(c)));
  const identityUnknown = commandCount < 1 || command.some(e => e.rules.identity.some(c => !COLORS.includes(c)) || /choose (?:a |an additional )?colou?r[^.]*before the game begins|before the game begins[^.]*choose/i.test(frontOracle(e.rules) ?? ''));
  if (identityUnknown) colors.push({ status: 'unknown', message: 'Identité des commandants absente, invalide ou dépendante d’un choix avant la partie. Les couleurs hors identité ne peuvent pas être conclues.', cards: command.map(e => e.card.name) });
  if (!identityUnknown) for (const e of entries) {
    if (e.rules.identity.some(c => !COLORS.includes(c))) { colors.push({ status: 'unknown', message: 'Identité couleur illisible dans les données.', cards: [e.card.name] }); continue; }
    const landColors = hasType(e.rules, 'Land') ? Object.entries(LAND_COLORS).filter(([type]) => hasType(e.rules, type)).map(([, c]) => c) : [];
    const outside = COLORS.filter(c => [...e.rules.identity, ...landColors].includes(c) && !identity.includes(c));
    if (outside.length) colors.push({ status: 'error', message: `Couleurs ${outside.join(' · ')} hors de l’identité ${identity.join(' · ') || 'incolore'} des commandants désignés.`, cards: [e.card.name] });
  }
  const grouped = new Map<string, typeof entries>();
  for (const e of entries) { const key = e.rules.oracleId ? `oracle:${e.rules.oracleId}` : `name:${commanderName(e.rules.name)}`; const group = grouped.get(key) ?? []; group.push(e); grouped.set(key, group); }
  for (const group of grouped.values()) {
    const quantity = group.reduce((n, e) => n + e.quantity, 0); if (quantity < 2) continue;
    const limits = group.map(e => copyLimit(e.rules));
    if (limits.some(n => n === null)) copies.push({ status: 'unknown', message: `${quantity} copies : texte Oracle incomplet ou exception de quantité non reconnue.`, cards: [...new Set(group.map(e => e.card.name))] });
    else { const limit = Math.min(...limits as number[]); if (quantity > limit) copies.push({ status: 'error', message: `${quantity} copies au total ; maximum ${limit} pour cette carte (toutes catégories et éditions confondues).`, cards: [...new Set(group.map(e => e.card.name))] }); }
  }
  const missingLegal: string[] = [];
  for (const e of entries) {
    if (e.rules.legal === 'banned' || e.rules.legal === 'not_legal') legality.push({ status: 'error', message: e.rules.legal === 'banned' ? 'Carte interdite en Commander selon les données disponibles.' : 'Carte non légale en Commander selon les données disponibles.', cards: [e.card.name] });
    else if (e.rules.legal !== 'legal') missingLegal.push(e.card.name);
  }
  if (missingLegal.length) legality.push({ status: 'unknown', message: 'Statut Commander absent ou non reconnu. Vérifie avec le catalogue local.', cards: [...new Set(missingLegal)] });
  const checks = [
    makeCheck('size', 'Taille du deck', `${total} / 100 cartes, commandants compris.`, total === 100 ? [] : [{ status: 'error', message: total < 100 ? `Il manque ${100 - total} cartes dans le deck.` : `Retire ${total - 100} cartes pour atteindre 100.`, cards: [] }]),
    makeCheck('commanders', 'Commandants', pair?.status === 'ok' ? pair.reason : `${commandCount} carte${commandCount > 1 ? 's' : ''} désignée${commandCount > 1 ? 's' : ''}.`, commanders),
    makeCheck('colors', 'Identité couleur', identityUnknown ? 'À vérifier.' : identity.join(' · ') || 'Incolore.', colors),
    makeCheck('copies', 'Doublons et exceptions', 'Quantités cumulées, terrains de base et exceptions Oracle reconnues.', copies),
    makeCheck('legality', 'Statuts Commander', 'Statuts du catalogue local ou des cartes enregistrées ; pas de liste d’interdictions figée.', legality),
  ];
  return { total, checks, errors: checks.reduce((n, c) => n + c.issues.filter(i => i.status === 'error').length, 0), unknown: checks.reduce((n, c) => n + c.issues.filter(i => i.status === 'unknown').length, 0) };
}
