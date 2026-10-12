/** Actual card bounds: stacks in hands/lands are intentional; battlefield collisions are not. */
export function digitalGeometry() {
  const root=document.querySelector('.table-root:not(.table-root--physical)');if(!root)return null;
  const rect=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};};
  const intersects=(a,b)=>Math.min(a.right,b.right)-Math.max(a.left,b.left)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2;
  const collisions=[],clipped=[],decisionOverlaps=[],personalBandOverlaps=[],regionsOutsideBoard=[],clippedZoneLabels=[],lifeLabelOverlaps=[],previewScrollbars=[];
  const dock=root.querySelector('.table-decision-dock:not(:empty)');
  for(const board of root.querySelectorAll('.table-battlefield-half')) {
    const zone=board.querySelector('.table-battlefield-cards'),bounds=rect(zone),boardBounds=rect(board);
    if(root.querySelector('.table-battlefield--focused')&&!board.classList.contains('table-battlefield-half--focused')&&(board.scrollHeight>board.clientHeight+1||board.scrollWidth>board.clientWidth+1))previewScrollbars.push(board.dataset.playerId);
    const life=board.querySelector('.table-life');
    for(const label of board.querySelectorAll('.table-zone-label'))if(label.getBoundingClientRect().width&&intersects(rect(life),rect(label)))lifeLabelOverlaps.push({playerId:board.dataset.playerId,label:label.textContent});
    const land=board.querySelector('.table-land-zone'),hand=board.querySelector('.table-viewport-hand');
    if(intersects(rect(land),rect(hand)))personalBandOverlaps.push(board.dataset.playerId);
    for(const selector of ['.table-public-zones','.table-personal-band','.table-permanents-tray']) {
      const el=board.querySelector(selector),r=rect(el);
      if(r.right>r.left&&(r.left<boardBounds.left-1||r.right>boardBounds.right+1))regionsOutsideBoard.push({playerId:board.dataset.playerId,selector});
    }
    for(const label of board.querySelectorAll('.table-zone-label')) {
      const r=rect(label),tray=rect(label.parentElement);
      if(r.right>r.left&&(r.left<tray.left-1||r.right>tray.right+1||r.top<tray.top-1||r.bottom>tray.bottom+1))clippedZoneLabels.push({playerId:board.dataset.playerId,label:label.textContent});
    }
    const cards=[...zone.querySelectorAll('.table-card')].filter(card=>{const r=rect(card);return r.right>r.left&&r.right>bounds.left&&r.left<bounds.right});
    cards.forEach((card,index)=>{
      const r=rect(card);
      if(!(zone.dataset.dense==='true'&&getComputedStyle(zone).display==='grid')&&(r.top<bounds.top-1||r.bottom>bounds.bottom+1))clipped.push(card.dataset.cardRef);
      for(const other of cards.slice(index+1))if(intersects(r,rect(other)))collisions.push([card.dataset.cardRef,other.dataset.cardRef]);
    });
    if(dock&&intersects(rect(board),rect(dock)))decisionOverlaps.push(board.dataset.playerId);
  }
  return {battlefieldCollisions:collisions,verticallyClippedBattlefieldCards:clipped,decisionOverlaps,personalBandOverlaps,regionsOutsideBoard,clippedZoneLabels,lifeLabelOverlaps,previewScrollbars};
}
