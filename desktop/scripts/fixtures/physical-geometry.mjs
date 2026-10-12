// Run inside the renderer. Check reserved regions, not arbitrary card overlaps:
// card stacks and fans deliberately overlap within their own public zones.
export function physicalGeometry() {
  const root=document.querySelector('.table-root--physical');
  if(!root)return null;
  const box=selector=>{const el=root.querySelector(selector);if(!el||el.hidden||!el.getClientRects().length)return null;const r=el.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};};
  const regions={board:box('.physical-scene'),decision:box('.table-decision-dock:not(:empty)'),voice:box('.voice-panel')};
  const overlaps=[];
  for(const [a,b] of [['board','decision'],['board','voice'],['decision','voice']]) {
    const x=regions[a],y=regions[b];
    if(x&&y&&Math.min(x.right,y.right)-Math.max(x.left,y.left)>1&&Math.min(x.bottom,y.bottom)-Math.max(x.top,y.top)>1)overlaps.push([a,b]);
  }
  const verticallyClippedBattlefieldCards=[];
  for(const el of root.querySelectorAll('.physical-board .table-battlefield-cards .table-card')) {
    const r=el.getBoundingClientRect(),zone=el.closest('.table-battlefield-cards').getBoundingClientRect();
    if(r.bottom>0&&r.top<innerHeight&&(r.top<zone.top-1||r.bottom>zone.bottom+1))verticallyClippedBattlefieldCards.push(el.getAttribute('aria-label')||el.dataset.cardRef||'card');
  }
  const battlefieldCollisions=[];
  for(const zone of root.querySelectorAll('.physical-board .table-battlefield-cards')) {
    const bounds=zone.getBoundingClientRect();
    const cards=[...zone.querySelectorAll('.table-card')].filter(el=>{const r=el.getBoundingClientRect();return r.width>0&&r.height>0&&r.right>bounds.left&&r.left<bounds.right;});
    cards.forEach((card,index)=>{const a=card.getBoundingClientRect();for(const other of cards.slice(index+1)) {
      const b=other.getBoundingClientRect();
      if(Math.min(a.right,b.right)-Math.max(a.left,b.left)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2)battlefieldCollisions.push([card.dataset.cardRef,other.dataset.cardRef]);
    }});
  }
  return {regions,overlaps,verticallyClippedBattlefieldCards,battlefieldCollisions};
}
