import type { LabCard } from '../../../shared/deck-lab';
import type { Sheet } from './deck-model';

export type TrialCard = { id: string; card: LabCard; roles: string[] };
export function trialSnapshot(sheet: Sheet) {
  const included = sheet.groups.filter(g => !g.commander && !g.maybeboard).flatMap(g => g.entries);
  const size = included.reduce((n, e) => n + e.quantity, 0);
  if (!Number.isSafeInteger(size) || size < 1 || size > 5000 || included.some(e => !Number.isSafeInteger(e.quantity) || e.quantity < 1)) throw new Error('L’essai nécessite une bibliothèque de 1 à 5 000 cartes, avec des quantités entières positives.');
  const cards: TrialCard[] = [];
  for (const e of included) {
    const tagIds = sheet.tags?.cards.find(c => c.name === e.card.name)?.tagIds ?? [];
    const roles = sheet.tags?.definitions.filter(d => tagIds.includes(d.id)).map(d => d.name) ?? [];
    for (let i = 0; i < e.quantity; i++) cards.push({ id: String(cards.length), card: structuredClone(e.card), roles: [...roles] });
  }
  return { name: sheet.name, cards, commanders: structuredClone(sheet.groups.filter(g => g.commander).flatMap(g => g.entries)) };
}
/** Seeded xorshift32. Rejection sampling avoids modulo bias for a bounded shuffle index. */
function generator(seed: string) {
  let state = 2166136261;
  for (const c of seed) { state ^= c.codePointAt(0)!; state = Math.imul(state, 16777619); }
  state = state >>> 0 || 1;
  return (bound: number) => {
    const limit = Math.floor(0xffffffff / bound) * bound;
    let value: number;
    do { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; value = (state >>> 0) - 1; } while (value >= limit);
    return value % bound;
  };
}
export class OpeningHandTrial {
  readonly snapshot: ReturnType<typeof trialSnapshot>;
  readonly seed: string;
  readonly freeFirst: boolean;
  private random: (bound: number) => number;
  hand: TrialCard[] = [];
  library: TrialCard[] = [];
  bottom: string[] = [];
  mulligans = 0;
  kept = false;
  drawn = 0;
  constructor(sheet: Sheet, seed: string, freeFirst = true) {
    this.snapshot = trialSnapshot(sheet); this.seed = seed; this.freeFirst = freeFirst;
    if (!seed.trim() || seed.length > 80) throw new Error('Choisis une graine de 1 à 80 caractères.');
    this.random = generator(seed); this.deal();
  }
  get penalty() { return Math.min(this.hand.length, Math.max(0, this.mulligans - (this.freeFirst ? 1 : 0))); }
  private deal() {
    const cards = [...this.snapshot.cards];
    for (let i = cards.length - 1; i > 0; i--) { const j = this.random(i + 1); [cards[i], cards[j]] = [cards[j]!, cards[i]!]; }
    this.hand = cards.slice(0, 7); this.library = cards.slice(7); this.bottom = []; this.kept = false; this.drawn = 0;
  }
  newHand() { this.mulligans = 0; this.deal(); }
  mulligan() {
    if (this.kept || this.penalty >= Math.min(7, this.snapshot.cards.length)) return false;
    this.mulligans++; this.deal(); return true;
  }
  toggleBottom(id: string) {
    if (this.kept || !this.hand.some(c => c.id === id)) return;
    const index = this.bottom.indexOf(id);
    if (index >= 0) this.bottom.splice(index, 1);
    else if (this.bottom.length < this.penalty) this.bottom.push(id);
  }
  keep() {
    if (this.kept || this.bottom.length !== this.penalty) return false;
    const bottom = this.bottom.map(id => this.hand.find(c => c.id === id)!);
    this.hand = this.hand.filter(c => !this.bottom.includes(c.id));
    this.library.push(...bottom); this.bottom = []; this.kept = true; return true;
  }
  draw() {
    if (!this.kept || !this.library.length) return false;
    this.hand.push(this.library.shift()!); this.drawn++; return true;
  }
}
