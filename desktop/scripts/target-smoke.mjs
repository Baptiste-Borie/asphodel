import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron} from 'playwright';
import {targetFixture,installTargetFixture} from './fixtures/target-flow.mjs';

const fixture=fileURLToPath(new URL('fixtures/window-smoke.mjs',import.meta.url));
const userData=await mkdtemp(join(tmpdir(),'asphodel-target-smoke-'));
const rootFlags=process.platform==='linux'&&process.getuid?.()===0?['--no-sandbox']:[];
let electron;
try {
  for(const mode of ['digital','physical']) {
    electron=await _electron.launch({args:[...rootFlags,fixture],env:{...process.env,ASPHODEL_TEST_USER_DATA:userData},timeout:20_000});
    const page=await electron.firstWindow();const errors=[];page.on('pageerror',error=>errors.push(error.message));
    await page.waitForFunction(()=>window.asphodelDesktop&&document.querySelector('#backend-status')?.textContent==='Prêt');
    await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setFullScreen(false));
    await page.waitForFunction(async()=>!(await window.asphodelDesktop.getDisplayState()).fullscreen);
    await electron.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setContentSize(1366,768));
    await page.waitForFunction(()=>innerWidth===1366&&innerHeight===768);
    await page.evaluate(installTargetFixture,targetFixture(mode));await page.locator('#nav-play').click();
    const dock=page.locator('.table-decision-dock--targets');await dock.getByRole('heading',{name:'Cibles · Test spell'}).waitFor();
    assert.match(await dock.textContent(),/Cimetière · Toi/);assert.ok(!(await dock.textContent()).includes('Secret should not appear'));
    assert.equal(await dock.locator('.target-finish').count(),0,'no invented Finish');
    const search=dock.getByRole('searchbox',{name:'Trouver une cible'});
    await search.fill('not a target');await dock.locator('.target-empty').waitFor({state:'visible'});
    assert.equal(await page.evaluate(()=>window.targetSmoke.choices.length),0,'filtering does not submit');
    await search.fill('Bear');assert.equal(await dock.locator('.target-option:visible').count(),2);
    const second=dock.getByRole('button',{name:/Choisir Bear · 2/});await second.focus();await page.keyboard.press('Enter');
    await dock.getByRole('button',{name:'Terminer le choix des cibles',exact:true}).waitFor();
    assert.match(await dock.locator('.target-progress').textContent(),/choisies : 1/);
    assert.match(await dock.textContent(),mode==='digital'?/Asphodel 2 · 40 PV/:/Asphodel · 40 PV/);
    await dock.getByRole('button',{name:'Terminer le choix des cibles',exact:true}).click();
    await dock.getByRole('button',{name:'Terminer sans choisir de cible',exact:true}).waitFor();
    assert.equal(await dock.getByRole('button',{name:/Repeated ability/}).count(),2);
    assert.match(await dock.getByRole('button',{name:/Repeated ability · 2/}).textContent(),/Position 2/);
    assert.equal(await page.evaluate(()=>{
      const dock=document.querySelector('.table-decision-dock--targets'),button=dock.querySelector('.target-finish');
      const panel=dock.getBoundingClientRect(),finish=button.getBoundingClientRect();
      return dock.scrollWidth<=dock.clientWidth+1&&finish.top>=panel.top&&finish.bottom<=panel.bottom+1&&panel.left>=0&&panel.right<=innerWidth&&panel.bottom<=innerHeight;
    }),true,'target options and Finish fit 1366×768');
    if(process.env.ASPHODEL_TARGET_SCREENSHOT)await page.screenshot({path:`${process.env.ASPHODEL_TARGET_SCREENSHOT}-${mode}.png`});
    await dock.getByRole('button',{name:/Repeated ability · 2/}).click();
    await page.getByRole('button',{name:/Pass priority/}).waitFor();
    assert.equal(await page.locator('.table-decision-dock--targets').count(),0,'normal dock restored');
    assert.deepEqual(await page.evaluate(()=>window.targetSmoke.choices.map(c=>c.choice)),['grave2','finish-selected','stack2']);
    assert.deepEqual(errors,[]);await electron.close();electron=undefined;
  }
  console.log('Target window smoke passed: Digital/Physical, exact graveyard/Finish/stack choices, local search, keyboard, player destinations, hidden identity, count and 1366×768 layout.');
}finally{if(electron)await electron.close();await rm(userData,{recursive:true,force:true});}
