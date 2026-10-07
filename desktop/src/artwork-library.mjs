import { readFile, readdir, stat, unlink, mkdir, writeFile, rename, utimes } from 'node:fs/promises';
import { join } from 'node:path';
import { artKey } from './art-cache.mjs';
import { isTrustedDesktopFrame } from './display-preferences.mjs';

export const MIN_ART_LIMIT = 50 * 1024 * 1024;
export const MAX_ART_LIMIT = 10 * 1024 * 1024 * 1024;
const FILE = /^[a-f0-9]{64}\.(jpg|png)$/;
const PHASES = ['downloading','paused','completed','partial','canceled'];
const validLimit = n => Number.isSafeInteger(n) && n >= MIN_ART_LIMIT && n <= MAX_ART_LIMIT;
const errorText = error => error.code === 'ENOSPC' ? 'Le disque est plein. Libère de l’espace puis reprends.' : error.message;
export function artworkRequest(value) {
  if (!value || typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(value.id)
    || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 120
    || !Array.isArray(value.urls) || value.urls.length > 40000 || !Number.isSafeInteger(value.unavailable) || value.unavailable < 0 || value.unavailable > 40000) throw new Error('Préparation d’images invalide.');
  const urls = new Map();
  for (const raw of value.urls) {
    if (typeof raw !== 'string' || raw.length > 4000) throw new Error('Adresse d’illustration invalide.');
    const key = artKey(raw), u = new URL(raw); urls.set(key,u.origin+u.pathname);
  }
  return {id:value.id,name:value.name.trim(),urls:[...urls.values()],unavailable:value.unavailable};
}
async function inventory(directory) {
  const entries = new Map();
  if (!directory) return entries;
  let names;try { names = await readdir(directory); } catch(error) { if(error.code==='ENOENT')return entries;throw error; }
  for (const key of names.filter(n=>FILE.test(n))) { const info=await stat(join(directory,key));if(info.isFile()&&info.size>0)entries.set(key,{size:info.size,access:info.mtimeMs}); }
  return entries;
}

