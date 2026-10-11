/** The reveal and turn announcement may coexist, but must not cover one another. */
export function presentationGeometry() {
  const root=document.querySelector('.table-root');if(!root)return null;
  const visible=el=>el&&!el.closest('[hidden]')&&getComputedStyle(el).visibility!=='hidden'&&Number(getComputedStyle(el).opacity)>0&&el.getBoundingClientRect().width>0;
  const banner=root.querySelector('.table-phase-banner'),reveal=root.querySelector('.table-card-reveal-card');
  let notificationCoversReveal=false;
  if(visible(banner)&&visible(reveal)) {
    const a=banner.getBoundingClientRect(),b=reveal.getBoundingClientRect();
    notificationCoversReveal=Math.min(a.right,b.right)-Math.max(a.left,b.left)>2&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>2;
  }
  const rgb=s=>{const m=s.match(/^rgba?\((\d+),?\s+(\d+),?\s+(\d+)/);return m?m.slice(1,4).map(Number):null;};
  const luminance=color=>color.map(v=>{const s=v/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;}).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  const disabledControls=[...root.querySelectorAll('.table-decision-dock button:disabled')].filter(visible).map(el=>{
    const style=getComputedStyle(el),foreground=rgb(style.color),background=rgb(style.backgroundColor);
    const a=foreground&&luminance(foreground),b=background&&luminance(background);
    return {label:el.textContent.trim(),foreground:style.color,background:style.backgroundColor,contrast:typeof a==='number'&&typeof b==='number'?Math.round(((Math.max(a,b)+.05)/(Math.min(a,b)+.05))*100)/100:null,opacity:style.opacity};
  });
  return {notificationCoversReveal,disabledControls};
}
