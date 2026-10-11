/** Actual card bounds: stacks in hands/lands are intentional; battlefield collisions are not. */
export function digitalGeometry() {
  const root=document.querySelector('.table-root:not(.table-root--physical)');if(!root)return null;
  const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
  const intersects=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2;
  const collisions=[],clipped=[],decisionOverlaps=[];
  const dock=root.querySelector('.table-decision-dock:not(:empty)');
  for(const board of root.querySelectorAll('.table-battlefield-half')) {
    const zone=board.querySelector('.table-battlefield-cards'),bounds=rect(zone);
    const cards=[...zone.querySelectorAll('.table-card')].filter(card=>{const r=rect(card);return r.right>bounds.left&&r.left<bounds.right});
    cards.forEach((card,index)=>{
      const r=rect(card);
      if(r.top<bounds.top-1||r.bottom>bounds.bottom+1)clipped.push(card.dataset.cardRef);
      for(const other of cards.slice(index+1))if(intersects(r,rect(other)))collisions.push([card.dataset.cardRef,other.dataset.cardRef]);
    });
    if(dock&&intersects(rect(board),rect(dock)))decisionOverlaps.push(board.dataset.playerId);
  }
  return {battlefieldCollisions:collisions,verticallyClippedBattlefieldCards:clipped,decisionOverlaps};
}
