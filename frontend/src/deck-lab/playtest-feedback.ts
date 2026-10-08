import type { Sheet } from './deck-model';
import type { PlaytestReview } from '../../../shared/playtest-review.mjs';
import { reviewCardKey } from '../../../shared/playtest-review.mjs';
import { prepareProject } from './project-persistence';
/** Explicit import, captured by the caller's normal construction history. Stable ids make repeats update existing notes. */
export function applyPlaytestFeedback(sheet: Sheet, review: PlaytestReview): number {
  if (!review.humanDeck.projectId || sheet.projectId !== review.humanDeck.projectId) throw new Error('Ces retours appartiennent à un autre projet.');
  prepareProject(sheet);const workspace=sheet.workspace!;
  const names=[...new Set(review.humanDeck.cards.map(c=>reviewCardKey(c.name)))].sort();
  const prefix=`review_${review.sessionId}_`,label=review.humanDeck.versionName ?? 'Travail au départ';
  const proposals: NonNullable<typeof workspace.notes> = [];
  if (review.feedback.note.trim()) proposals.push({id:prefix+'note',text:`Bilan · ${label} · ${new Date(review.startedAt).toLocaleDateString()}\n${review.feedback.note}`.slice(0,4000),color:'sand',x:70,y:-240});
  for (const item of review.feedback.cards) {
    const entry=sheet.groups.flatMap(g=>g.entries).find(e=>reviewCardKey(e.card.name)===reviewCardKey(item.name));
    const index=names.indexOf(reviewCardKey(item.name));
    proposals.push({id:prefix+'card_'+index,text:`${{keep:'À garder',test:'À retester',cut:'À couper'}[item.verdict]} · ${item.name}\nEssai : ${label}\n${item.note}${entry ? '' : '\nCarte absente du deck actuel.'}`,
      color:item.verdict==='keep' ? 'sage' : item.verdict==='cut' ? 'lavender' : 'sand',x:entry ? 190 : index%4*300,y:entry ? 0 : -500-Math.floor(index/4)*240,...(entry?.id ? {cardId:entry.id} : {})});
  }
  const previous=workspace.notes ?? [],ids=new Set(proposals.map(n=>n.id));
  const unrelated=previous.filter(n=>!n.id.startsWith(prefix));
  // Removed verdicts also remove their previously imported notes on this explicit repeat.
  if (unrelated.length+proposals.length>500) throw new Error('La table dépasserait 500 notes. Libère de la place avant d’y ajouter ce bilan.');
  workspace.notes=[...unrelated,...proposals.map(n=>{const old=previous.find(p=>p.id===n.id);return old ? {...n,x:old.x,y:old.y} : n;})];
  return ids.size;
}
