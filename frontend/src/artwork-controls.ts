import type { BuilderProject } from '../../shared/builder-project.mjs';
import type { ArtworkState, ArtworkPlan } from '../../shared/artwork.mjs';
import { collectDeckArtwork } from './deck-lab/deck-artwork';
import './artwork-controls.css';

const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const size=(bytes:number)=>`${(bytes/1024/1024).toLocaleString('fr-FR',{maximumFractionDigits:1})} Mo`;
const friendly=(error:unknown)=>error instanceof Error?error.message.replace(/^Error invoking remote method '[^']+': Error: /,''):'Opération impossible. Réessaie.';
const phases={downloading:'Téléchargement en cours',paused:'En pause',completed:'Images préparées',partial:'Préparation incomplète',canceled:'Téléchargement annulé'};
function jobHTML(state:ArtworkState|null) {
  const job=state?.job;
  if(!job)return '<p>Aucun téléchargement en cours.</p>';
  return `<h4>${esc(job.name)}</h4><p>${phases[job.status]} · ${job.cached} / ${job.total} illustrations disponibles${job.active?` · ${job.active} en cours`:''}</p><progress max="${job.total||1}" value="${job.cached}" aria-label="Illustrations disponibles hors ligne"></progress>${job.unavailable?`<p>${job.unavailable} carte(s) sans illustration prise en charge : le texte reste disponible.</p>`:''}${job.error?`<p class="artwork-error">${esc(job.error)}</p>`:''}`;
}

/** A preparation uses a frozen deck snapshot; browsing alone starts no download. */
export function openDeckArtwork(project:BuilderProject) {
  const desktop=window.asphodelDesktop;if(!desktop?.planArtwork)return;
  const previous=document.querySelector<HTMLDialogElement>('.artwork-dialog');previous?.close();previous?.remove();
  const dialog=document.createElement('dialog');dialog.className='artwork-dialog';dialog.setAttribute('aria-labelledby','artwork-title');
  dialog.innerHTML=`<header><div><p>HORS LIGNE</p><h2 id="artwork-title">Préparer ${esc(project.name)}</h2></div><button type="button" data-art-close aria-label="Fermer la préparation hors ligne">×</button></header><section><label><input type="checkbox" data-art-ideas> Inclure les candidats et cartes écartées</label><p data-art-plan>Vérification des images déjà présentes…</p><p class="artwork-hint">Seule l’illustration choisie et ses faces sont préparées. L’estimation utilise environ 100 Ko par image ; la taille réelle peut varier.</p><button type="button" data-art-start disabled>Préparer ces images</button><p class="artwork-hint">Les images de cette préparation seront protégées du nettoyage automatique.</p></section><section><div data-art-job></div><div class="artwork-actions"><button type="button" data-art-control="pause">Pause</button><button type="button" data-art-control="resume">Reprendre les images manquantes</button><button type="button" data-art-control="cancel">Annuler le téléchargement</button></div><p>Fermer cette fenêtre laisse le téléchargement continuer. Quitter Asphodel le met en pause ; les images terminées sont conservées.</p></section><p data-art-feedback role="status"></p><footer><button type="button" data-art-close>Terminé</button></footer>`;
  document.body.append(dialog);
  const get=<T extends HTMLElement>(s:string)=>dialog.querySelector<T>(s)!;
  let timer:ReturnType<typeof setInterval>|undefined,state:ArtworkState|null=null,plan:ArtworkPlan|null=null,busy=false,polling=false,version=0;
  const request=()=>collectDeckArtwork(project,get<HTMLInputElement>('[data-art-ideas]').checked);
  function render() {
    if(plan)get('[data-art-plan]').textContent=`${plan.cached} / ${plan.total} illustrations déjà présentes · ${plan.missing} à télécharger · environ ${size(plan.estimatedBytes)}${plan.unavailable?` · ${plan.unavailable} carte(s) sans image prise en charge`:''}`;
    get('[data-art-job]').innerHTML=jobHTML(state);
    const job=state?.job;
    get<HTMLButtonElement>('[data-art-start]').disabled=busy||!plan||!!state?.recoveryError||!!job?.active||job?.status==='downloading';
    get<HTMLButtonElement>('[data-art-control=pause]').disabled=busy||job?.status!=='downloading';
    get<HTMLButtonElement>('[data-art-control=resume]').disabled=busy||!job||!!job.active||job.status==='downloading'||job.status==='completed';
    get<HTMLButtonElement>('[data-art-control=cancel]').disabled=busy||!job||job.status==='completed'||job.status==='canceled';
    if(state?.recoveryError)get('[data-art-feedback]').textContent=state.recoveryError;
  }
  async function refresh() {
    if(polling||!dialog.open)return;polling=true;const current=++version;
    try {const [next,nextPlan]=await Promise.all([desktop!.getArtworkState(),desktop!.planArtwork(request())]);if(!dialog.open||current!==version)return;state=next;plan=nextPlan;render();}
    catch(error){if(dialog.open)get('[data-art-feedback]').textContent=friendly(error);}
    finally {polling=false;}
  }
  async function action(work:()=>Promise<ArtworkState>) {
    if(busy)return;busy=true;get('[data-art-feedback]').textContent='';render();
    try {state=await work();await refresh();}
    catch(error){get('[data-art-feedback]').textContent=friendly(error);}
    finally {busy=false;if(dialog.open)render();}
  }
  dialog.querySelectorAll<HTMLButtonElement>('[data-art-close]').forEach(b=>b.addEventListener('click',()=>dialog.close()));
  get('[data-art-start]').addEventListener('click',()=>void action(()=>desktop.prepareArtwork(request())));
  dialog.querySelectorAll<HTMLButtonElement>('[data-art-control]').forEach(b=>b.addEventListener('click',()=>void action(()=>desktop.controlArtwork(b.dataset.artControl as 'pause'|'resume'|'cancel'))));
  get('[data-art-ideas]').addEventListener('change',()=>{version++;plan=null;render();void refresh();});
  dialog.addEventListener('close',()=>{version++;clearInterval(timer);dialog.remove();});
  dialog.showModal();void refresh();timer=setInterval(()=>void refresh(),1000);
}

