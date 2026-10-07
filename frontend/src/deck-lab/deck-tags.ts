import { TAG_TEMPLATES, type ProjectTags } from '../../../shared/deck-tags.mjs';
import { deckStatistics, type Sheet } from './deck-model';

export function editableTags(sheet: Sheet): ProjectTags {
  return structuredClone(sheet.tags ?? { definitions: TAG_TEMPLATES, cards: [] });
}
export function tagsForCard(sheet: Sheet, name: string) {
  const ids = new Set(sheet.tags?.cards.find(c => c.name === name)?.tagIds ?? []);
  return (sheet.tags?.definitions ?? []).filter(d => ids.has(d.id));
}
/** All copies of a named card share roles, including candidates and cuts. */
export function setCardTag(tags: ProjectTags, names: string[], id: string, enabled: boolean) {
  if (!tags.definitions.some(d => d.id === id)) throw new Error('Tag inconnu.');
  for (const name of new Set(names)) {
    let row = tags.cards.find(c => c.name === name);
    if (enabled) { if (!row) { row = { name, tagIds: [] }; tags.cards.push(row); } if (!row.tagIds.includes(id)) row.tagIds.push(id); }
    else if (row) { row.tagIds = row.tagIds.filter(t => t !== id); }
  }
  tags.cards = tags.cards.filter(c => c.tagIds.length);
}
export function removeTag(tags: ProjectTags, id: string) {
  tags.definitions = tags.definitions.filter(d => d.id !== id);
  tags.cards = tags.cards.map(c => ({ ...c, tagIds: c.tagIds.filter(t => t !== id) })).filter(c => c.tagIds.length);
}
/** Quantities count once per role; role totals deliberately overlap. */
export function roleStatistics(sheet: Sheet) {
  const entries = deckStatistics(sheet.groups).entries;
  const byName = new Map(sheet.tags?.cards.map(c => [c.name, new Set(c.tagIds)]) ?? []);
  return {
    roles: (sheet.tags?.definitions ?? []).map(d => ({ ...d, count: entries.filter(e => byName.get(e.card.name)?.has(d.id)).reduce((n, e) => n + e.quantity, 0) })),
    untagged: entries.filter(e => !byName.get(e.card.name)?.size).reduce((n, e) => n + e.quantity, 0),
  };
}
export const escapeTagText = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export function tagBadges(sheet: Sheet, name: string): string {
  const tags = tagsForCard(sheet, name);
  if (!tags.length) return '';
  return `<span class="lab-tag-badges" title="${escapeTagText(tags.map(t => t.name).join(' · '))}">${tags.slice(0, 2).map(t => `<span>${escapeTagText(t.name)}</span>`).join('')}${tags.length > 2 ? `<span>+${tags.length - 2}</span>` : ''}</span>`;
}
export function roleSummary(sheet: Sheet): string {
  const { roles, untagged } = roleStatistics(sheet);
  return `<section class="lab-role-summary"><h4>Rôles fonctionnels</h4><p>Tags manuels · commandants inclus, candidats et cartes écartées exclus. Une carte peut compter dans plusieurs rôles.</p>${roles.length ? `<div class="lab-role-counts">${roles.map(r => `<div title="${escapeTagText(r.description)}"><span>${escapeTagText(r.name)}</span><strong>${r.count}${r.target !== undefined ? ` / ${r.target}` : ''}</strong>${r.target !== undefined ? '<small>ta cible</small>' : ''}</div>`).join('')}</div>` : '<p>Attribue des tags pour voir les rôles de ton deck.</p>'}<p>${untagged} carte${untagged > 1 ? 's' : ''} sans tag. Les cibles sont facultatives et définies par toi.</p><button type="button" data-action="manage-tags">Gérer les tags et les cibles</button></section>`;
}
