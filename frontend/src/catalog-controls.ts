import type { CatalogState } from '../../shared/catalog.mjs';
import { openExtensionArtwork } from './artwork-controls';
const size = (bytes:number) => `${(bytes/1024/1024).toLocaleString('fr-FR',{maximumFractionDigits:1})} Mo`;
const date = (value:string|null) => value ? new Date(value).toLocaleString('fr-FR') : 'inconnue';
const phases = {downloading:'Téléchargement',verifying:'Vérification des cartes',indexing:'Préparation de la recherche',activating:'Finalisation',paused:'En pause',completed:'Catalogue prêt',canceled:'Téléchargement annulé'};
const errorText = (error:unknown) => error instanceof Error ? error.message.replace(/^Error invoking remote method '[^']+': Error: /,'') : 'Opération impossible. Réessaie.';
export function mountCatalogSettings(root:HTMLElement) {
  const desktop = window.asphodelDesktop;
  root.innerHTML = `<h3>Catalogue et extensions</h3><p data-catalog-info>Lecture du catalogue…</p><p data-catalog-space></p><p>Le catalogue contient les données de cartes pour rechercher et construire hors ligne. Ses images se téléchargent séparément.</p><div class="artwork-actions"><button type="button" data-catalog-check>Vérifier les mises à jour</button><button type="button" data-catalog-install disabled>Installer le catalogue</button><button type="button" data-catalog-restart hidden>Relancer pour utiliser ce catalogue</button><button type="button" data-catalog-cleanup disabled>Libérer les versions anciennes</button></div><p data-catalog-latest></p><p data-catalog-job></p><progress data-catalog-progress hidden aria-label="Téléchargement du catalogue"></progress><div class="artwork-actions"><button type="button" data-catalog-control="pause" disabled>Pause</button><button type="button" data-catalog-control="resume" disabled>Reprendre</button><button type="button" data-catalog-control="cancel" disabled>Annuler le téléchargement</button></div><p>Le catalogue utilisé reste disponible pendant la préparation. La relance utilise la fermeture habituelle et enregistre tes decks. Le catalogue précédent est conservé.</p><h4>Images d’une extension</h4><label>Extension du catalogue installé<select data-catalog-set disabled><option value="">Choisir une extension…</option></select></label><button type="button" data-catalog-extension disabled>Préparer les images de cette extension</button><p data-catalog-extension-info>Lecture des extensions…</p><p data-catalog-feedback role="status"></p>`;
  const get = <T extends HTMLElement>(s:string) => root.querySelector<T>(s)!;
  let state:CatalogState|null=null,busy=false,alive=false,polling=false,timer:ReturnType<typeof setInterval>|undefined,version=0,setsGeneration:string|undefined;
  function render() {
    if(!state)return;
    get('[data-catalog-info]').textContent = state.installed ? `Catalogue utilisé : ${date(state.updatedAt)}${state.printings?` · ${state.printings.toLocaleString('fr-FR')} impressions`:''}.` : 'Catalogue non installé. Tes decks enregistrés restent disponibles.';
    get('[data-catalog-space]').textContent = `${size(state.usedBytes)} occupés par les catalogues et préparations · ${size(state.reclaimableBytes)} libérables${state.availableBytes===null?'':` · ${size(state.availableBytes)} libres sur le disque`}.`;
    get('[data-catalog-latest]').textContent = `${state.latest?.updatedAt===state.updatedAt?'Catalogue déjà à jour. ':''}${state.latest?`Version proposée : ${date(state.latest.updatedAt)} · ${size(state.latest.bytes)} à télécharger, sans les images. L’index et les versions conservées demanderont de l’espace supplémentaire.`:''}${state.lastCheck?` Dernière vérification : ${date(state.lastCheck)}.`:''}`;
    const job=state.job,active=!!job?.active,resumable=!!job&&!['completed','canceled'].includes(job.status),finalizing=job?.status==='activating';
    get<HTMLButtonElement>('[data-catalog-check]').disabled=busy||state.checking||active;
    get<HTMLButtonElement>('[data-catalog-install]').disabled=busy||active||state.checking||!state.latest||state.needsRestart||resumable;
    get('[data-catalog-install]').textContent=state.installed?(state.latest?.updatedAt===state.updatedAt?'Préparer à nouveau':'Préparer la mise à jour'):'Installer le catalogue';
    get<HTMLButtonElement>('[data-catalog-restart]').hidden=!state.needsRestart;
    get<HTMLButtonElement>('[data-catalog-restart]').disabled=busy||active;
    get<HTMLButtonElement>('[data-catalog-cleanup]').disabled=busy||active||state.checking||!state.reclaimableBytes;
    get('[data-catalog-job]').textContent=job?`${phases[job.status]} · ${size(job.receivedBytes)} / ${size(job.totalBytes)}${job.cards?` · ${job.cards.toLocaleString('fr-FR')} cartes traitées`:''}${job.error?` · ${job.error}`:''}${state.needsRestart?' · Relance Asphodel pour activer cette version.':''}`:'Aucun téléchargement en cours.';
    const progress=get<HTMLProgressElement>('[data-catalog-progress]');progress.hidden=!job;progress.max=job?.totalBytes||1;progress.value=job?.receivedBytes??0;
    if(job&&['verifying','indexing','activating'].includes(job.status))progress.removeAttribute('value');
    get<HTMLButtonElement>('[data-catalog-control=pause]').disabled=busy||!active||job?.status==='paused'||finalizing;
    get<HTMLButtonElement>('[data-catalog-control=resume]').disabled=busy||active||!resumable||state.checking;
    get<HTMLButtonElement>('[data-catalog-control=cancel]').disabled=busy||!resumable||finalizing;
    get<HTMLButtonElement>('[data-catalog-extension]').disabled=busy||!get<HTMLSelectElement>('[data-catalog-set]').value;
    if(state.error&&!busy)get('[data-catalog-feedback]').textContent=state.error;
  }
  async function loadSets() {
    const stamp=state?.updatedAt??'missing';if(setsGeneration===stamp)return;setsGeneration=stamp;
    const current=version;
    if(!state?.installed){get('[data-catalog-extension-info]').textContent='Installe le catalogue puis relance Asphodel pour choisir une extension.';return;}
    try {
      const response=await fetch('/cards/search/catalog');if(!response.ok)throw new Error('Installe le catalogue puis relance Asphodel pour choisir une extension.');
      const catalog=await response.json() as {sets:{value:string;label:string}[]};if(!alive||version!==current){setsGeneration=undefined;return;}
      const select=get<HTMLSelectElement>('[data-catalog-set]'),value=select.value;select.replaceChildren(new Option('Choisir une extension…',''));
      for(const set of catalog.sets)select.append(new Option(`${set.label} (${set.value.toUpperCase()})`,set.value));select.value=value;select.disabled=false;
      get('[data-catalog-extension-info]').textContent='La préparation comprend les illustrations des impressions présentes dans cette extension, avec les rectos et versos. Tu pourras contrôler la taille estimée avant de lancer.';render();
    }catch(error){if(alive){get('[data-catalog-extension-info]').textContent=errorText(error);}}
  }
  async function poll() {
    if(!alive||polling||!desktop)return;polling=true;
    try{const next=await desktop.getCatalogState();if(alive){state=next;render();void loadSets();}}
    catch(error){if(alive)get('[data-catalog-feedback]').textContent=errorText(error);}finally{polling=false;}
  }
  async function action(work:()=>Promise<CatalogState|void>) {
    if(busy||!desktop)return;busy=true;get('[data-catalog-feedback]').textContent='';render();
    try{const next=await work();if(next)state=next;}
    catch(error){get('[data-catalog-feedback]').textContent=errorText(error);}
    finally{busy=false;if(alive)render();}
  }
  root.addEventListener('click',event=>{
    const button=(event.target as HTMLElement).closest<HTMLButtonElement>('button');if(!button||!desktop)return;
    if(button.matches('[data-catalog-check]'))void action(()=>desktop.checkCatalog());
    if(button.matches('[data-catalog-install]'))void action(()=>desktop.installCatalog());
    if(button.matches('[data-catalog-restart]'))void action(()=>desktop.restartForCatalog());
    if(button.matches('[data-catalog-cleanup]'))void action(()=>desktop.cleanupCatalog());
    if(button.dataset.catalogControl)void action(()=>desktop.controlCatalog(button.dataset.catalogControl as 'pause'|'resume'|'cancel'));
    if(button.matches('[data-catalog-extension]'))void action(async()=>{
      const response=await fetch(`/cards/search/artwork/${encodeURIComponent(get<HTMLSelectElement>('[data-catalog-set]').value)}`);
      if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(body.message??'Impossible de lire les illustrations de cette extension.');}
      const request=await response.json();if(alive)openExtensionArtwork(request);
    });
  });
  get('[data-catalog-set]').addEventListener('change',render);
  return {refresh(){alive=true;version++;setsGeneration=undefined;if(!timer)timer=setInterval(()=>void poll(),1000);void poll();},stop(){alive=false;version++;clearInterval(timer);timer=undefined;}};
}
