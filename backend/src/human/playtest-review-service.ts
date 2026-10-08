import { and, desc, eq, sql } from 'drizzle-orm';
import type { AsphodelDatabase } from '../db/client.js';
import { playtestReviews } from '../db/schema.js';
import { parsePlaytestFeedback, parsePlaytestReview, summarizeReview, type PlaytestReview } from '../../../shared/playtest-review.mjs';
import { AppError } from '../app-errors.js';

export class PlaytestReviewService {
  constructor(private readonly db: AsphodelDatabase) {}
  async create(review: PlaytestReview) {
    const state = parsePlaytestReview(review);
    await this.db.insert(playtestReviews).values({sessionId:state.sessionId,projectId:state.humanDeck.projectId ?? null,
      startedAt:state.startedAt,revision:state.revision,state});
  }
  async get(sessionId: string): Promise<PlaytestReview> {
    const [row] = await this.db.select().from(playtestReviews).where(eq(playtestReviews.sessionId,sessionId));
    if (!row) throw new AppError('Ce bilan de partie est introuvable.',404,'REVIEW_NOT_FOUND');
    return parsePlaytestReview(row.state);
  }
  async list(projectId?: string, offset = 0) {
    const rows = await this.db.select().from(playtestReviews).where(projectId ? eq(playtestReviews.projectId,projectId) : undefined)
      .orderBy(desc(playtestReviews.startedAt),desc(playtestReviews.sessionId)).limit(51).offset(offset);
    return {reviews:rows.slice(0,50).map(r=>summarizeReview(parsePlaytestReview(r.state))),nextOffset:rows.length>50 ? offset+50 : null};
  }
  async finish(sessionId: string, ending: Pick<PlaytestReview,'status'|'turns'|'outcome'|'reason'|'error'|'events'|'omittedEvents'>) {
    await this.db.transaction(async tx => {
      const [row] = await tx.select().from(playtestReviews).where(eq(playtestReviews.sessionId,sessionId));
      if (!row) return; // A restored archive can omit a now-terminal session.
      const state = parsePlaytestReview({...row.state,...ending,finishedAt:new Date().toISOString()});
      await tx.update(playtestReviews).set({state}).where(eq(playtestReviews.sessionId,sessionId));
    });
  }
  async feedback(sessionId: string, revision: number, value: unknown) {
    const review = await this.get(sessionId);
    if (review.status === 'running') throw new AppError('Termine la partie avant de noter son bilan.',409,'REVIEW_NOT_READY');
    let feedback;
    try { feedback = parsePlaytestFeedback(value,review.humanDeck); }
    catch { throw new AppError('Retours invalides ou carte absente du deck joué.',400,'INVALID_REVIEW'); }
    const state = {...review,feedback,revision:revision+1};
    const rows = await this.db.update(playtestReviews).set({state,revision:state.revision})
      .where(and(eq(playtestReviews.sessionId,sessionId),eq(playtestReviews.revision,revision))).returning();
    if (!rows.length) throw new AppError('Ce bilan a changé. Rouvre-le avant de remplacer ses retours.',409,'REVIEW_CHANGED');
    return parsePlaytestReview(rows[0]!.state);
  }
  async interruptRunning() {
    const rows = await this.db.select().from(playtestReviews).where(sql`json_extract(${playtestReviews.state}, '$.status') = 'running'`);
    for (const row of rows) if (row.state.status === 'running') await this.finish(row.sessionId, {
      status:'interrupted',turns:row.state.turns,outcome:null,reason:'Application fermée avant la fin de l’essai.',error:null,events:row.state.events,omittedEvents:row.state.omittedEvents,
    });
  }
}
