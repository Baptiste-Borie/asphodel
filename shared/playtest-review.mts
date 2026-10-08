/** Durable builder feedback. Only deck lists selected by the user and public event text cross this boundary. */
export type PlayedDeck = {
  name: string; cards: { name: string; quantity: number; section: 'commander' | 'mainboard' }[];
  sourceDeckId?: number; projectId?: string; versionId?: string; versionName?: string;
};
export type CardVerdict = 'keep' | 'test' | 'cut';
export type PlaytestFeedback = { note: string; cards: { name: string; verdict: CardVerdict; note: string }[] };
export type PlaytestReview = {
  sessionId: string; startedAt: string; finishedAt: string | null; seed: number; playMode: 'digital' | 'physical';
  status: 'running' | 'completed' | 'ended_by_human' | 'failed' | 'interrupted';
  humanDeck: PlayedDeck; opponents: PlayedDeck[]; turns: number | null;
  outcome: 'human' | 'asphodel' | 'draw' | null; reason: string | null; error: string | null;
  events: { id: number; turn: number; phase: string; text: string }[]; omittedEvents: number;
  feedback: PlaytestFeedback; revision: number;
};
export type ReviewSummary = Pick<PlaytestReview, 'sessionId' | 'startedAt' | 'finishedAt' | 'status' | 'turns' | 'outcome' | 'playMode'> & {
  deckName: string; versionName: string; opponentNames: string[]; annotatedCards: number; hasNote: boolean;
};
export const reviewCardKey = (name: string) => name.trim().normalize('NFKC').toLowerCase();
const string = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
const integer = (v: unknown, min = 0): v is number => Number.isSafeInteger(v) && (v as number) >= min;
const identifier = (v: unknown): v is string => string(v,100) && /^[a-zA-Z0-9_-]+$/.test(v);
const date = (v: unknown): v is string => string(v,40) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString() === v;
const fail = (): never => { throw new Error('Bilan de playtest invalide.'); };
export function parsePlayedDeck(value: unknown): PlayedDeck {
  const d = value as PlayedDeck;
  if (!d || !string(d.name,120) || !d.name.trim() || !Array.isArray(d.cards) || d.cards.length > 18000
    || !d.cards.every(c => c && string(c.name,200) && !!c.name.trim() && integer(c.quantity,1) && c.quantity <= 1000000 && ['commander','mainboard'].includes(c.section))
    || (d.sourceDeckId !== undefined && !integer(d.sourceDeckId,1)) || (d.projectId !== undefined && !identifier(d.projectId))
    || (d.versionId !== undefined && (!identifier(d.versionId) || !d.projectId || !string(d.versionName,80) || !d.versionName.trim()))
    || (d.versionName !== undefined && !string(d.versionName,80))) return fail();
  return { name: d.name, cards: d.cards.map(c=>({name:c.name,quantity:c.quantity,section:c.section})),
    ...(d.sourceDeckId === undefined ? {} : {sourceDeckId:d.sourceDeckId}), ...(d.projectId === undefined ? {} : {projectId:d.projectId}),
    ...(d.versionId === undefined ? {} : {versionId:d.versionId}), ...(d.versionName === undefined ? {} : {versionName:d.versionName}) };
}
export function parsePlaytestFeedback(value: unknown, deck: PlayedDeck): PlaytestFeedback {
  const f = value as PlaytestFeedback, names = new Set(deck.cards.map(c=>reviewCardKey(c.name)));
  if (!f || !string(f.note,10000) || !Array.isArray(f.cards) || f.cards.length > 1000
    || !f.cards.every(c => c && string(c.name,200) && names.has(reviewCardKey(c.name)) && ['keep','test','cut'].includes(c.verdict) && string(c.note,1000))
    || new Set(f.cards.map(c=>reviewCardKey(c.name))).size !== f.cards.length) return fail();
  return {note:f.note,cards:f.cards.map(c=>({name:deck.cards.find(d=>reviewCardKey(d.name)===reviewCardKey(c.name))!.name,verdict:c.verdict,note:c.note}))};
}
export function parsePlaytestReview(value: unknown): PlaytestReview {
  const r = value as PlaytestReview;
  if (!r || !identifier(r.sessionId) || !date(r.startedAt) || (r.finishedAt !== null && !date(r.finishedAt)) || !Number.isSafeInteger(r.seed)
    || !['digital','physical'].includes(r.playMode) || !['running','completed','ended_by_human','failed','interrupted'].includes(r.status)
    || (r.turns !== null && !integer(r.turns)) || (r.outcome !== null && !['human','asphodel','draw'].includes(r.outcome))
    || (r.reason !== null && !string(r.reason,2000)) || (r.error !== null && !string(r.error,4000))
    || !Array.isArray(r.opponents) || r.opponents.length < 1 || r.opponents.length > 2 || !Array.isArray(r.events) || r.events.length > 1000
    || !r.events.every(e=>e && integer(e.id,1) && integer(e.turn) && string(e.phase,100) && string(e.text,2000))
    || !integer(r.omittedEvents) || !integer(r.revision)) return fail();
  const humanDeck = parsePlayedDeck(r.humanDeck);
  return {sessionId:r.sessionId,startedAt:r.startedAt,finishedAt:r.finishedAt,seed:r.seed,playMode:r.playMode,status:r.status,humanDeck,
    opponents:r.opponents.map(parsePlayedDeck),turns:r.turns,outcome:r.outcome,reason:r.reason,error:r.error,
    events:r.events.map(e=>({id:e.id,turn:e.turn,phase:e.phase,text:e.text})),omittedEvents:r.omittedEvents,
    feedback:parsePlaytestFeedback(r.feedback,humanDeck),revision:r.revision};
}
export function summarizeReview(r: PlaytestReview): ReviewSummary {
  return {sessionId:r.sessionId,startedAt:r.startedAt,finishedAt:r.finishedAt,status:r.status,turns:r.turns,outcome:r.outcome,playMode:r.playMode,
    deckName:r.humanDeck.name,versionName:r.humanDeck.versionName ?? 'Travail au départ',opponentNames:r.opponents.map(d=>d.name),
    annotatedCards:r.feedback.cards.length,hasNote:!!r.feedback.note.trim()};
}
