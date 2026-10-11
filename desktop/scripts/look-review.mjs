import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron} from 'playwright';
import {combatFixture,installCombatFixture} from './fixtures/combat-flow.mjs';
import {physicalGeometry} from './fixtures/physical-geometry.mjs';
import {populatedTableFixture} from './fixtures/populated-table.mjs';

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
for(const file of await readdir(output))if(/^\d{2}-.+\.png$/.test(file)||file==='report.json'||file==='index.html')await rm(join(output,file));
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
  const metrics=await page.evaluate(()=>{
    const visible=el=>{const r=el.getBoundingClientRect(),style=getComputedStyle(el);return r.width>0&&r.height>0&&style.visibility!=='hidden'&&style.display!=='none'&&!el.closest('[hidden]')};
    const controls=[...document.querySelectorAll('button,input,select,textarea,summary')].filter(visible);
    // Free tables and horizontally scrollable hands intentionally contain off-screen items.
    const outside=controls.filter(el=>!el.closest('.dt-world,.table-hand,.physical-hand,.lab-stack,.lab-result-scroll')).filter(el=>{const r=el.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1}).map(el=>({label:(el.getAttribute('aria-label')||el.textContent||el.getAttribute('placeholder')||el.tagName).trim().slice(0,100),tag:el.tagName}));
    const overflowCandidates=[...document.querySelectorAll('body *')].filter(visible).filter(el=>{const r=el.getBoundingClientRect();return r.left< -1||r.right>innerWidth+1}).slice(0,20).map(el=>({tag:el.tagName,className:el.className,left:Math.round(el.getBoundingClientRect().left),right:Math.round(el.getBoundingClientRect().right),scrollWidth:el.scrollWidth,clientWidth:el.clientWidth}));
    return {viewport:{width:innerWidth,height:innerHeight},documentHorizontalOverflow:document.documentElement.scrollWidth>innerWidth+1,overflowCandidates,controlsOutsideViewport:outside,pendingImages:[...document.images].filter(el=>visible(el)&&!el.complete).length,brokenImages:[...document.images].filter(el=>visible(el)&&el.complete&&el.naturalWidth===0).length,focusedControl:document.activeElement?.getAttribute('aria-label')||document.activeElement?.tagName};
  });
  const file=`${String(report.captures.length+1).padStart(2,'0')}-${name}.png`;
  await page.screenshot({path:join(output,file),animations:'disabled'});
  report.captures.push({name,task,file,...metrics,physicalGeometry:await page.evaluate(physicalGeometry)});
}
try {
  for(const mode of ['physical','digital']) {
    await launch();await page.evaluate(installCombatFixture,await populatedTableFixture(mode));
    await page.locator('#nav-play').click();await page.locator('.table-card-art').first().waitFor();
    for(const look of ['luminous','strategy']) {
      await page.locator('.table-menu-button').click();
      await page.locator(`[data-game-look=${look}]`).click();
      await page.locator('.table-menu-button').click();
      assert.equal(await page.locator('.table-root').getAttribute('data-look'),look);
      await capture(`${mode}-${look}`,'Même table illustrée, mêmes cartes et même décision : comparer matière, profondeur et lisibilité.');
      if(mode==='physical') {
        await page.locator('.physical-board[data-role=self] .physical-board-focus').click();
        await capture(`${mode}-${look}-self-focus`,'Comparer la table agrandie et les commandes sans changer la partie.');
        await page.locator('.physical-board[data-role=opponent] .physical-board-focus').first().click();
      }
    }
    assert.equal(await page.evaluate(()=>window.combatSmoke.choices.length),0,'Changing looks must not submit a game choice');
  }
  assert.deepEqual(report.errors,[],'renderer errors');
} catch(error) {
  report.errors.push(error.stack||String(error));process.exitCode=1;
  if(page&&!page.isClosed())await capture('failure','Inspect where the review stopped.').catch(()=>{});
} finally {
  const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  await writeFile(join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  await writeFile(join(output,'index.html'),`<!doctype html><meta charset="utf-8"><title>Asphodel — exploration visuelle</title><style>body{font:15px system-ui;margin:30px;background:#f3f6fa;color:#182238}main{max-width:1400px;margin:auto}section{margin:32px 0}img{display:block;width:100%;border:1px solid #cbd4e1}p{line-height:1.6}pre{white-space:pre-wrap}a{color:#254780}</style><main><h1>Asphodel — exploration visuelle</h1><p>${esc(report.scope)} Les métriques signalent des éléments à examiner ; elles ne remplacent pas une critique UX ou une vérification du rendu.</p>${report.errors.length?`<pre>${esc(report.errors.join('\n'))}</pre>`:''}${report.captures.map(c=>`<section><h2>${esc(c.name)}</h2><p>${esc(c.task)} · ${c.viewport.width} × ${c.viewport.height} · ${c.controlsOutsideViewport.length} contrôles hors cadre · ${c.brokenImages} images indisponibles · ${c.pendingImages} images en attente</p><a href="${esc(c.file)}"><img src="${esc(c.file)}" alt="${esc(c.name)}"></a></section>`).join('')}</main>`);
  if(electron)await electron.close();await rm(profile,{recursive:true,force:true});
}
console.log(`Exploration visuelle : ${report.captures.length} captures, ${report.errors.length} erreurs. ${output}`);