export function mountArtworkSettings(root:HTMLElement) {
  const desktop=window.asphodelDesktop;
  root.innerHTML='<h3>Images et hors-ligne</h3><p data-art-storage>Lecture du cache…</p><label>Limite du cache sur ce PC (Mo)<input data-art-limit type="number" min="50" max="10240" step="1"></label><div class="artwork-actions"><button type="button" data-art-save-limit>Enregistrer la limite</button><button type="button" data-art-purge>Libérer le cache non protégé</button><button type="button" data-art-reset hidden>Réinitialiser les réglages du cache</button></div><p>Le nettoyage conserve les images des decks protégés et celles incluses dans l’installation. Il ne modifie pas tes decks, leurs notes ou leurs illustrations choisies.</p><div data-art-settings-job></div><div class="artwork-actions"><button type="button" data-art-settings-control="pause">Pause</button><button type="button" data-art-settings-control="resume">Reprendre</button><button type="button" data-art-settings-control="cancel">Annuler</button></div><h4>Préparations sur ce PC</h4><div data-art-decks></div><p data-art-settings-feedback role="status"></p>';
  const get=<T extends HTMLElement>(s:string)=>root.querySelector<T>(s)!;
  let timer:ReturnType<typeof setInterval>|undefined,state:ArtworkState|null=null,busy=false,polling=false,alive=false;
  const rows=new Map<string,HTMLElement>();
  function render() {
    if(!state)return;
    get('[data-art-storage]').textContent=`${size(state.usedBytes)} utilisés sur ${size(state.limitBytes)} · ${size(state.protectedBytes)} protégés · ${size(state.reclaimableBytes)} libérables. Images de l’installation : ${size(state.bundledBytes)}.`;
    const input=get<HTMLInputElement>('[data-art-limit]');if(document.activeElement!==input)input.value=String(Math.round(state.limitBytes/1024/1024));
    get<HTMLButtonElement>('[data-art-purge]').disabled=busy||!!state.recoveryError||!state.reclaimableBytes;
    get<HTMLButtonElement>('[data-art-reset]').hidden=!state.recoveryError;
    get<HTMLButtonElement>('[data-art-save-limit]').disabled=busy||!!state.recoveryError;
    get('[data-art-settings-job]').innerHTML=jobHTML(state);
    const job=state.job;
    get<HTMLButtonElement>('[data-art-settings-control=pause]').disabled=busy||job?.status!=='downloading';
    get<HTMLButtonElement>('[data-art-settings-control=resume]').disabled=busy||!job||!!job.active||job.status==='downloading'||job.status==='completed';
    get<HTMLButtonElement>('[data-art-settings-control=cancel]').disabled=busy||!job||job.status==='completed'||job.status==='canceled';
    for(const [id,node] of rows)if(!state.decks.some(d=>d.id===id)){node.remove();rows.delete(id);}
    for(const deck of state.decks){let row=rows.get(deck.id);if(!row){row=document.createElement('article');row.className='artwork-deck';row.innerHTML=`<strong></strong><p></p><label><input type="checkbox" data-art-keep="${esc(deck.id)}"> Garder hors ligne</label><button type="button" data-art-forget="${esc(deck.id)}">Retirer cette préparation</button>`;rows.set(deck.id,row);get('[data-art-decks]').append(row);}
      row.querySelector('strong')!.textContent=deck.name;row.querySelector('p')!.textContent=`${deck.cached} / ${deck.total} illustrations présentes${deck.unavailable?` · ${deck.unavailable} carte(s) sans image`:''}${deck.missing?' · préparation à compléter':' · images disponibles'}`;
      const keep=row.querySelector<HTMLInputElement>('input')!;if(document.activeElement!==keep||!busy)keep.checked=deck.keep;keep.disabled=busy;
      row.querySelector<HTMLButtonElement>('button')!.disabled=busy||!!job?.active&&job.id===deck.id||job?.status==='downloading'&&job.id===deck.id;
    }
    if(state.recoveryError)get('[data-art-settings-feedback]').textContent=state.recoveryError+' Réinitialiser conserve les fichiers d’images et une copie des anciens réglages.';
  }
  async function refresh() {alive=true;if(!timer)timer=setInterval(()=>void poll(),1000);await poll();}
  async function poll() {if(!alive||polling||!desktop?.getArtworkState)return;polling=true;try{const next=await desktop.getArtworkState();if(alive){state=next;render();}}catch(error){if(alive)get('[data-art-settings-feedback]').textContent=friendly(error);}finally{polling=false;}}
  async function action(work:()=>Promise<ArtworkState>) {if(busy||!desktop)return;busy=true;get('[data-art-settings-feedback]').textContent='';render();try{state=await work();}catch(error){get('[data-art-settings-feedback]').textContent=friendly(error);}finally{busy=false;if(alive)render();}}
  root.addEventListener('click',e=>{const b=(e.target as HTMLElement).closest<HTMLButtonElement>('button');if(!b||!desktop)return;
    if(b.matches('[data-art-save-limit]')){const mb=Number(get<HTMLInputElement>('[data-art-limit]').value);void action(()=>desktop.setArtworkLimit(mb*1024*1024));}
    if(b.matches('[data-art-purge]'))void action(()=>desktop.purgeArtwork());
    if(b.matches('[data-art-reset]'))void action(()=>desktop.resetArtworkSettings());
    if(b.dataset.artForget)void action(()=>desktop.forgetArtwork(b.dataset.artForget!));
    if(b.dataset.artSettingsControl)void action(()=>desktop.controlArtwork(b.dataset.artSettingsControl as 'pause'|'resume'|'cancel'));
  });
  root.addEventListener('change',e=>{const input=e.target as HTMLInputElement;if(input.dataset.artKeep&&desktop)void action(()=>desktop.setArtworkKeep(input.dataset.artKeep!,input.checked));});
  return {refresh:()=>{void refresh();},stop(){alive=false;clearInterval(timer);timer=undefined;}};
}
