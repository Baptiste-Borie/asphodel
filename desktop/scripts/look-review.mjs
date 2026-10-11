import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron} from 'playwright';
import {installCombatFixture} from './fixtures/combat-flow.mjs';
import {physicalGeometry} from './fixtures/physical-geometry.mjs';
import {populatedTableFixture} from './fixtures/populated-table.mjs';
import {strategyFixture} from './fixtures/strategy-flow.mjs';
import {digitalGeometry} from './fixtures/digital-geometry.mjs';
import {presentationGeometry} from './fixtures/presentation-geometry.mjs';

// Captures the compiled app in its production window with public deterministic DTOs.
// No Forge, personal library, real match or database is opened.
const output=resolve(process.env.ASPHODEL_UI_REVIEW_DIR||fileURLToPath(new URL('../review-looks/',import.meta.url)));
const profile=await mkdtemp(join(tmpdir(),'asphodel-ui-review-'));
const fixture=fileURLToPath(new URL('fixtures/window-smoke.mjs',import.meta.url));
const flags=process.platform==='linux'&&process.getuid?.()===0?['--no-sandbox']:[];
const report={version:2,createdAt:new Date().toISOString(),scope:'Compiled Electron UI with synthetic public fixtures; no real Forge gameplay.',captures:[],errors:[]};
let electron,page;
await mkdir(output,{recursive:true});
// Only remove generated review outputs, so changed capture counts cannot mix two runs.
for(const file of await readdir(output))if(/^\d{2}-.+\.png$/.test(file)||file==='report.json'||file==='index.html'||/^motion-\d+\.jpg$/.test(file))await rm(join(output,file));
async function launch() {
  if(electron)await electron.close();
  electron=await _electron.launch({args:[...flags,fixture],env:{...process.env,ASPHODEL_TEST_USER_DATA:profile},timeout:20_000});
  page=await electron.firstWindow();page.setDefaultTimeout(10_000);
  page.on('pageerror',error=>report.errors.push(error.message));
  await page.waitForFunction(()=>window.asphodelDesktop&&document.querySelector('#backend-status')?.textContent==='Prêt');
  await electron.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setFullScreen(false);w.setContentSize(1366,768)});
  await page.waitForFunction(()=>innerWidth===1366&&innerHeight===768);
}
async function capture(name,task) {
  await page.evaluate(async()=>{await document.fonts.ready;await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))});
  // A snapshot with empty pending image boxes is not a reliable artwork review.
  // Bound the wait so unavailable remote art never stalls the whole review.
  await page.evaluate(async()=>{
    const images=[...document.images].filter(el=>{const r=el.getBoundingClientRect();return !el.closest('[hidden]')&&r.width>0&&r.height>0&&r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight});
    await Promise.race([Promise.all(images.map(img=>img.decode().catch(()=>{}))),new Promise(resolve=>setTimeout(resolve,3000))]);
  });
  // Finish finite layout animations before measuring the same settled frame we capture.
  await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getComputedTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
  const metrics=await page.evaluate(()=>{
    const visible=el=>{const r=el.getBoundingClientRect(),style=getComputedStyle(el);return r.width>0&&r.height>0&&style.visibility!=='hidden'&&style.display!=='none'&&!el.closest('[hidden]')};
    const controls=[...document.querySelectorAll('button,input,select,textarea,summary')].filter(visible);
    // Free tables and horizontally scrollable hands intentionally contain off-screen items.
    const outside=controls.filter(el=>!el.closest('.dt-world,.table-hand,.physical-hand,.table-viewport-hand,.table-battlefield-cards,.table-land-zone,.lab-stack,.lab-result-scroll')).filter(el=>{const r=el.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1}).map(el=>({label:(el.getAttribute('aria-label')||el.textContent||el.getAttribute('placeholder')||el.tagName).trim().slice(0,100),tag:el.tagName}));
    const overflowCandidates=[...document.querySelectorAll('body *')].filter(visible).filter(el=>{const r=el.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1}).slice(0,20).map(el=>({tag:el.tagName,className:el.className,left:Math.round(el.getBoundingClientRect().left),right:Math.round(el.getBoundingClientRect().right),scrollWidth:el.scrollWidth,clientWidth:el.clientWidth}));
    return {viewport:{width:innerWidth,height:innerHeight},documentHorizontalOverflow:document.documentElement.scrollWidth>innerWidth+1,overflowCandidates,controlsOutsideViewport:outside,pendingImages:[...document.images].filter(el=>visible(el)&&!el.complete).length,brokenImages:[...document.images].filter(el=>visible(el)&&el.complete&&el.naturalWidth===0).length,focusedControl:document.activeElement?.getAttribute('aria-label')||document.activeElement?.tagName};
  });
  const file=`${String(report.captures.length+1).padStart(2,'0')}-${name}.png`;
  await page.screenshot({path:join(output,file),animations:'disabled'});
  report.captures.push({name,task,file,...metrics,physicalGeometry:await page.evaluate(physicalGeometry),digitalGeometry:await page.evaluate(digitalGeometry),presentationGeometry:await page.evaluate(presentationGeometry)});
}
try {
  for(const count of [2,3,4]) {
    await launch();await page.evaluate(installCombatFixture,await strategyFixture(count));
    await page.locator('#nav-play').click();await page.locator('.table-card-art').first().waitFor();
    await capture(`strategy-${count}-players`,'Comparer la composition, les cartes engagées, la main et la place des décisions.');
    if(count===2) {
      const frames=[];report.motionChecks=[];
      await page.evaluate(()=>{window.combatSmoke.holdChoice=true;});
      for(let i=0;i<12;i++) {
        const file=`motion-${String(i).padStart(2,'0')}.jpg`;
        await page.screenshot({path:join(output,file),type:'jpeg',quality:75,animations:'allow'});frames.push(file);
        report.motionChecks.push({file,presentationGeometry:await page.evaluate(presentationGeometry)});
        if(i===0) {
          await page.locator('.decision-option--pass').click();
          await page.waitForFunction(()=>typeof window.combatSmoke.releaseChoice==='function'&&document.querySelector('.table-status-line'));
          await capture('strategy-priority-pending','Vérifier le message affiché pendant une réponse en attente.');
          await page.evaluate(()=>{window.combatSmoke.holdChoice=false;window.combatSmoke.releaseChoice();});
        }
        await page.waitForTimeout(90);
      }
      report.motionFrames=frames;
      assert.equal(await page.evaluate(()=>window.combatSmoke.index),1);
      assert.equal(await page.evaluate(()=>window.combatSmoke.choices.length),1);
      await capture('strategy-state-change','Arrivée depuis la main, engagement, perte de trois PV et changement de joueur actif.');
      await page.locator('.table-battlefield-half--human').click({position:{x:160,y:30}});
      await capture('strategy-self-focus','Agrandir son plateau en gardant les commandes et les sièges adverses.');
      await page.locator('.table-focus-return').click();
      await capture('strategy-overview-return','Retour au plateau complet après une transition de focus.');
      await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(960,640));
      await page.waitForFunction(()=>innerWidth===960);await capture('strategy-compact','Vérifier la composition à 960 × 640.');
    }
    if(count===4) {
      await page.locator('.table-battlefield-half--human').click({position:{x:160,y:30}});
      await capture('strategy-four-player-focus','Agrandir un siège et garder trois résumés publics sans scroll imbriqué.');
      const preview=page.locator('.table-battlefield-half:not(.table-battlefield-half--focused) .table-seat-summary').first();
      const playerId=await preview.locator('..').getAttribute('data-player-id');
      await preview.click();
      assert.equal(await page.locator('.table-battlefield-half--focused').getAttribute('data-player-id'),playerId);
      assert.equal(await page.evaluate(()=>window.combatSmoke.choices.length),0);
      await capture('strategy-opponent-focus','Le résumé agrandit le plateau adverse sans envoyer de choix de jeu.');
    }
  }
  // A submitted priority is replaced by status text, not a disabled pass button.
  // Use the real value renderer at its lower bound to inspect a disabled control.
  await launch();
  const valueFixture=await strategyFixture(2);
  const valuePending=valueFixture.states[0].pendingDecision;
  valuePending.type='value_selection';
  valuePending.rendered={kind:'value',title:'Choisir une valeur',decisionId:valuePending.decisionId,min:0,max:3,suggested:[0]};
  await page.evaluate(installCombatFixture,valueFixture);
  await page.locator('#nav-play').click();
  await page.locator('.decision-value-step:disabled').waitFor();
  await capture('strategy-disabled-value','Contraste réel du bouton de diminution désactivé à la valeur minimale.');
  const disabled=report.captures.at(-1).presentationGeometry.disabledControls;
  assert.ok(disabled.length>0,'disabled contrast scenario must actually contain a disabled control');
  assert.ok(disabled.every(control=>control.contrast>=4.5&&Number(control.opacity)===1),'disabled controls must remain legible');
  await launch();await page.evaluate(installCombatFixture,await populatedTableFixture('physical'));
  await page.locator('#nav-play').click();await page.locator('.table-card-art').first().waitFor();
  await capture('strategy-physical','Vérifier les cadres et le défilement de la table physique.');
  await page.locator('.physical-board[data-role=self] .physical-board-focus').click();
  await capture('strategy-physical-self','Vérifier la table physique agrandie.');
  assert.deepEqual(report.errors,[],'renderer errors');
} catch(error) {
  report.errors.push(error.stack||String(error));process.exitCode=1;
  if(page&&!page.isClosed())await capture('failure','Inspect where the review stopped.').catch(()=>{});
} finally {
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(join(output,'index.html'),`<!doctype html><meta charset="utf-8"><title>Asphodel — exploration visuelle</title><style>body{font:15px system-ui;margin:30px;background:#f3f6fa;color:#182238}main{max-width:1400px;margin:auto}section{margin:32px 0}img{display:block;width:100%;border:1px solid #cbd4e1}p{line-height:1.6}pre{white-space:pre-wrap}a{color:#254780}</style><main><h1>Asphodel — exploration visuelle</h1><p>${esc(report.scope)} Les métriques signalent des éléments à examiner ; elles ne remplacent pas une critique UX ou une vérification du rendu.</p>${report.errors.length?`<pre>${esc(report.errors.join('\n'))}</pre>`:''}${report.motionFrames?.length?`<section><h2>Mouvement — échantillonnage</h2><p>Suite de captures, pas une vidéo fluide. Cliquer pour revoir la séquence.</p><button id=motion-play>Rejouer</button><img id=motion alt="Changement d’état" src="${esc(report.motionFrames[0])}"><script>const frames=${JSON.stringify(report.motionFrames)};let timer;document.getElementById('motion-play').onclick=()=>{clearInterval(timer);let i=0;timer=setInterval(()=>{document.getElementById('motion').src=frames[i++];if(i===frames.length)clearInterval(timer)},130)}</script></section>`:''}${report.captures.map(c=>`<section><h2>${esc(c.name)}</h2><p>${esc(c.task)} · ${c.viewport.width} × ${c.viewport.height} · ${c.controlsOutsideViewport.length} contrôles hors cadre · ${c.brokenImages} images indisponibles · ${c.pendingImages} images en attente</p><a href="${esc(c.file)}"><img src="${esc(c.file)}" alt="${esc(c.name)}"></a></section>`).join('')}</main>`);
  if(electron)await electron.close();await rm(profile,{recursive:true,force:true});
}
console.log(`Exploration visuelle : ${report.captures.length} captures, ${report.errors.length} erreurs. ${output}`);
