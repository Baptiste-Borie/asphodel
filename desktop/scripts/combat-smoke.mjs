import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {_electron} from 'playwright';
import {combatFixture,installCombatFixture} from './fixtures/combat-flow.mjs';

const fixture=fileURLToPath(new URL('fixtures/window-smoke.mjs',import.meta.url));
const userData=await mkdtemp(join(tmpdir(),'asphodel-combat-smoke-'));
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
    await page.evaluate(installCombatFixture,combatFixture(mode));
    await page.locator('#nav-play').click();
    const dock=page.locator('.table-decision-dock--combat');await dock.getByRole('heading',{name:'Déclarer les attaquants'}).waitFor();
    await dock.locator('[data-combat-card=g2]').click();
    assert.equal(await page.evaluate(()=>window.combatSmoke.choices.length),0,'creature navigation never submits a choice');
    const add=dock.locator('.combat-edit');await add.focus();await page.keyboard.press('Enter');
    await page.waitForFunction(()=>document.querySelector('.combat-edit[data-operation=remove]'));
    assert.equal(await dock.locator('[data-combat-card=g2]').getAttribute('aria-pressed'),'true');
    assert.equal(await page.evaluate(()=>window.combatSmoke.choices[0].choice),'second-add');
    await dock.locator('.combat-edit[data-operation=remove]').click();
    await dock.getByRole('button',{name:'N’attaquer avec aucune créature',exact:true}).waitFor();
    await dock.getByRole('button',{name:'N’attaquer avec aucune créature',exact:true}).click();
    await dock.getByRole('heading',{name:'Déclarer les bloqueurs'}).waitFor();
    assert.match(await dock.locator('.combat-threats').textContent(),/Flying threat.*Aucun ajout de bloc proposé/s);
    await dock.locator('.combat-edit').click();
    await dock.getByRole('button',{name:'Valider les blocs',exact:true}).waitFor();
    await dock.locator('.combat-assignments summary').click();
    assert.match(await dock.locator('.combat-assignments').textContent(),/Goblin · 1 → Bear/);
    assert.equal(await page.evaluate(()=>{
      const dock=document.querySelector('.table-decision-dock--combat');const finish=dock.querySelector('.combat-finish');
      const panel=dock.getBoundingClientRect(),button=finish.getBoundingClientRect();
      return dock.scrollWidth<=dock.clientWidth+1&&button.top>=panel.top&&button.bottom<=panel.bottom+1
        &&panel.left>=0&&panel.right<=innerWidth&&panel.bottom<=innerHeight;
    }),true,'combat and Finish fit 1366×768 without clipping');
    assert.deepEqual(await page.evaluate(()=>window.combatSmoke.choices.map(c=>c.choice)),['second-add','second-remove','finish-empty','block-bear']);
    if(process.env.ASPHODEL_COMBAT_SCREENSHOT)await page.screenshot({path:`${process.env.ASPHODEL_COMBAT_SCREENSHOT}-${mode}.png`});
    assert.deepEqual(errors,[]);await electron.close();electron=undefined;
  }
  console.log('Combat window smoke passed: Digital/Physical, creature navigation, exact attack/remove/block choices, keyboard, three-player defender, public unoffered attacker, confirmed assignments and visible Finish at 1366×768.');
}finally{if(electron)await electron.close();await rm(userData,{recursive:true,force:true});}
