/** Bounded exploration, not a strategic agent. Menu choices are returned verbatim. */
export function reviewChoice(pending,attempts=new Map()) {
  const prompt=pending?.rendered;if(!prompt)return null;
  if(prompt.kind==='physical_declare')return null; // Never guess physical identities.
  if(prompt.kind==='value')return {choice:{decisionId:prompt.decisionId,kind:'value',choice:Math.min(prompt.max,Math.max(prompt.min,prompt.suggested[0]??prompt.min)),reason:'human_choice'},label:'Valeur proposée'};
  const items=prompt.items||[];
  const used=item=>attempts.get(`${pending.context.turn}:${pending.type}:${item.label}`)||0;
  if(prompt.kind==='opening_hand') {
    const keep=items.find(item=>/^keep$|^garder$/i.test(item.label));
    return keep?{choice:keep.choice,label:keep.label,control:keep.control}:null;
  }
  const finish=items.find(item=>item.combat?.operation==='finish'||item.target?.kind==='finish'||/^(done|finish|confirm)/i.test(item.label));
  const pass=items.find(item=>item.control==='pass'||/^pass/i.test(item.label));
  const cancel=items.find(item=>item.control==='cancel');
  const edits=items.filter(item=>item.combat?.operation==='add'&&used(item)<1);
  let item;
  if(pending.type==='attackers_selection'||pending.type==='blockers_selection')item=(pending.selectedCardRefs?.length??0)>=3?finish:edits[0]??finish;
  else if(pending.type==='priority_action') {
    const actions=items.filter(item=>item!==pass&&item!==cancel&&used(item)<1);
    item=actions.find(item=>/^play /i.test(item.label))??actions.find(item=>/^cast /i.test(item.label))??pass??actions[0];
  } else item=items.find(item=>item!==cancel&&item!==finish&&used(item)<4)??finish??cancel;
  return item?{choice:item.choice,label:item.label,control:item.control}:null;
}
export function recordReviewAttempt(pending,label,attempts) {
  const key=`${pending.context.turn}:${pending.type}:${label}`;attempts.set(key,(attempts.get(key)||0)+1);
}
