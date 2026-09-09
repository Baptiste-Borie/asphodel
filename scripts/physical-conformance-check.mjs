import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1366,height:768}});
page.setDefaultTimeout(6000);
const errors = []; page.on('pageerror',error=>errors.push(error.message));
const card=(name,id,zone='battlefield',typeLine='Creature')=>({name,cardRef:id,zone,typeLine,ownerId:'human',controllerId:'human',hidden:false,faceDown:false,tapped:false,summoningSick:false,counters:{},power:typeLine.includes('Creature')?2:null,toughness:typeLine.includes('Creature')?2:null});
const player=(playerId,role)=>({playerId,role,name:role==='self'?'You':'Asphodel',life:40,startingLife:40,handSize:7,librarySize:80,graveyardSize:1,exileSize:1,commandZoneSize:1,battlefieldSize:5,externalController:true,battlefield:[card('Sol Ring',playerId+'sol','battlefield','Artifact'),card('Llanowar Elves',playerId+'elf'),card('Forest',playerId+'f','battlefield','Basic Land'),{...card('Swamp',playerId+'s','battlefield','Basic Land'),tapped:true}],graveyard:[card('Cultivate',playerId+'g','graveyard','Sorcery')],exile:[card('Sol Ring',playerId+'x','exile','Artifact')],command:[card('Uurg, Spawn of Turg',playerId+'c','command')],commanders:[],...(role==='self'?{hand:[card('Forest','hand','hand','Basic Land')]}:{})});
const observation={gameRef:'conformance',game:{turn:3,phase:'main1',activePlayerId:'ai',priorityPlayerId:'human'},selfPlayerId:'human',players:[player('human','self'),player('ai','opponent')],stack:[]};
const state={playMode:'physical',sessionId:'conformance',status:'waiting_for_human',humanDeckName:'Fixture',asphodelDeckName:'Fixture',observation,pendingDecision:{decisionId:'d',type:'priority_action',context:{...observation.game,stackSize:0},rendered:{kind:'menu',title:'Choose an action',items:[{control:'pass',label:'Pass priority',choice:{decisionId:'d',kind:'action',choice:'exact-pass',reason:''}}]},selectedCardRefs:null},publicEvents:[],frames:[],asphodelDecisionCount:0,endedByHuman:false,result:null,error:null};
let started = false;
const submissions=[];
await page.route('**/playtests**', route => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/playtests' && route.request().method() === 'POST') {
    assert.equal(route.request().postDataJSON().playMode,'physical'); started = true;
    return route.fulfill({json:{sessionId:state.sessionId,status:state.status}});
  }
  if (route.request().method() === 'POST') { submissions.push(route.request().postDataJSON()); return route.fulfill({json:{accepted:true}}); }
  return route.fulfill({json:started ? state : {active:false}});
});
await page.route('**/decks',route=>route.fulfill({json:{decks:[]}}));
const svg = text => 'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="340"><rect width="480" height="340" fill="#466554"/><path d="M0 260L160 50L300 270L420 120L480 340H0" fill="#233c30"/><text x="30" y="320" fill="white">${text}</text></svg>`);
await page.route('**/cards/presentation', async route => {
  if (process.env.CONFORMANCE_REAL_ART === '1') return route.continue();
  const names = route.request().postDataJSON().names;
  return route.fulfill({json:{cards:Object.fromEntries(names.map(name=>[name,{name,imageUri:svg('PRINTED RULES TEXT'),artUri:svg('ART ONLY'),manaCost:null,manaValue:0,typeLine:'',oracleText:'Printed rules text'}]))}});
});
const url=process.env.TABLETOP_URL ?? 'http://127.0.0.1:5173';
await page.goto(url);
await page.locator('#nav-play').click();
await page.locator('input[value="physical"]').check();
await page.getByRole('button',{name:'Start Playtest',exact:true}).click();
await page.locator('.physical-board').first().waitFor();
assert.equal(started,true);
const self=page.locator('.physical-board[data-player-id="human"]');
const opponent=page.locator('.physical-board[data-player-id="ai"]');
const measure = async () => page.evaluate(()=> {
  const rect = selector => { const r=document.querySelector(selector).getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right}; };
  return {
    primary:rect('.physical-board[data-density="primary"]'),preview:rect('.physical-board[data-density="preview"]'),
    header:rect('.physical-board[data-density="primary"] .physical-board-header'),life:rect('.physical-board[data-density="primary"] .physical-life'),
    card:rect('.physical-board[data-density="primary"] [data-card-variant="battlefield"]'),land:rect('.physical-board[data-density="primary"] [data-card-variant="land"]'),
    command:rect('.physical-board[data-density="primary"] .table-commander-dock'),
  };
});
assert.equal(await page.locator('.table-root').getAttribute('data-play-mode'),'physical');
assert.equal(await page.locator('.table-battlefield-half').count(),0,'legacy seats must not be mounted in Physical');
assert.equal(await page.locator('.physical-board .table-battlefield-cards .table-card-image').count(),0,'printed images never used for battlefield');
assert.equal(await page.locator('.physical-board .table-battlefield-cards .table-card-art').count(),4);
await page.waitForTimeout(450);
let metrics=await measure();
assert.ok(metrics.primary.width*metrics.primary.height > 4*metrics.preview.width*metrics.preview.height,'opponent dominates actual area');
assert.ok(metrics.card.width >= 140,'primary cards are readable, not preview sized');
assert.ok(metrics.land.width <= metrics.card.width*.5,'lands intentionally subordinate');
assert.ok(metrics.life.y >= metrics.header.y && metrics.life.bottom <= metrics.header.bottom+1,'life belongs to header');
assert.ok(metrics.command.y >= metrics.primary.y && metrics.command.bottom <= metrics.primary.bottom+1,'command cards inside seat');
assert.ok(metrics.preview.bottom <= 768-150,'self-view above action dock');
assert.equal(await opponent.locator('.table-pile--graveyard img').count(),1);
assert.equal(await opponent.locator('.table-pile--exile img').count(),1);
await page.waitForFunction(()=>[...document.querySelectorAll('.table-card-art')].every(img=>img.complete && img.naturalWidth>0));
await page.screenshot({path:'/tmp/physical-conformance-1366.png'});
await opponent.locator('[data-card-ref="aisol"]').click();
assert.equal(await page.locator('.table-preview:not([hidden])').count(),1);
assert.equal(submissions.length,0,'inspection does not submit');
await opponent.locator('[data-card-ref="aisol"]').click();
await page.getByRole('button',{name:'Focus You',exact:true}).click();
assert.equal(await self.getAttribute('data-density'),'primary');
observation.game.activePlayerId='human'; observation.players[1].life=37;
await page.waitForTimeout(700);
assert.equal(await self.getAttribute('data-density'),'primary');
assert.equal(await opponent.locator('.physical-life').innerText(),'37');
await page.getByRole('button',{name:'Overview',exact:true}).click();
await page.setViewportSize({width:1920,height:1080});
await page.screenshot({path:'/tmp/physical-conformance-1920.png'});
await page.reload(); await page.locator('.physical-board').first().waitFor();
assert.equal(await page.locator('.table-root').getAttribute('data-play-mode'),'physical','resume uses same Physical composition');
assert.equal(await page.locator('.table-battlefield-half').count(),0);
state.playMode='digital';
await page.reload(); await page.locator('.table-battlefield-half').first().waitFor();
assert.equal(await page.locator('.physical-board').count(),0);
assert.equal(await page.locator('.table-battlefield-half').count(),2);
assert.equal(await page.locator('.table-battlefield [data-card-variant="battlefield"]').count(),0);
assert.ok(await page.locator('.table-battlefield .table-card-image').count()>0,'Digital keeps printed cards');
assert.deepEqual(errors,[]);
console.log(JSON.stringify({passed:'Physical setup/resume, geometry, artwork-only renderer, land density, seat life/command/piles, manual focus, Digital isolation',metrics},null,2));
await browser.close();
