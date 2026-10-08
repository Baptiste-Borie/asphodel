import {presentationPreferences,presentationTiming,SPEED_LABELS,type PresentationPreferenceStore,type PresentationSpeed} from './presentation-preferences';
import './presentation-settings.css';
export function mountPresentationSettings(root:HTMLElement, store:PresentationPreferenceStore=presentationPreferences()) {
  root.classList.add('presentation-settings');
  const heading=document.createElement('h3');heading.textContent='Rythme des parties';
  const label=document.createElement('label');label.textContent='Vitesse de présentation';
  const select=document.createElement('select');select.setAttribute('aria-label','Vitesse de présentation');
  for(const [speed,name] of Object.entries(SPEED_LABELS)) {const option=document.createElement('option');option.value=speed;option.textContent=name;select.append(option);}label.append(select);
  const duration=document.createElement('p');duration.className='presentation-duration';
  const motionLabel=document.createElement('label');motionLabel.className='presentation-motion';
  const motion=document.createElement('input');motion.type='checkbox';motionLabel.append(motion,document.createTextNode(' Réduire les animations des parties'));
  const detail=document.createElement('p');detail.textContent='Le rythme choisi s’applique aux prochaines actions. Réduire les animations garde les cartes et le temps de lecture, sans les déplacements. Le réglage de réduction des mouvements de ton système est également respecté.';
  const status=document.createElement('p');status.setAttribute('role','status');status.className='presentation-save-status';
  const retry=document.createElement('button');retry.type='button';retry.textContent='Réessayer l’enregistrement';
  root.replaceChildren(heading,label,duration,motionLabel,detail,status,retry);
  function render() {
    select.value=store.state.speed;motion.checked=store.state.reduceMotion;
    duration.textContent=`Carte importante : ${(presentationTiming(store.state.speed).high/1000).toLocaleString('fr-FR')} s de lecture.`;
    status.textContent=store.saveError ?? '';status.hidden=!store.saveError;retry.hidden=!store.saveError;
  }
  const unsubscribe=store.subscribe(render);
  select.onchange=()=>store.set({...store.state,speed:select.value as PresentationSpeed});
  motion.onchange=()=>store.set({...store.state,reduceMotion:motion.checked});
  retry.onclick=()=>store.set(store.state);
  render();return {dispose:unsubscribe};
}
