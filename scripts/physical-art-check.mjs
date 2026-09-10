import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1920,height:1080}});
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

const {mkdir} = await import('node:fs/promises');
const output = process.env.ART_OUTPUT_DIR ?? '/tmp/asphodel-art'; await mkdir(output,{recursive:true});
const shot = async name => { await page.waitForTimeout(600); await page.screenshot({path:`${output}/${name}.png`}); };
const checkInspection = async () => {
  const card = await page.locator('.table-preview-card').boundingBox();
  const panel = await page.locator('.table-preview').boundingBox();
  const viewport = page.viewportSize();
  assert.ok(card && panel && card.y >= 0 && card.x >= 0 && card.y + card.height <= viewport.height && card.x + card.width <= viewport.width, 'full printed inspection card must remain on screen');
};
await shot('normal-1920');
const tray = await page.locator('.table-decision-dock').boundingBox();
assert.ok(tray.height<120,'simple action tray should stay compact');
await opponent.locator('[data-card-ref="aisol"]').click();
await shot('inspection-1920');
await checkInspection();
await opponent.locator('[data-card-ref="aisol"]').click();
state.observation.stack=[{stackRef:'s1',position:0,sourceCardRef:'spell1',sourceCardName:'Cultivate',controllerId:'ai',description:'Search your library',hidden:false,faceDown:false},{stackRef:'s2',position:1,sourceCardRef:'spell2',sourceCardName:'Sol Ring',controllerId:'human',description:null,hidden:false,faceDown:false}];
await page.waitForTimeout(700); await page.getByRole('button',{name:'Stack · 2',exact:true}).click();
await shot('stack-1920'); await page.getByRole('button',{name:'Close stack ×',exact:true}).click();
await page.setViewportSize({width:1366,height:768}); await shot('normal-1366');
await opponent.locator('[data-card-ref="aisol"]').click(); await shot('inspection-1366');
await checkInspection();
await opponent.locator('[data-card-ref="aisol"]').click();
const army = Array.from({length:32},(_,i)=>({...card('Goblin',`g${i}`),token:true,tapped:i<16,power:1,toughness:1,counters:i>=30?{'+1/+1':1}:{}}));
const field = [...army,...Array.from({length:16},(_,i)=>({...card(i<10?'Forest':'Swamp',`land${i}`,'battlefield','Basic Land'),tapped:i<5})),...Array.from({length:12},(_,i)=>({...card('Llanowar Elves',`elf${i}`),power:i%3+1,toughness:i%3+1,counters:{'+1/+1':i}}))];
observation.players[1].battlefield=field;
observation.players[1].command.push(card('Ravos, Soultender','partner','command'));
observation.players[1].commanders=[{cardRef:'aic',castsFromCommand:1,commanderTaxGeneric:2,name:'Uurg, Spawn of Turg',inCommandZone:true},{cardRef:'partner',castsFromCommand:2,commanderTaxGeneric:4,name:'Ravos, Soultender',inCommandZone:true}];
observation.players[1].handSize=17;
observation.players[1].graveyard=Array.from({length:20},(_,i)=>card('Cultivate',`grave${i}`,'graveyard','Sorcery')); observation.players[1].graveyardSize=20;
await shot('stress-1366');
assert.equal(await opponent.locator('.table-card-count').filter({hasText:'×16'}).count(),1);
const collidingBadges = await opponent.locator('[data-card-variant="battlefield"]').evaluateAll(cards => cards.filter(card => {
  const count = card.querySelector('.table-card-count')?.getBoundingClientRect();
  const stats = card.querySelector('.table-card-stats')?.getBoundingClientRect();
  return count && stats && count.left < stats.right && count.right > stats.left && count.top < stats.bottom && count.bottom > stats.top;
}).length);
assert.equal(collidingBadges, 0, 'stack quantity must not cover power/toughness, including tapped groups');
assert.equal(await opponent.locator('.table-commander-tax').count(),2,'both commanders with non-zero tax show the material tax badge (V2h)');
assert.equal(await opponent.locator('.table-commander-tax').first().textContent(),'+2');
assert.equal(await opponent.locator('.table-commander-tax').last().textContent(),'+4');
await page.setViewportSize({width:1920,height:1080}); await shot('stress-1920');
observation.players.push(player('ai2','opponent')); observation.players[2].name='Asphodel II'; await shot('three-overview-1920');
assert.equal(await page.locator('.physical-board').count(),3);
const offTableSeats = await page.locator('.physical-board-focus').evaluateAll(buttons => buttons.filter(button => {
  const rect = button.getBoundingClientRect();
  return rect.left < 0 || rect.right > innerWidth;
}).length);
assert.equal(offTableSeats, 0, 'every seat focus control must stay on screen in three-player overview');
observation.players.push(player('ai3','opponent')); observation.players[3].name='Asphodel III'; await shot('four-overview-1920');
await page.getByRole('button',{name:'Focus Asphodel II',exact:true}).click(); await shot('four-focus-1920');
assert.equal(await page.locator('.physical-board[data-density="preview"]').count(),3);
await page.getByRole('button',{name:'Overview',exact:true}).click();
observation.players.splice(2);
for(const p of observation.players) {p.battlefield=[];p.graveyard=[];p.exile=[];p.graveyardSize=0;p.exileSize=0;}
state.observation.stack=[];
const declaration={decisionId:'declare',type:'physical_identity_declare',context:{...observation.game,stackSize:0},selectedCardRefs:null,rendered:{kind:'physical_declare',title:'Declare your opening hand',decisionId:'declare',count:7,eventKind:'opening_hand',candidates:['Forest','Swamp','Sol Ring','Llanowar Elves','Cultivate','Uurg, Spawn of Turg'].map(name=>({name,remaining:name==='Forest'?15:1}))}};
state.pendingDecision=declaration;
await shot('opening-empty-1920');
const input = page.getByRole('combobox',{name:'Declare a card',exact:true});
for(const name of ['Forest','Forest','Swamp']) { await input.fill(name); await page.getByRole('option').first().click(); }
await shot('opening-picked-1920');
assert.equal(await page.locator('.physical-declare-slot--filled').count(),3);
assert.equal(await page.getByRole('button',{name:'Confirm',exact:true}).isDisabled(),true);
await page.getByRole('button',{name:'Remove Forest',exact:true}).first().click();
assert.equal(await page.locator('.physical-declare-slot--filled').count(),2);
await input.fill('Forest'); await page.getByRole('option').first().click();
await page.setViewportSize({width:1366,height:768}); await shot('opening-picked-1366');
for(const name of ['Sol Ring','Llanowar Elves','Cultivate','Uurg, Spawn of Turg']) {await input.fill(name);await page.getByRole('option').first().click();}
await shot('opening-ready-1366');
await page.getByRole('button',{name:'Confirm',exact:true}).click();
assert.equal(submissions.at(-1).kind,'physical_identity'); assert.equal(submissions.at(-1).declaredNames.length,7); assert.equal(submissions.at(-1).decisionId,'declare');
assert.deepEqual(errors,[]);
await browser.close();
console.log(`Art checks passed, screenshots: ${output}. Normal, inspection, stack, 16 lands/32 tokens/counters/partners, 3/4 seats, focus, declaration/search/edit/exact submission.`);
