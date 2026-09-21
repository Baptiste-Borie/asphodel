import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1440,height:1080}});
page.setDefaultTimeout(15000);
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
const url=process.env.TABLETOP_URL ?? 'http://127.0.0.1:5180';
try {
  await page.goto(`${url}/#deck-lab`,{waitUntil:'domcontentloaded'});
  await page.locator('.lab-tile').first().waitFor();
  assert.equal(await page.locator('.lab-tile').count(),60);
  await page.locator('[data-action=filters]').click();
  const set = page.getByRole('combobox',{name:'Set / expansion',exact:true});
  await set.fill('tla'); await set.press('Enter');
  await page.waitForFunction(()=>document.querySelector('[data-results]')?.textContent==='286 unique cards');
  await set.fill('tle'); await set.press('Enter');
  await page.waitForFunction(()=>document.querySelector('[data-results]')?.textContent==='524 unique cards');
  await page.locator('.lab-add').first().click();
  const selectedName=await page.locator('.lab-add').first().getAttribute('data-card');
  await page.locator('.lab-tile').first().evaluate(el=>el.dataset.preserved='yes');
  await page.locator('[data-action=load-more]').click();
  await page.waitForFunction(()=>document.querySelectorAll('.lab-tile').length===120);
  assert.equal(await page.locator('.lab-tile').first().getAttribute('data-preserved'),'yes','append preserves existing result nodes');
  await page.locator('[data-mode=full]').click();
  assert.equal(await page.locator('.lab-full-card').count(),120);
  await page.locator('[data-action=selection]').first().click();
  assert.match(await page.locator('.lab-pool').innerText(),new RegExp(selectedName.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  await page.locator('[data-action=close]').click();
  await page.locator('[data-view=builder]').click();
  await page.locator('[data-action=new]').click();
  await page.locator('[data-action=selection]').first().click();
  await page.locator('.lab-transfer input').fill('Avatar research');
  await page.locator('.lab-transfer button[type=submit]').click();
  assert.match(await page.locator('.lab-deck-heading').innerText(),/1 candidate/);
  await page.locator('[data-view=search]').click();
  await page.locator('[data-mode=images]').click();
  await page.locator('.lab-unique').selectOption('prints');
  await page.waitForFunction(()=>document.querySelector('[data-results]')?.textContent==='711 printings');
  await page.locator('.lab-unique').selectOption('cards');
  await page.waitForFunction(()=>document.querySelector('[data-results]')?.textContent==='524 unique cards');
  await page.evaluate(()=>scrollTo(0,0));
  await page.screenshot({path:'/tmp/deck-lab-full-catalog.png'});
  await page.locator('[data-action=advanced]').click();
  await page.getByRole('textbox',{name:'Advanced query',exact:true}).fill('t:creature mv<=2');
  await page.getByRole('button',{name:'Apply query',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.lab-search-status')?.hidden===true && document.querySelector('[data-results]')?.textContent!=='524 unique cards');
  assert.ok(await page.locator('.lab-tile').count()>0);
  // Walk every batch through the real API and check totals and deduplication.
  const names=new Set(); let offset=0; let total=0;
  do {
    const response=await page.request.post(`${url}/cards/search`,{data:{sets:['tla','tle'],offset,limit:120}});
    assert.equal(response.status(),200);
    const body=await response.json(); total=body.total;
    for(const card of body.cards){assert.equal(names.has(card.name),false);names.add(card.name);}
    offset=body.nextOffset;
  } while(offset!==null);
  assert.equal(names.size,total); assert.equal(total,524);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  // Controlled transport failures and out-of-order replies must not corrupt results.
  const exampleResponse = await page.request.post(`${url}/cards/search`,{data:{sets:['tla'],limit:1}});
  const example = await exampleResponse.json();
  let failOnce = true;
  await page.route('**/cards/search', async route => {
    const body = route.request().postDataJSON();
    if (body.query === 'broken' && failOnce) {
      failOnce = false;
      return route.fulfill({status:503,json:{message:'Catalog temporarily unavailable'}});
    }
    if (['slow','fast','broken'].includes(body.query)) {
      if (body.query === 'slow') await new Promise(resolve=>setTimeout(resolve,500));
      try { await route.fulfill({json:{...example,total:body.query === 'slow' ? 111 : 222,nextOffset:null}}); } catch { /* superseded request was aborted */ }
      return;
    }
    return route.continue();
  });
  const search = page.locator('.lab-query input');
  await search.fill('broken'); await search.press('Enter');
  await page.getByRole('button',{name:'Retry',exact:true}).waitFor();
  assert.match(await page.locator('.lab-search-status').innerText(),/temporarily unavailable/);
  await page.getByRole('button',{name:'Retry',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('[data-results]')?.textContent==='222 unique cards');
  await search.fill('slow'); await search.press('Enter');
  await search.fill('fast'); await search.press('Enter');
  await page.waitForFunction(()=>document.querySelector('[data-results]')?.textContent==='222 unique cards');
  await page.waitForTimeout(600);
  assert.equal(await page.locator('[data-results]').textContent(),'222 unique cards');
  assert.equal(await page.locator('.lab-selection [data-count]').textContent(),'1');
  assert.deepEqual(errors,[]);
  console.log('Full catalog verified: TLA OR TLE = 524 unique cards / 711 printings. Pagination, Selection, Builder transfer and advanced filters passed.');
} finally { await browser.close(); }
