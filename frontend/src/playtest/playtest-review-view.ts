import { apiRequest } from '../api/api-client';
import { reviewCardKey, type PlaytestReview, type ReviewSummary } from '../../../shared/playtest-review.mjs';
import './playtest-review.css';
const mountedReviews=new Map<HTMLElement,{dirty:()=>boolean;persist:()=>Promise<PlaytestReview>}>();
export async function flushPlaytestReviews(): Promise<boolean> {
  try {for(const [root,handle] of mountedReviews) {if(!root.isConnected) {mountedReviews.delete(root);continue;} if(handle.dirty()) await handle.persist();}return true;} catch {return false;}
}
export const reviewStatus = {running:'En cours',completed:'Terminée',ended_by_human:'Arrêtée par toi',failed:'Échec',interrupted:'Interrompue'};
const verdictLabels = {keep:'À garder',test:'À retester',cut:'À couper'};
function node<K extends keyof HTMLElementTagNameMap>(tag: K, text = '') {
  const el = document.createElement(tag); el.textContent = text; return el;
}
export function getReview(sessionId: string): Promise<PlaytestReview> { return apiRequest(`/playtests/reviews/${encodeURIComponent(sessionId)}`); }
export type ReviewReturn = (review: PlaytestReview) => Promise<void>;

export function mountPlaytestReview(root: HTMLElement, initial: PlaytestReview, returnToTable?: ReviewReturn) {
  for(const root of mountedReviews.keys()) if(!root.isConnected) mountedReviews.delete(root);
  let review = structuredClone(initial), feedback = structuredClone(review.feedback), saving = false;
  const dirty = () => JSON.stringify(feedback) !== JSON.stringify(review.feedback);
  root.classList.add('playtest-review');
  const title = node('h2','Bilan de l’essai'), context = node('p',`${review.humanDeck.name} · ${review.humanDeck.versionName ?? 'Travail au départ'}`);
  const summary = node('p',`${reviewStatus[review.status]} · ${new Date(review.startedAt).toLocaleString()} · ${review.turns === null ? 'Tour inconnu' : `Tour ${review.turns}`} · ${review.playMode === 'physical' ? 'Physique' : 'Digital'} · Graine ${review.seed}`);
  const against = node('p',`Contre ${review.opponents.map(d=>d.name).join(' / ')}${review.outcome ? ` · ${review.outcome==='human' ? 'Victoire' : review.outcome==='draw' ? 'Égalité' : 'Défaite'}` : ''}`);
  root.replaceChildren(title,context,summary,against);
  if (review.reason) root.append(node('p',review.reason)); if (review.error) root.append(node('p',review.error));
  const list = node('details'), listTitle = node('summary',`Liste figée au départ · ${review.humanDeck.cards.reduce((n,c)=>n+c.quantity,0)} cartes`);
  const listBody = node('ul'); for (const c of review.humanDeck.cards) listBody.append(node('li',`${c.quantity} × ${c.name}${c.section==='commander' ? ' · Commandant' : ''}`));
  list.append(listTitle,node('p','Cette liste reste celle de l’essai même si tu modifies ou supprimes le deck ensuite.'),listBody); root.append(list);
  const events = node('details'); events.append(node('summary',`Journal public · ${review.events.length} événements conservés`));
  events.append(node('p','Actions et changements publics relevés pendant l’essai. Ce journal ne reconstitue pas toutes les décisions de la partie.'));
  if (review.omittedEvents) events.append(node('p',`${review.omittedEvents} événements plus anciens omis.`));
  const log = node('ol'); for (const e of review.events) log.append(node('li',`T${e.turn} · ${e.phase} — ${e.text}`));
  if (!review.events.length) events.append(node('p','Aucun événement public relevé.')); events.append(log); root.append(events);
  if (review.status === 'running') { root.append(node('p','Le bilan pourra être annoté une fois la partie terminée.')); return {dirty,persist:async()=>review}; }
  const fields = node('fieldset'); fields.append(node('legend','Tes retours'));
  const noteLabel = node('label','Ce qui a fonctionné, ce qui a manqué, l’idée suivante…'), note = node('textarea');
  note.maxLength=10000; note.rows=5; note.value=feedback.note; noteLabel.append(note); fields.append(noteLabel);
  const rows = node('div'); rows.className='review-card-notes'; fields.append(rows);
  const add = node('div'); add.className='review-add-card';
  const cardLabel = node('label','Carte du deck joué'), cards = node('select');
  const names = [...new Map(review.humanDeck.cards.map(c=>[reviewCardKey(c.name),c.name])).values()].sort((a,b)=>a.localeCompare(b));
  for (const name of names) { const option=node('option',name); option.value=name; cards.append(option); } cardLabel.append(cards);
  const addButton=node('button','Noter cette carte'); addButton.type='button'; add.append(cardLabel,addButton); fields.append(add); root.append(fields);
  const feedbackLine=node('p'); feedbackLine.setAttribute('role','status');
  const buttons=node('div'); buttons.className='review-actions'; const save=node('button','Enregistrer le bilan'); save.type='button';
  buttons.append(save); root.append(feedbackLine,buttons);
  function changed() { feedbackLine.textContent='Retours à enregistrer.'; }
  note.addEventListener('input',()=>{feedback.note=note.value;changed();});
  function renderCards() {
    rows.replaceChildren();
    for (const item of feedback.cards) {
      const row=node('div'); row.className='review-card-note'; const name=node('strong',item.name);
      const verdictLabel=node('label','Décision'), verdict=node('select');
      for (const [key,label] of Object.entries(verdictLabels)) { const option=node('option',label); option.value=key; verdict.append(option); } verdict.value=item.verdict;
      verdict.addEventListener('change',()=>{item.verdict=verdict.value as typeof item.verdict;changed();}); verdictLabel.append(verdict);
      const reasonLabel=node('label','Pourquoi ?'), reason=node('textarea'); reason.rows=2;reason.maxLength=1000;reason.value=item.note;
      reason.addEventListener('input',()=>{item.note=reason.value;changed();}); reasonLabel.append(reason);
      const remove=node('button','Retirer ce retour'); remove.type='button';remove.onclick=()=>{feedback.cards=feedback.cards.filter(c=>c!==item);renderCards();changed();};
      row.append(name,verdictLabel,reasonLabel,remove); rows.append(row);
    }
  }
  addButton.onclick=()=>{
    if (!cards.value || feedback.cards.some(c=>reviewCardKey(c.name)===reviewCardKey(cards.value))) return;
    if (feedback.cards.length>=1000) {feedbackLine.textContent='Le bilan contient déjà 1 000 retours de cartes.';return;}
    feedback.cards.push({name:cards.value,verdict:'test',note:''});renderCards();changed();
  };
  async function persist() {
    if (!dirty()) return review;
    if (saving) throw new Error('Enregistrement en cours.');
    saving=true;fields.disabled=true;save.disabled=true;
    try {
      review=await apiRequest(`/playtests/reviews/${encodeURIComponent(review.sessionId)}/feedback`,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({revision:review.revision,feedback})});
      feedback=structuredClone(review.feedback);renderCards();feedbackLine.textContent='Bilan enregistré.';return review;
    } finally {saving=false;fields.disabled=false;save.disabled=false;}
  }
  save.onclick=()=>{void persist().catch(error=>{feedbackLine.textContent=error instanceof Error ? error.message : 'Enregistrement impossible.';});};
  if (returnToTable && review.humanDeck.projectId && review.humanDeck.sourceDeckId) {
    const back=node('button','Retour à la table avec ces retours');back.type='button';
    const hint=node('p','Les retours deviennent des notes sur la table actuelle. Les quantités restent celles que tu as construites ; couper une carte reste ta décision.');
    back.onclick=()=>{back.disabled=true;void persist().then(returnToTable).catch(error=>{feedbackLine.textContent=error instanceof Error ? error.message : 'Retour impossible.';}).finally(()=>{back.disabled=false;});};
    root.append(hint);buttons.append(back);
  }
  renderCards(); const handle={dirty,persist};mountedReviews.set(root,handle);return handle;
}

