import type { AgentCardObservation } from './types.js';

/** Only compares two values supplied by Forge; does not evaluate effects or layers. */
export function statTone(value: number | null, base: number | null | undefined): string {
  return value == null || base == null || value === base ? 'neutral' : value > base ? 'raised' : 'lowered';
}

export function statPlaque(card: AgentCardObservation): HTMLElement {
  const plaque = document.createElement('span');
  plaque.className = 'table-card-stats';
  for (const [index, field] of (['power', 'toughness'] as const).entries()) {
    if (index) plaque.append('/');
    const value = document.createElement('span');
    const base = field === 'power' ? card.basePower : card.baseToughness;
    value.dataset.tone = statTone(card[field], base);
    value.textContent = String(card[field] ?? '—');
    value.title = `${field}: ${card[field]}${base == null ? '' : ` (base ${base})`}`;
    plaque.append(value);
  }
  return plaque;
}
