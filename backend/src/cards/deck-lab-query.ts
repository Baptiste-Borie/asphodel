import { AppError } from '../app-errors.js';
import type { LabSearchQuery } from '../../../shared/deck-lab.js';
export interface SqlFilter { sql: string; values: (string | number)[] }
const invalid = (message: string): never => { throw new AppError(message, 400, 'INVALID_CARD_SEARCH'); };
const text = (column: string, value: string): SqlFilter => ({sql:`instr(${column}, ?) > 0`,values:[value.normalize('NFKC').toLowerCase()]});
const exact = (column: string, value: string): SqlFilter => ({sql:`${column} = ?`,values:[value.toLowerCase()]});
const combine = (filters: SqlFilter[], join = 'AND'): SqlFilter => ({sql:filters.length ? `(${filters.map(f=>f.sql).join(` ${join} `)})` : '1',values:filters.flatMap(f=>f.values)});
function mana(value: string): SqlFilter {
  const match = /^(<=|>=|=|<|>)?\s*(\d+(?:\.\d+)?)$/.exec(value.trim());
  if (!match) return invalid('Mana value must be a number or comparison, for example 3 or <=4.');
  return {sql:`cmc ${match[1] || '='} ?`,values:[Number(match[2])]};
}
function color(column: string, value: string): SqlFilter {
  const aliases: Record<string,string> = {white:'w',blue:'u',black:'b',red:'r',green:'g',colorless:'c'};
  value = aliases[value.toLowerCase()] ?? value.toLowerCase();
  const match = /^(<=|>=|=|:)?([wubrgc]+)$/.exec(value);
  if (!match || (match[2]!.includes('c') && match[2] !== 'c')) return invalid('Use W, U, B, R, G or C for colors, optionally with =, <= or >=.');
  const symbols = [...new Set(match[2] === 'c' ? [] : [...match[2]!])];
  if (!symbols.length) return exact(column,'');
  const op = match[1] ?? '>=';
  const wanted = symbols.map(s => text(column,s));
  const unwanted = [...'wubrg'].filter(s=>!symbols.includes(s)).map(s=>({sql:`instr(${column}, ?) = 0`,values:[s]}));
  return combine(op === '<=' ? unwanted : op === '=' ? [...wanted,...unwanted] : wanted);
}
function term(source: string): SqlFilter {
  const match = /^([a-z]+)(:|<=|>=|=|<|>)(.*)$/i.exec(source);
  if (!match) return text('name_search',source);
  const [, key, operator, raw] = match;
  const value = raw!.replace(/^"(.*)"$/, '$1').replace(/\\"/g,'"');
  if (!value) return invalid(`Missing value for ${key}.`);
  if (operator !== ':' && !['mv','cmc','c','color','id','identity'].includes(key!.toLowerCase())) return invalid(`Use a colon for ${key}, for example ${key}:${value}.`);
  switch (key!.toLowerCase()) {
    case 'name': return text('name_search',value);
    case 'o': case 'oracle': return text('oracle_search',value);
    case 't': case 'type': return text('type_search',value);
    case 's': case 'set': case 'e': case 'edition': return exact('set_code',value);
    case 'r': case 'rarity': return exact('rarity',({c:'common',u:'uncommon',r:'rare',m:'mythic'} as Record<string,string>)[value] ?? value);
    case 'lang': case 'language': return exact('language',value);
    case 'mv': case 'cmc': return mana((operator === ':' ? '' : operator) + value);
    case 'c': case 'color': return color('colors',(operator === ':' ? '' : operator) + value);
    case 'id': case 'identity': return color('identity',(operator === ':' ? '' : operator) + value);
    case 'f': case 'format': case 'legal': if (value === 'commander') return exact('commander','legal'); break;
  }
  return invalid(`Unsupported local search field: ${key}. Supported: name, o, t, set, r, lang, mv, c, id, f:commander.`);
}
export function compileRawQuery(raw: string): SqlFilter {
  const tokens = raw.match(/(?:[^\s()"]+|"(?:\\.|[^"\\])*")+|[()]/g) ?? [];
  if (tokens.length > 100 || (raw.match(/(?<!\\)"/g)?.length ?? 0) % 2) return invalid('Invalid or overly complex query. Check quotation marks.');
  let position = 0;
  function atom(depth: number): SqlFilter {
    if (depth > 12) return invalid('Query nesting is too deep.');
    let token = tokens[position++];
    if (!token || token === ')' || /^(OR|AND)$/i.test(token)) return invalid('Expected a search term.');
    if (token === '-' || /^NOT$/i.test(token)) { const child = atom(depth+1); return {sql:`NOT (${child.sql})`,values:child.values}; }
    if (token === '(') { const child = or(depth+1); if (tokens[position++] !== ')') return invalid('Missing closing parenthesis.'); return child; }
    const negative = token.startsWith('-'); if (negative) token = token.slice(1);
    const child = term(token.replace(/^"(.*)"$/,'$1'));
    return negative ? {sql:`NOT (${child.sql})`,values:child.values} : child;
  }
  function and(depth: number): SqlFilter {
    const terms = [atom(depth)];
    while (position < tokens.length && tokens[position] !== ')' && !/^OR$/i.test(tokens[position]!)) {
      if (/^AND$/i.test(tokens[position]!)) position++;
      terms.push(atom(depth));
    }
    return combine(terms);
  }
  function or(depth: number): SqlFilter {
    const groups = [and(depth)];
    while (/^OR$/i.test(tokens[position] ?? '')) { position++; groups.push(and(depth)); }
    return combine(groups,'OR');
  }
  if (!tokens.length) return {sql:'1',values:[]};
  const result = or(0);
  if (position !== tokens.length) return invalid('Unexpected closing parenthesis.');
  return result;
}
export function compileLabQuery(query: LabSearchQuery): SqlFilter {
  const filters: SqlFilter[] = [];
  if (query.query?.trim()) filters.push(combine([text('name_search',query.query.trim()),text('oracle_search',query.query.trim())],'OR'));
  if (query.name?.trim()) filters.push(text('name_search',query.name.trim()));
  if (query.oracle?.trim()) filters.push(text('oracle_search',query.oracle.trim()));
  for (const type of query.types ?? []) filters.push(text('type_search', type));
  if (query.sets?.length) filters.push(combine(query.sets.map(s=>exact('set_code',s)),'OR'));
  if (query.colors?.trim()) filters.push(color('colors',query.colors.trim()));
  if (query.identity?.trim()) filters.push(color('identity',query.identity.trim()));
  if (query.manaValue?.trim()) filters.push(mana(query.manaValue));
  if (query.rarity) filters.push(exact('rarity',query.rarity));
  if (query.language) filters.push(exact('language',query.language));
  if (query.raw?.trim()) filters.push(compileRawQuery(query.raw));
  return combine(filters);
}
