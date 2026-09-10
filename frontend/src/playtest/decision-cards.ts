import { renderHand } from './board-renderer.js';
import type { AgentChoice, AgentObservation, CardPresentation, DecisionPrompt } from './types.js';

export function decisionPresentationNames(prompt: DecisionPrompt | undefined): string[] {
  return prompt?.kind === 'card_picker' ? [...new Set(prompt.items.flatMap(item => item.cardRef && item.presentationName ? [item.presentationName] : []))] : [];
}

/** Temporary current-decision surface. Every activation submits the complete supplied choice. */
export function renderDecisionCards(container: HTMLElement, prompt: Extract<DecisionPrompt,{kind:'card_picker'}>, observation: AgentObservation | null,
  get: (name: string) => CardPresentation | null | undefined, choose: (choice: AgentChoice) => void): void {
  void observation; // card_picker never reads the human's own hand — every choice is one of prompt.items.
  const heading=document.createElement('h2'); heading.textContent=prompt.title;
  const progress=document.createElement('p'); progress.className='table-picker-progress';
  progress.textContent=`Selected ${prompt.selected.length} / ${prompt.maxSelections} · Minimum ${prompt.minSelections}`;
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
  for(const item of prompt.items) {
    if(item.cardRef) {
      // A card_picker item's choice is always backend-sourced (action/target/object/…), never the
      // frontend-only "physical_identity" kind (V2g) — the `in` check is just to satisfy the wider
      // AgentChoice union's type, not a real runtime possibility here.
      const node=face(item.label,item.presentationName,item.choice); node.dataset.choiceId=String('choice' in item.choice ? item.choice.choice : ''); node.dataset.candidateRef=item.cardRef; row.append(node);
    } else {
      const button=document.createElement('button'); button.type='button'; button.className='decision-option'; button.textContent=item.label; button.onclick=()=>choose(item.choice); actions.append(button);
    }
  }
  container.append(heading,progress,row,actions);
}

/**
 * V2h "OPENING HAND REVIEW IS FAR TOO LARGE": the seven-card opening hand as one fanned/overlapping
 * row — the SAME presentation as the live hand (`board-renderer.ts`'s `renderHand`, real card art,
 * printed size) instead of a wrapped grid of large picker tiles that needed scrolling to see all
 * seven at once. Every card is read via hover (the global hover-preview portal, see
 * hover-preview.ts) — never pinned/clickable, since reviewing an opening hand is not a selection.
 * Keep/Mulligan render as ordinary decision buttons below the row, always visible without scrolling.
 */
export function renderOpeningHandReview(
  container: HTMLElement,
  prompt: Extract<DecisionPrompt, { kind: 'opening_hand' }>,
  observation: AgentObservation | null,
  get: (name: string) => CardPresentation | null | undefined,
  choose: (choice: AgentChoice) => void,
): void {
  const heading = document.createElement('h2');
  heading.textContent = prompt.title;
  const subtitle = document.createElement('p');
  subtitle.className = 'table-picker-progress';
  subtitle.textContent = 'Review your hand, then Keep or Mulligan.';

  const fan = document.createElement('div');
  fan.className = 'opening-hand-fan';
  const self = observation?.players.find((p) => p.playerId === observation.selfPlayerId);
  if (self?.role === 'self') renderHand(fan, self.hand, get);

  const actions = document.createElement('div');
  actions.className = 'table-picker-actions';
  for (const item of prompt.items) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'decision-option';
    button.textContent = item.label;
    button.addEventListener('click', () => choose(item.choice));
    actions.append(button);
  }

  container.append(heading, subtitle, fan, actions);
}
