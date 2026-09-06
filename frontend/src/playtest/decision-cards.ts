import type { AgentChoice, AgentObservation, CardPresentation, DecisionPrompt } from './types.js';

export function decisionPresentationNames(prompt: DecisionPrompt | undefined): string[] {
  return prompt?.kind === 'card_picker' ? [...new Set(prompt.items.flatMap(item => item.cardRef && item.presentationName ? [item.presentationName] : []))] : [];
}

/** Temporary current-decision surface. Every activation submits the complete supplied choice. */
export function renderDecisionCards(container: HTMLElement, prompt: Extract<DecisionPrompt,{kind:'card_picker'|'opening_hand'}>, observation: AgentObservation | null,
  get: (name: string) => CardPresentation | null | undefined, choose: (choice: AgentChoice) => void): void {
  const heading=document.createElement('h2'); heading.textContent=prompt.title;
  const progress=document.createElement('p'); progress.className='table-picker-progress';
  progress.textContent=prompt.kind==='card_picker' ? `Selected ${prompt.selected.length} / ${prompt.maxSelections} · Minimum ${prompt.minSelections}` : 'Review your hand, then Keep or Mulligan.';
  const row=document.createElement('div'); row.className='table-picker-cards';
  const actions=document.createElement('div'); actions.className='table-picker-actions';
  function face(name:string, artName:string|undefined, choice?:AgentChoice) {
    const node=document.createElement('button'); node.type='button'; node.className='table-picker-card'; node.setAttribute('aria-label',name);
    const art=artName ? get(artName)?.imageUri : null;
    if(art) { const image=document.createElement('img'); image.src=art; image.alt=name; image.onerror=()=>image.remove(); node.append(image); }
    const label=document.createElement('span'); label.textContent=name; node.append(label);
    if(choice) node.onclick=()=>choose(choice);
    return node;
  }
  if(prompt.kind==='opening_hand') {
    const self=observation?.players.find(p=>p.playerId===observation.selfPlayerId);
    if(self?.role==='self') for(const card of self.hand) row.append(face(card.name??'Face-down card',!card.hidden&&!card.faceDown ? card.name??undefined : undefined));
  }
  for(const item of prompt.items) {
    if(prompt.kind==='card_picker' && item.cardRef) {
      const node=face(item.label,item.presentationName,item.choice); node.dataset.choiceId=String(item.choice.choice); node.dataset.candidateRef=item.cardRef; row.append(node);
    } else {
      const button=document.createElement('button'); button.type='button'; button.className='decision-option'; button.textContent=item.label; button.onclick=()=>choose(item.choice); actions.append(button);
    }
  }
  container.append(heading,progress,row,actions);
}
