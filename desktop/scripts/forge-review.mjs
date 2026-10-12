import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron} from 'playwright';
import {reviewChoice,recordReviewAttempt} from './forge-review-policy.mjs';
import {digitalGeometry} from './fixtures/digital-geometry.mjs';

const desktop=fileURLToPath(new URL('../',import.meta.url));
const output=join(desktop,'review-forge');
const profile=await mkdtemp(join(tmpdir(),'asphodel-forge-review-'));
const report={scope:'Production Electron and real bundled Forge; isolated digital fixture decks; bounded exploratory driver. API choices are not UI click validation.',createdAt:new Date().toISOString(),seed:42,decisions:[],captures:[],errors:[],stopReason:null};
const attempts=new Map(),seen=new Set(),families=new Set();
let electron,page,sessionId,lastProgress=Date.now(),lastTurn=-1;
await mkdir(output,{recursive:true});
// Fresh output per run, without erasing unrelated files.
for(const capture of (await readFile(join(output,'report.json'),'utf8').then(JSON.parse).catch(()=>({captures:[]}))).captures||[]) {
  if(/^\d{3}-[a-z_]+\.png$/.test(capture.file))await rm(join(output,capture.file),{force:true});
}
async function api(path,body) {
  return page.evaluate(async({path,body})=>{
    const response=await fetch(path,{...(body===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}),signal:AbortSignal.timeout(20_000)});
    const data=await response.json();if(!response.ok)throw Error(`${response.status}: ${JSON.stringify(data)}`);return data;
  },{path,body});
}
async function capture(label,state) {
  const file=`${String(report.captures.length+1).padStart(3,'0')}-${label}.png`;
  await page.evaluate(async()=>{
    await document.fonts.ready;
    await Promise.race([Promise.all([...document.images].filter(img=>img.getBoundingClientRect().width>0).map(img=>img.decode().catch(()=>{}))),new Promise(resolve=>setTimeout(resolve,2000))]);
  });
  await page.screenshot({path:join(output,file),animations:'disabled'});
  const metrics=await page.evaluate(()=>({viewport:{width:innerWidth,height:innerHeight},displayedDecisionId:document.querySelector('.table-root')?.dataset.decisionId,brokenImages:[...document.images].filter(img=>img.getBoundingClientRect().width>0&&img.complete&&img.naturalWidth===0).length}));
  report.captures.push({file,label,turn:state?.observation?.game.turn,status:state?.status,...metrics,digitalGeometry:await page.evaluate(digitalGeometry)});
}
try {
  await stat(join(desktop,'runtime/frontend/index.html'));
  electron=await _electron.launch({args:[...(process.platform==='linux'&&process.getuid?.()===0?['--no-sandbox']:[]),desktop],env:{...process.env,ASPHODEL_TEST_USER_DATA:profile},timeout:40_000});
  page=await electron.firstWindow();page.setDefaultTimeout(20_000);
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.waitForFunction(()=>window.asphodelDesktop&&document.querySelector('#backend-status')?.textContent==='Prêt',{},{timeout:45_000});
  await electron.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setFullScreen(false);w.setContentSize(1366,768);});
  ({sessionId}=await api('/playtests',{humanDeck:{type:'fixture'},asphodelDeck:{type:'fixture'},playMode:'digital',seed:report.seed}));
  report.sessionId=sessionId;
  // Reload production UI so its normal active-session resume sees the new game.
  await page.reload();
  await page.locator('.table-root').waitFor();
  lastProgress=Date.now();
  const deadline=Date.now()+180_000;
  while(Date.now()<deadline&&report.decisions.length<80) {
    const state=await api(`/playtests/${sessionId}`);
    report.lastState={status:state.status,observation:state.observation,pendingDecision:state.pendingDecision,error:state.error,diagnostic:state.diagnostic,asphodelDecisionCount:state.asphodelDecisionCount};
    if(state.status==='failed')throw Error(JSON.stringify(state.error??state.diagnostic??'Forge session failed'));
    if(['completed','ended_by_human'].includes(state.status)){report.stopReason=state.status;await capture('end',state);break;}
    const pending=state.pendingDecision;
    if(!pending||seen.has(pending.decisionId)) {
      if(Date.now()-lastProgress>30_000)throw Error('No new human decision for 30 seconds; inspect the last state.');
      await page.waitForTimeout(250);continue;
    }
    // The production playback queue must have reached this exact engine decision.
    await page.waitForFunction(id=>{const root=document.querySelector('.table-root');return root&&!root.hidden&&root.dataset.decisionId===id&&root.dataset.playback!=='playing';},pending.decisionId,{timeout:25_000});
    const turn=state.observation?.game.turn??pending.context.turn;
    if(!families.has(pending.type)||turn!==lastTurn) {
      await capture('decision',state);families.add(pending.type);lastTurn=turn;
    }
    if(turn>=8){report.stopReason='turn_limit';break;}
    const selected=reviewChoice(pending,attempts);
    if(!selected){report.stopReason='unsupported_prompt';await capture('unsupported',state);break;}
    seen.add(pending.decisionId);recordReviewAttempt(pending,selected.label,attempts);
    const pass=page.locator('.decision-option--pass');
    const viaUI=selected.control==='pass'&&await pass.count()===1&&await pass.isVisible()&&await pass.isEnabled();
    if(viaUI)await pass.click();
    else assert.equal((await api(`/playtests/${sessionId}/choice`,selected.choice)).accepted,true);
    report.decisions.push({turn,type:pending.type,decisionId:pending.decisionId,label:selected.label,choice:selected.choice,transport:viaUI?'ui_click':'api'});
    lastProgress=Date.now();
    if(report.decisions.length%10===0)console.log(`Forge : ${report.decisions.length} décisions, tour ${turn}, ${report.captures.length} captures.`);
    await page.waitForTimeout(250);
  }
  report.stopReason??=report.decisions.length>=80?'decision_limit':'time_limit';
  assert.ok(report.decisions.length>0,'Forge must expose and accept at least one real choice');
} catch(error) {
  report.errors.push(error.stack||String(error));process.exitCode=1;
  if(page&&!page.isClosed())await capture('failure',report.lastState).catch(()=>{});
} finally {
  if(sessionId&&page&&!page.isClosed()) {
    try {
      const ended=await api(`/playtests/${sessionId}/end`,{});
      report.endedStatus=ended.status;
      report.gameReview=await api(`/playtests/reviews/${sessionId}`);
    } catch(error){report.errors.push(`Cleanup: ${error.message}`);process.exitCode=1;}
  }
  if(electron)await electron.close().catch(error=>{report.errors.push(`Close: ${error.message}`);process.exitCode=1;});
  await rm(profile,{recursive:true,force:true});
  report.finishedAt=new Date().toISOString();
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  await writeFile(join(output,'index.html'),`<!doctype html><meta charset=utf-8><title>Asphodel — Forge réel</title><style>body{font:15px system-ui;background:#10212e;color:#ecf3f8;margin:24px}img{width:100%;max-width:1366px}pre{white-space:pre-wrap}</style><h1>Revue Forge réelle</h1><p>${esc(report.scope)}</p><p>${report.decisions.length} décisions · arrêt : ${esc(report.stopReason)} · ${report.errors.length} erreurs</p><pre>${esc(report.errors.join('\n'))}</pre>${report.captures.map(c=>`<h2>${esc(c.label)} · tour ${esc(c.turn)}</h2><img src="${esc(c.file)}">`).join('')}`);
}
console.log(`Revue Forge : ${report.decisions.length} décisions, ${report.captures.length} captures, ${report.errors.length} erreurs. ${output}`);