export function openPlaytestHistory(projectId?: string, returnToTable?: ReviewReturn): HTMLDialogElement {
  const dialog=node('dialog');dialog.className='playtest-history'; const header=node('header'),title=node('h2',projectId ? 'Essais de ce deck' : 'Carnet d’essais'),close=node('button','Fermer');close.type='button';header.append(title,close);
  const content=node('div');dialog.append(header,content);let mounted: ReturnType<typeof mountPlaytestReview> | undefined;
  let requestGeneration=0;
  function canLeave() {return !mounted?.dirty() || window.confirm('Des retours ne sont pas enregistrés. Les abandonner ?');}
  close.onclick=()=>{if(canLeave())dialog.close();};dialog.addEventListener('cancel',event=>{if(!canLeave())event.preventDefault();});
  dialog.addEventListener('close',()=>{requestGeneration++;dialog.remove();},{once:true});
  async function showList() {
    mounted=undefined;const generation=++requestGeneration;content.replaceChildren(node('p','Chargement des essais…'));
    const entries=node('div');let offset:number|null=0;
    const more=node('button','Charger les essais précédents');more.type='button';const status=node('p');status.setAttribute('role','status');
    async function load() {
      if (offset===null) return;more.disabled=true;
      try {
        const query=new URLSearchParams({offset:String(offset)});if(projectId)query.set('projectId',projectId);
        const page=await apiRequest<{reviews:ReviewSummary[];nextOffset:number|null}>(`/playtests/reviews?${query}`);
        if (generation!==requestGeneration) return;
        offset=page.nextOffset;status.textContent='';
        if (!page.reviews.length && !entries.children.length) status.textContent='Aucun essai enregistré pour le moment. Lance une partie depuis le builder pour garder ta première référence.';
        for (const r of page.reviews) {
          const button=node('button',`${r.deckName} · ${r.versionName} — ${reviewStatus[r.status]} · ${r.turns ?? '?'} tours · ${new Date(r.startedAt).toLocaleString()}${r.annotatedCards || r.hasNote ? ' · Avec retours' : ''}`);
          button.type='button';button.onclick=()=>{void showReview(r.sessionId);};entries.append(button);
        }
        content.replaceChildren(entries,status,more);more.hidden=offset===null;
      } catch(error) {if(generation===requestGeneration){status.textContent=error instanceof Error ? error.message : 'Chargement impossible.';content.replaceChildren(entries,status,more);}}
      finally {more.disabled=false;}
    }
    more.onclick=()=>{void load();};await load();
  }
  async function showReview(id: string) {
    const generation=++requestGeneration;content.replaceChildren(node('p','Chargement du bilan…'));
    try {
      const review=await getReview(id);if(generation!==requestGeneration)return;
      const back=node('button','← Tous les essais');back.type='button';back.onclick=()=>{if(canLeave())void showList();};const body=node('section');content.replaceChildren(back,body);
      mounted=mountPlaytestReview(body,review,returnToTable ? async r=>{await returnToTable(r);dialog.close();} : undefined);
    } catch(error) {if(generation===requestGeneration){content.replaceChildren(node('p',error instanceof Error ? error.message : 'Bilan indisponible.'));const retry=node('button','Revenir aux essais');retry.onclick=()=>{void showList();};content.append(retry);}}
  }
  document.body.append(dialog);dialog.showModal();void showList();return dialog;
}
