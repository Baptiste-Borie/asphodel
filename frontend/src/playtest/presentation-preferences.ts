export const PRESENTATION_STORAGE_KEY = 'asphodel.play-presentation.v1';
export type PresentationSpeed = 'fast' | 'normal' | 'deliberate';
export type PresentationPreferences = { version: 1; speed: PresentationSpeed; reduceMotion: boolean };
export type PresentationTiming = { low: number; medium: number; high: number; mediumFloor: number;
  reveal: number; phase: number; fade: number; settle: number; arrival: number; movement: number; breath: number };
export const DEFAULT_PRESENTATION: PresentationPreferences = {version:1,speed:'normal',reduceMotion:false};
export const SPEED_LABELS: Record<PresentationSpeed,string> = {fast:'Rapide',normal:'Normal',deliberate:'Posé'};
const timings: Readonly<Record<PresentationSpeed,PresentationTiming>> = {
  fast:{low:80,medium:350,high:1000,mediumFloor:250,reveal:700,phase:1000,fade:150,settle:320,arrival:150,movement:220,breath:100},
  normal:{low:250,medium:1000,high:3500,mediumFloor:700,reveal:1400,phase:2100,fade:400,settle:650,arrival:280,movement:420,breath:200},
  deliberate:{low:250,medium:1500,high:5500,mediumFloor:1000,reveal:2200,phase:2700,fade:400,settle:650,arrival:280,movement:420,breath:200},
};
export const presentationTiming = (speed: PresentationSpeed = 'normal'): PresentationTiming => ({...timings[speed]});
export function parsePresentationPreferences(raw: string | null): PresentationPreferences {
  try {
    const p = JSON.parse(raw ?? 'null');
    if (p?.version===1 && typeof p.speed==='string' && Object.hasOwn(SPEED_LABELS,p.speed) && typeof p.reduceMotion==='boolean') return {version:1,speed:p.speed,reduceMotion:p.reduceMotion};
  } catch { /* Use readable defaults when storage is corrupt. */ }
  return {...DEFAULT_PRESENTATION};
}
type PreferenceStorage = Pick<Storage,'getItem'|'setItem'>;
/** Memory remains usable if disk storage is unavailable; callers show the persisted-state error explicitly. */
export class PresentationPreferenceStore {
  private preferences: PresentationPreferences;
  private listeners = new Set<()=>void>();
  private error: string | null = null;
  private readonly storage: PreferenceStorage;
  constructor(storage: PreferenceStorage) {
    this.storage=storage;
    try {this.preferences=parsePresentationPreferences(storage.getItem(PRESENTATION_STORAGE_KEY));}
    catch {this.preferences={...DEFAULT_PRESENTATION};this.error='Impossible de lire les réglages enregistrés.';}
  }
  get state() {return {...this.preferences};}
  get saveError() {return this.error;}
  set(preferences: PresentationPreferences) {
    this.preferences=parsePresentationPreferences(JSON.stringify(preferences));
    try {this.storage.setItem(PRESENTATION_STORAGE_KEY,JSON.stringify(this.preferences));this.error=null;}
    catch {this.error='Réglage appliqué pour cette session, mais non enregistré. Réessaie pour le conserver au prochain lancement.';}
    for(const listener of this.listeners) listener();
  }
  refresh() {
    try {this.preferences=parsePresentationPreferences(this.storage.getItem(PRESENTATION_STORAGE_KEY));this.error=null;}
    catch {this.error='Impossible de lire les réglages enregistrés.';}
    for(const listener of this.listeners) listener();
  }
  subscribe(listener:()=>void) {this.listeners.add(listener);return ()=>{this.listeners.delete(listener);};}
}
let sharedStore: PresentationPreferenceStore | undefined;
export function presentationPreferences() {
  if (!sharedStore) {
    // Accessors can throw on unavailable storage, so keep them inside the store's guarded calls.
    sharedStore=new PresentationPreferenceStore({getItem:key=>window.localStorage.getItem(key),setItem:(key,value)=>window.localStorage.setItem(key,value)});
    window.addEventListener('storage',event=>{if(event.key===PRESENTATION_STORAGE_KEY || event.key===null) sharedStore?.refresh();});
  }
  return sharedStore;
}