/** One managed cache serves both visible images and explicit deck preparations. */
export class ArtworkLibrary {
  constructor(cache, file, { concurrency = 2, intervalMs = 150, onError = console.error } = {}) {
    this.cache=cache;this.file=file;this.concurrency=concurrency;this.intervalMs=intervalMs;this.onError=onError;
    this.limitBytes=1024*1024*1024;this.entries=new Map();this.seed=new Map();this.decks=[];this.job=null;
    this.serial=Promise.resolve();this.running=false;this.active=0;this.closed=false;this.nextStart=0;
    this.ready=this.initialize();
    cache.hooks={read:key=>{const e=this.entries.get(key);if(e){const before=e.access;e.access=Date.now();if(e.access-before>60_000)void utimes(join(cache.directory,key),new Date(),new Date()).catch(()=>{});}},store:(key,data,write)=>this.store(key,data,write)};
  }
  async initialize() {
    this.entries=await inventory(this.cache.directory);this.seed=await inventory(this.cache.seedDirectory);
    const files=await readdir(this.cache.directory).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
    for(const name of files)if(/^[a-f0-9]{64}\.(jpg|png)\.tmp$/.test(name))await unlink(join(this.cache.directory,name));
    try {
      const value=JSON.parse(await readFile(this.file,'utf8'));
      if(value.version!==1 || !validLimit(value.limitBytes) || !Array.isArray(value.decks) || value.decks.length>200
        || !value.decks.every(d=>typeof d.keep==='boolean') || new Set(value.decks.map(d=>d.id)).size!==value.decks.length)throw new Error('Métadonnées du cache invalides.');
      const decks=value.decks.map(d=>({...artworkRequest(d),keep:d.keep}));
      let job=null;
      if(value.job!==null && value.job!==undefined) {
        if(!PHASES.includes(value.job.status))throw new Error('Préparation du cache invalide.');
        job={...artworkRequest(value.job),status:value.job.status==='downloading'?'paused':value.job.status,failed:[],error:value.job.status==='downloading'?'Téléchargement interrompu. Reprends les images manquantes.':null};
      }
      this.limitBytes=value.limitBytes;this.decks=decks;this.job=job;
    } catch(error) { if(error.code!=='ENOENT'){this.onError(error);this.recoveryError='Les réglages du cache sont illisibles. Les images existantes sont conservées ; la préparation hors ligne doit être refaite.';this.metadataInvalid=true;} }
  }
  exclusive(action) { const run=this.serial.then(action);this.serial=run.catch(()=>{});return run; }
  async save() {
    // Never overwrite damaged retention metadata until the user explicitly rebuilds a preparation.
    if(this.metadataInvalid)throw new Error(this.recoveryError);
    await mkdir(this.cache.directory,{recursive:true});
    const data=JSON.stringify({version:1,limitBytes:this.limitBytes,decks:this.decks,job:this.job});
    if(data.length>10_000_000)throw new Error('Trop de préparations enregistrées. Retire les anciennes préparations.');
    const temporary=this.file+'.tmp';
    try {await writeFile(temporary,data,{mode:0o600});await rename(temporary,this.file);}
    catch(error){await unlink(temporary).catch(()=>{});throw error;}
  }
  protectedKeys() {
    if(this.metadataInvalid)return new Set(this.entries.keys());
    const requests=this.decks.filter(d=>d.keep);
    if(this.job && this.running)requests.push(this.job);
    return new Set(requests.flatMap(d=>d.urls.map(artKey)));
  }
  cached(url) {const key=artKey(url);return this.entries.has(key)||this.seed.has(key);}
  counts(request) {const cached=request.urls.filter(url=>this.cached(url)).length;return {total:request.urls.length,cached,missing:request.urls.length-cached};}
  snapshot() {
    const protectedKeys=this.protectedKeys(),usedBytes=[...this.entries.values()].reduce((n,e)=>n+e.size,0);
    const protectedBytes=[...this.entries].filter(([key])=>protectedKeys.has(key)).reduce((n,[,e])=>n+e.size,0);
    return {limitBytes:this.limitBytes,usedBytes,protectedBytes,reclaimableBytes:usedBytes-protectedBytes,
      bundledBytes:[...this.seed.values()].reduce((n,e)=>n+e.size,0),cachedImages:new Set([...this.entries.keys(),...this.seed.keys()]).size,
      recoveryError:this.recoveryError??null,decks:this.decks.map(d=>({id:d.id,name:d.name,keep:d.keep,unavailable:d.unavailable,...this.counts(d)})),
      job:this.job?{id:this.job.id,name:this.job.name,status:this.job.status,unavailable:this.job.unavailable,...this.counts(this.job),failed:this.job.failed.length,active:this.active,error:this.job.error}:null};
  }
  async state() {await this.ready;await this.serial;return this.snapshot();}
  async plan(value) {const request=artworkRequest(value);await this.ready;await this.serial;const counts=this.counts(request);return {...request,...counts,estimatedBytes:counts.missing*100_000};}
  async remove(key) {try{await unlink(join(this.cache.directory,key));}catch(error){if(error.code!=='ENOENT')throw error;}this.entries.delete(key);}
  async makeRoom(bytes, limit=this.limitBytes, writingKey) {
    const used=[...this.entries.values()].reduce((n,e)=>n+e.size,0)-(this.entries.get(writingKey)?.size??0);
    let needed=used+bytes-limit;if(needed<=0)return;
    const protectedKeys=this.protectedKeys(),candidates=[...this.entries].filter(([key])=>key!==writingKey&&!protectedKeys.has(key)&&!this.cache.pending.has(key)).sort((a,b)=>a[1].access-b[1].access);
    if(candidates.reduce((n,[,e])=>n+e.size,0)<needed)throw Object.assign(new Error('Le cache est plein et les images restantes sont protégées. Augmente la limite ou libère une préparation hors ligne.'),{code:'ART_QUOTA'});
    for(const [key,entry] of candidates){if(needed<=0)break;await this.remove(key);needed-=entry.size;}
  }
  async store(key,data,write) {
    await this.ready;
    return this.exclusive(async()=>{await this.makeRoom(data.length,this.limitBytes,key);await write();this.entries.set(key,{size:data.length,access:Date.now()});});
  }
  async prepare(value) {
    const request=artworkRequest(value);await this.ready;
    await this.exclusive(async()=>{
      if(this.closed)throw new Error('Asphodel est en cours de fermeture.');
      if(this.running)throw new Error('Un téléchargement est encore en cours. Mets-le en pause et attends la fin des images déjà lancées.');
      if(this.metadataInvalid)throw new Error(this.recoveryError);
      const found=this.decks.find(d=>d.id===request.id);
      if(!found && this.decks.length>=200)throw new Error('Retire une ancienne préparation avant d’en ajouter une.');
      const previousDecks=structuredClone(this.decks),previousJob=this.job;
      if(found)Object.assign(found,request,{keep:true});else this.decks.push({...request,keep:true});
      this.job={...request,status:'downloading',failed:[],error:null};
      try{await this.save();}catch(error){this.decks=previousDecks;this.job=previousJob;throw error;}
    });
    this.run();return this.state();
  }
  run() {
    if(this.running || !this.job || this.closed)return;
    this.running=true;const job=this.job;let cursor=0;
    const worker=async()=>{
      while(job.status==='downloading'&&!this.closed) {
        const url=job.urls[cursor++];if(!url)return;if(this.cached(url))continue;
        const wait=Math.max(0,this.nextStart-Date.now());this.nextStart=Math.max(Date.now(),this.nextStart)+this.intervalMs;
        if(wait)await new Promise(resolve=>setTimeout(resolve,wait));
        if(job.status!=='downloading'||this.closed)return;
        this.active++;
        try {await this.cache.get(url);}
        catch(error) {
          job.failed.push(url);job.error=errorText(error);
          if(error.code==='ART_QUOTA'||error.code==='ENOSPC')job.status='paused';
        } finally {this.active--;}
      }
    };
    this.work=Promise.all(Array.from({length:this.concurrency},worker)).then(async()=>{
      if(job.status==='downloading') {
        const {missing}=this.counts(job);job.status=missing||job.unavailable?'partial':'completed';
        if(job.status==='completed')job.error=null;
        else if(!job.error)job.error='Certaines cartes n’ont pas d’illustration dans leurs données enregistrées.';
      }
      this.running=false;await this.exclusive(()=>this.save());
    }).catch(error=>{this.running=false;job.status='paused';job.error=errorText(error);this.onError(error);});
  }
  async control(action) {
    if(!['pause','resume','cancel'].includes(action))throw new Error('Commande de téléchargement invalide.');await this.ready;
    await this.exclusive(async()=>{
      if(!this.job)throw new Error('Aucune préparation en cours.');
      const previous={status:this.job.status,failed:this.job.failed,error:this.job.error};
      if(action==='resume') {
        if(this.running)throw new Error('Attends la fin des images déjà lancées avant de reprendre.');
        if(this.closed)throw new Error('Asphodel est en cours de fermeture.');
        this.job.status='downloading';this.job.failed=[];this.job.error=null;
      }else {this.job.status=action==='pause'?'paused':'canceled';}
      try{await this.save();}catch(error){Object.assign(this.job,previous);throw error;}
    });
    if(action==='resume')this.run();return this.state();
  }
  async setLimit(bytes) {
    if(!validLimit(bytes))throw new Error('Choisis une limite entre 50 Mo et 10 Go.');await this.ready;
    await this.exclusive(async()=>{if(this.metadataInvalid)throw new Error(this.recoveryError);await this.makeRoom(0,bytes);const previous=this.limitBytes;this.limitBytes=bytes;try{await this.save();}catch(error){this.limitBytes=previous;throw error;}});return this.state();
  }
  async setKeep(id,keep) {
    if(typeof id!=='string'||typeof keep!=='boolean')throw new Error('Préparation invalide.');await this.ready;
    await this.exclusive(async()=>{const deck=this.decks.find(d=>d.id===id);if(!deck)throw new Error('Préparation introuvable.');const previous=deck.keep;deck.keep=keep;try{await this.save();}catch(error){deck.keep=previous;throw error;}});return this.state();
  }
  async forget(id) {
    await this.ready;await this.exclusive(async()=>{if(typeof id!=='string'||(this.running&&this.job?.id===id))throw new Error('Arrête le téléchargement avant de retirer cette préparation.');
      const previous=this.decks,job=this.job;this.decks=this.decks.filter(d=>d.id!==id);if(this.job?.id===id)this.job=null;
      try{await this.save();}catch(error){this.decks=previous;this.job=job;throw error;}});return this.state();
  }
  async purge() {
    await this.ready;await this.exclusive(async()=>{if(this.metadataInvalid)throw new Error(this.recoveryError);const protectedKeys=this.protectedKeys();for(const key of [...this.entries.keys()])if(!protectedKeys.has(key)&&!this.cache.pending.has(key))await this.remove(key);});return this.state();
  }
  async resetSettings() {
    await this.ready;await this.exclusive(async()=>{
      if(!this.metadataInvalid)return;
      const rescue=this.file+'.damaged-'+Date.now(),message=this.recoveryError;
      await rename(this.file,rescue);
      this.metadataInvalid=false;this.recoveryError=null;
      try{await this.save();}catch(error){this.metadataInvalid=true;this.recoveryError=message;await rename(rescue,this.file);throw error;}
    });return this.state();
  }
  async close() {this.closed=true;await this.ready;await this.exclusive(async()=>{if(this.job?.status==='downloading')this.job.status='paused';if(!this.metadataInvalid)await this.save();});}
}

export function installArtworkCommands({ ipcMain, window, library }) {
  const contents=window.webContents;
  const actions={'asphodel:art-state':()=>library.state(),'asphodel:art-plan':value=>library.plan(value),'asphodel:art-prepare':value=>library.prepare(value),
    'asphodel:art-control':value=>library.control(value),'asphodel:art-limit':value=>library.setLimit(value),'asphodel:art-keep':(id,keep)=>library.setKeep(id,keep),
    'asphodel:art-forget':id=>library.forget(id),'asphodel:art-purge':()=>library.purge(),'asphodel:art-reset':()=>library.resetSettings()};
  for(const [channel,action] of Object.entries(actions))ipcMain.handle(channel,(event,...args)=>{
    if(contents.isDestroyed()||!isTrustedDesktopFrame(event,contents))throw new Error('Desktop artwork command refused');return action(...args);
  });
  window.once('closed',()=>{for(const channel of Object.keys(actions))ipcMain.removeHandler(channel);});
}
