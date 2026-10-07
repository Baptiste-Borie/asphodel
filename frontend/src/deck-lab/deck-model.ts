import type { LabCard } from '../../../shared/deck-lab';
import type { ProjectGroup, ProjectWorkspace } from '../../../shared/builder-project.mjs';
import type { ProjectTags } from '../../../shared/deck-tags.mjs';

export type Group = ProjectGroup;
export type Sheet = { name: string; groups: Group[]; cuts: LabCard[]; backendId?: number; projectId?: string; workspace?: ProjectWorkspace; tags?: ProjectTags };

/** Business statistics never depend on spatial placement. */
export function deckStatistics(groups: Group[]) {
  const entries = groups.filter(g => !g.maybeboard).flatMap(g => g.entries);
  const total = entries.reduce((n, e) => n + e.quantity, 0);
  const nonlands = entries.filter(e => !e.card.type_line.includes('Land'));
  const spells = nonlands.reduce((n, e) => n + e.quantity, 0);
  const curve = Array.from({ length: 8 }, (_, i) => nonlands.filter(e => Math.min(7, e.card.cmc) === i).reduce((n, e) => n + e.quantity, 0));
  const types = ['Creature', 'Instant', 'Sorcery', 'Artifact', 'Enchantment', 'Planeswalker', 'Land'].map(name => ({ name, count: entries.filter(e => e.card.type_line.includes(name)).reduce((n, e) => n + e.quantity, 0) }));
  const average = spells ? nonlands.reduce((n, e) => n + e.card.cmc * e.quantity, 0) / spells : 0;
  return { entries, total, nonlands, spells, curve, types, average };
}
