import {battlefieldArtUri} from './card-art';
import type {TargetDecisionModel} from './target-decision';
import type {AgentChoice,CardPresentation} from './types';

/** Choosing a target submits exactly its current engine choice. Search is local navigation. */
export function createTargetDecisionView() {
  let generation=0,busy=true,mountedRoot:HTMLElement|null=null;
  function deactivate(){generation++;busy=true;mountedRoot?.removeAttribute('aria-busy');}
  function render(root:HTMLElement,model:TargetDecisionModel,get:(name:string)=>CardPresentation|null|undefined,choose:(choice:AgentChoice)=>void){
    mountedRoot=root;const token=++generation;busy=false;
    const focused=root.contains(document.activeElement)?(document.activeElement as HTMLElement).dataset.targetFocus:undefined;
    const previousSearch=root.querySelector<HTMLInputElement>('.target-search');
    const query=previousSearch?.dataset.decisionId===model.decisionId?previousSearch.value:'';
    root.classList.remove('table-decision-dock--combat','table-decision-dock--complex','table-decision-dock--cards','table-decision-dock--opening-hand','physical-declaration');
    root.classList.add('table-decision-dock--targets');root.setAttribute('aria-busy','false');
    const panel=document.createElement('section');panel.className='target-flow';
    const heading=document.createElement('h2');heading.textContent=model.sourceName?`Cibles · ${model.sourceName}`:'Choisir les cibles';
    const prompt=document.createElement('p');prompt.className='target-prompt';prompt.textContent=model.title;
    const progress=document.createElement('p');progress.className='target-progress';progress.textContent=model.progress;progress.setAttribute('role','status');
    const body=document.createElement('div');body.className='target-body';
    if(model.abilityText){const source=document.createElement('details');const title=document.createElement('summary');title.textContent='Texte de la capacité';
      const text=document.createElement('p');text.textContent=model.abilityText;source.append(title,text);body.append(source);}
    const list=document.createElement('div');list.className='target-list';
    const groups=new Map<string,{root:HTMLElement;buttons:HTMLButtonElement[]}>();
    const footer=document.createElement('footer');footer.className='target-footer';
    const status=document.createElement('p');status.className='target-submit-status';status.setAttribute('role','status');
    status.textContent=model.finishes.length?'Tu peux terminer avec les cibles déjà choisies.':'Choisis une cible proposée pour continuer.';
    function submit(choice:AgentChoice){
      if(busy||token!==generation||!root.isConnected||choice.decisionId!==model.decisionId)return;
      busy=true;root.setAttribute('aria-busy','true');status.textContent='Envoi de la cible…';
      for(const control of root.querySelectorAll<HTMLInputElement|HTMLButtonElement>('button,input'))control.disabled=true;
      choose(choice);
    }
    for(const option of model.options){
      let group=groups.get(option.group);
      if(!group){const section=document.createElement('section');section.className='target-group';
        const title=document.createElement('h3');title.textContent=option.group;section.append(title);list.append(section);group={root:section,buttons:[]};groups.set(option.group,group);}
      const button=document.createElement('button');button.type='button';button.className='target-option';button.dataset.targetFocus=`choice:${'choice' in option.item.choice?option.item.choice.choice:''}`;
      const art=option.artName?battlefieldArtUri(get(option.artName)):null;
      if(art){const image=document.createElement('img');image.src=art;image.alt='';image.onerror=()=>image.remove();button.append(image);}
      const text=document.createElement('span');const name=document.createElement('strong');name.textContent=option.label;
      const detail=document.createElement('small');detail.textContent=option.detail+(option.stats?` · ${option.stats}`:'');text.append(name,detail);button.append(text);
      button.setAttribute('aria-label',`Choisir ${option.label} · ${detail.textContent}`);button.onclick=()=>submit(option.item.choice);
      button.dataset.search=`${option.label} ${option.detail}`.toLocaleLowerCase('fr');group.buttons.push(button);group.root.append(button);
    }
    const none=document.createElement('p');none.className='target-empty';none.hidden=true;none.textContent='Aucune cible ne correspond à cette recherche.';
    if(model.options.length>8){
      const label=document.createElement('label');label.className='target-search-label';label.textContent='Trouver une cible';
      const input=document.createElement('input');input.type='search';input.className='target-search';input.dataset.decisionId=model.decisionId;input.dataset.targetFocus='search';input.value=query;input.placeholder='Nom, joueur ou zone';
      function filter(){if(token!==generation||busy)return;const needle=input.value.trim().toLocaleLowerCase('fr');let matches=0;
        for(const group of groups.values()){let shown=0;for(const button of group.buttons){button.hidden=!button.dataset.search!.includes(needle);if(!button.hidden){shown++;matches++;}}group.root.hidden=shown===0;}
        none.hidden=matches>0;}
      input.oninput=filter;label.append(input);panel.append(heading,prompt,progress,label);filter();
    }else panel.append(heading,prompt,progress);
    body.append(list,none);
    if(!model.options.length){const empty=document.createElement('p');empty.textContent='Aucune autre cible proposée.';body.append(empty);}
    for(const finish of model.finishes){const button=document.createElement('button');button.type='button';button.className='target-finish';button.textContent=finish.label;
      button.dataset.targetFocus=`finish:${'choice' in finish.item.choice?finish.item.choice.choice:''}`;button.onclick=()=>submit(finish.item.choice);footer.append(button);}
    footer.append(status);panel.append(body,footer);root.replaceChildren(panel);
    if(focused){[...root.querySelectorAll<HTMLElement>('[data-target-focus]')].find(node=>node.dataset.targetFocus===focused&&!node.hidden)?.focus();}
  }
  return {render,deactivate,reset:deactivate};
}
