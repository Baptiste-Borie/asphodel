import { asc, inArray } from 'drizzle-orm';
import type { AsphodelDatabase } from '../db/client.js';
import { cards, decks, deckEntries, deckProjects, playtestReviews } from '../db/schema.js';
import { parsePlaytestReview } from '../../../shared/playtest-review.mjs';
import { parseLibrarySnapshot, type LibrarySnapshot } from '../../../shared/library-backup.mjs';

/** A portable library, independent of catalogue files, image cache and SQLite version. */
export class LibraryBackupService {
  constructor(private readonly db: AsphodelDatabase) {}

  async snapshot(): Promise<LibrarySnapshot> {
    return this.db.transaction(async tx => {
      const savedDecks = await tx.select().from(decks).orderBy(asc(decks.id));
      const entries = await tx.select().from(deckEntries).orderBy(asc(deckEntries.deckId), asc(deckEntries.categoryPosition), asc(deckEntries.cardId));
      const cardIds = [...new Set(entries.map(e => e.cardId))];
      const savedCards: LibrarySnapshot['cards'] = [];
      for (let i = 0; i < cardIds.length; i += 500) {
        savedCards.push(...await tx.select().from(cards).where(inArray(cards.id, cardIds.slice(i, i + 500))));
      }
      const projects = await tx.select().from(deckProjects).orderBy(asc(deckProjects.deckId));
      const names = new Map(savedDecks.map(d => [d.id, d.name]));
      return parseLibrarySnapshot({
        reviews: (await tx.select().from(playtestReviews)).map(r=>r.state),
        decks: savedDecks.map(d => ({ ...d, createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString() })),
        cards: savedCards.sort((a,b) => a.id-b.id), entries,
        projects: projects.map(p => ({ ...p, state: { ...p.state, name: names.get(p.deckId)! } })),
      });
    });
  }

  async restore(value: unknown): Promise<void> {
    const archive = parseLibrarySnapshot(value);
    // No network resolution: even a fresh, offline profile can restore these cards.
    await this.db.transaction(async tx => {
      await tx.delete(playtestReviews);
      await tx.delete(decks); // cascades only user deck entries/projects; catalogue rows stay available
      const cardIds = new Map<number, number>();
      for (const c of archive.cards) {
        const { id: oldId, ...fields } = c;
        const [row] = await tx.insert(cards).values(fields).onConflictDoUpdate({ target: cards.normalizedName, set: fields }).returning({ id: cards.id });
        cardIds.set(oldId, row!.id);
      }
      for (const d of archive.decks) {
        await tx.insert(decks).values({ ...d, createdAt: new Date(d.createdAt), updatedAt: new Date(d.updatedAt) });
      }
      // Bounded batches keep SQLite's parameter limit independent of library size.
      for (let i = 0; i < archive.entries.length; i += 100) {
        await tx.insert(deckEntries).values(archive.entries.slice(i, i + 100).map(e => ({ ...e, cardId: cardIds.get(e.cardId)! })));
      }
      for (const p of archive.projects) await tx.insert(deckProjects).values(p);
      for (const r of archive.reviews ?? []) {
        const state = parsePlaytestReview(r.status === 'running' ? {...r,status:'interrupted',finishedAt:new Date().toISOString(),reason:'Essai en cours lors de la sauvegarde.'} : r);
        await tx.insert(playtestReviews).values({sessionId:state.sessionId,projectId:state.humanDeck.projectId ?? null,startedAt:state.startedAt,revision:state.revision,state});
      }
    });
  }
}
