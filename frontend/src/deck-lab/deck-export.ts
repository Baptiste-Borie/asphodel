import type { Sheet } from './deck-model';

/** Collapse manual categories without counting candidates or cuts as played cards. */
export function exportDeckText(sheet: Sheet, includeCandidates = false): string {
  const sections = [
    { title: 'Commander', groups: sheet.groups.filter(g => g.commander) },
    { title: 'Mainboard', groups: sheet.groups.filter(g => !g.commander && !g.maybeboard) },
    ...(includeCandidates ? [{ title: 'Maybeboard', groups: sheet.groups.filter(g => g.maybeboard) }] : []),
  ];
  return sections.map(({ title, groups }) => {
    const counts = new Map<string, number>();
    for (const g of groups) for (const e of g.entries) {
      const name = e.card.name.replace(/[\r\n]+/g, ' ').trim();
      counts.set(name, (counts.get(name) ?? 0) + e.quantity);
    }
    return [title, ...[...counts].map(([name, quantity]) => `${quantity} ${name}`)].join('\n');
  }).join('\n\n') + '\n';
}

export function deckTextFilename(name: string): string {
  return (name.replace(/[\x00-\x1f<>:"/\\|?*]/g, '-').replace(/^\.+/, '').trim().slice(0,100) || 'deck') + '.txt';
}
