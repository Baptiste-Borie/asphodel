/** Manual functional roles belong to a deck, independently of categories or placement. */
export type ProjectTag = { id: string; name: string; description: string; target?: number };
export type ProjectTags = { definitions: ProjectTag[]; cards: { name: string; tagIds: string[] }[] };
export const MAX_TAGS = 64;
export const TAG_TEMPLATES: ProjectTag[] = [
  { id: 'ramp', name: 'Ramp', description: 'Accélère ou augmente tes ressources de mana.' },
  { id: 'draw', name: 'Pioche', description: 'Apporte des cartes ou renouvelle les cartes en main.' },
  { id: 'interaction', name: 'Interaction', description: 'Répond aux cartes ou aux actions adverses.' },
  { id: 'protection', name: 'Protection', description: 'Protège ton commandant, ton plateau ou ton plan de jeu.' },
  { id: 'recursion', name: 'Récursion', description: 'Récupère ou rejoue des ressources déjà utilisées.' },
  { id: 'finish', name: 'Fin de partie', description: 'Contribue directement à terminer la partie.' },
];
export function validProjectTags(value: unknown, names: Set<string>): value is ProjectTags {
  const t = value as ProjectTags;
  const text = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
  if (!t || !Array.isArray(t.definitions) || t.definitions.length > MAX_TAGS || !Array.isArray(t.cards) || t.cards.length > 18000) return false;
  if (!t.definitions.every(d => d && text(d.id, 100) && /^[a-zA-Z0-9_-]+$/.test(d.id)
    && text(d.name, 60) && !!d.name.trim() && d.name === d.name.trim() && text(d.description, 1000)
    && (d.target === undefined || (Number.isSafeInteger(d.target) && d.target >= 0 && d.target <= 999)))) return false;
  const ids = new Set(t.definitions.map(d => d.id));
  if (ids.size !== t.definitions.length || new Set(t.definitions.map(d => d.name.toLocaleLowerCase('fr'))).size !== ids.size) return false;
  return t.cards.every(c => c && text(c.name, 200) && names.has(c.name) && Array.isArray(c.tagIds) && c.tagIds.length > 0
    && c.tagIds.length <= MAX_TAGS && c.tagIds.every(id => typeof id === 'string' && ids.has(id)) && new Set(c.tagIds).size === c.tagIds.length)
    && new Set(t.cards.map(c => c.name)).size === t.cards.length;
}
