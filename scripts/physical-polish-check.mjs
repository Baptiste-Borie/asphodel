// V2h "PHYSICAL COMPANION PLAYTEST UX / RUNTIME POLISH" — targeted browser validation for the
// items this pass actually changed: global hover-preview clipping, the autocomplete's bounded
// height, the fanned opening-hand review, major phase transitions, the newly-played-card reveal,
// and the commander tax badge's zero/non-zero visibility. Complements (never replaces)
// physical-art-check.mjs / physical-redesign-check.mjs / tabletop-visual-check.mjs, which already
// cover the pre-existing surface.
import assert from 'node:assert/strict';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.setDefaultTimeout(6000);
const errors = []; page.on('pageerror', (error) => errors.push(error.message));

const card = (name, id, zone = 'battlefield', typeLine = 'Creature', extra = {}) => ({
  name, cardRef: id, zone, typeLine, ownerId: 'human', controllerId: 'human', hidden: false, faceDown: false,
  tapped: false, summoningSick: false, counters: {}, power: typeLine.includes('Creature') ? 2 : null,
  toughness: typeLine.includes('Creature') ? 2 : null, combatKeywords: [], ...extra,
});
const player = (playerId, role) => ({
  playerId, role, name: role === 'self' ? 'You' : 'Asphodel', life: 40, startingLife: 40, handSize: 7,
  librarySize: 80, graveyardSize: 0, exileSize: 0, commandZoneSize: 1, battlefieldSize: 2, externalController: true,
  battlefield: [card('Sol Ring', playerId + 'sol', 'battlefield', 'Artifact'), card('Forest', playerId + 'f', 'battlefield', 'Basic Land')],
  graveyard: [], exile: [],
  command: [card('Uurg, Spawn of Turg', playerId + 'c', 'command')],
  commanders: [{ cardRef: playerId + 'c', name: 'Uurg, Spawn of Turg', inCommandZone: true, castsFromCommand: 0, commanderTaxGeneric: 0 }],
  ...(role === 'self' ? { hand: [card('Forest', 'hand1', 'hand', 'Basic Land')] } : {}),
});
const observation = { gameRef: 'polish', game: { turn: 1, phase: 'main1', activePlayerId: 'ai', priorityPlayerId: 'human' }, selfPlayerId: 'human', players: [player('human', 'self'), player('ai', 'opponent')], stack: [] };
const passItem = { control: 'pass', label: 'Pass priority', choice: { decisionId: 'd', kind: 'action', choice: 'exact-pass', reason: '' } };
const state = {
  playMode: 'physical', sessionId: 'polish', status: 'waiting_for_human', humanDeckName: 'Fixture', asphodelDeckName: 'Fixture',
  observation, pendingDecision: { decisionId: 'd', type: 'priority_action', context: { ...observation.game, stackSize: 0 }, rendered: { kind: 'menu', title: 'Choose an action', items: [passItem] }, selectedCardRefs: null, combatPairings: null },
  publicEvents: [], frames: [], asphodelDecisionCount: 0, endedByHuman: false, result: null, error: null,
};
let started = false;
const submittedChoices = [];
await page.route('**/playtests**', (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/playtests' && route.request().method() === 'POST') {
    started = true;
    return route.fulfill({ json: { sessionId: state.sessionId, status: state.status } });
  }
  if (route.request().method() === 'POST') {
    submittedChoices.push(route.request().postDataJSON());
    return route.fulfill({ json: { accepted: true } });
  }
  return route.fulfill({ json: started ? state : { active: false } });
});
await page.route('**/decks', (route) => route.fulfill({ json: { decks: [] } }));
const svg = (text) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="672"><rect width="480" height="672" fill="#466554"/><text x="20" y="340" fill="white">${text}</text></svg>`);
await page.route('**/cards/presentation', async (route) => {
  if (process.env.CONFORMANCE_REAL_ART === '1') return route.continue();
  const names = route.request().postDataJSON().names;
  return route.fulfill({ json: { cards: Object.fromEntries(names.map((name) => [name, { name, imageUri: svg(name), artUri: svg(name), manaCost: null, manaValue: 0, typeLine: '', oracleText: '' }])) } });
});

const { mkdir } = await import('node:fs/promises');
const output = process.env.POLISH_OUTPUT_DIR ?? '/tmp/asphodel-polish';
await mkdir(output, { recursive: true });

const url = process.env.TABLETOP_URL ?? 'http://127.0.0.1:5173';
await page.goto(url);
await page.locator('#nav-play').click();
await page.locator('input[value="physical"]').check();
await page.getByRole('button', { name: 'Start Playtest', exact: true }).click();
await page.locator('.physical-board').first().waitFor();
assert.equal(started, true);

// --- 1. Commander tax badge: zero tax stays hidden, non-zero shows the exact "+N" badge --------
await page.waitForTimeout(400);
const human = page.locator('.physical-board[data-player-id="human"]');
assert.equal(await human.locator('.table-commander-tax').count(), 0, 'zero commander tax must render no badge at all');
observation.players[0].commanders[0].castsFromCommand = 1;
observation.players[0].commanders[0].commanderTaxGeneric = 2;
await page.waitForTimeout(400);
assert.equal(await human.locator('.table-commander-tax').textContent(), '+2');

// --- 2. Global hover-preview: never clipped, even for a card near the viewport's right edge -----
const handCard = human.locator('.physical-hand .table-card--hand').first();
await handCard.hover();
await page.waitForTimeout(250);
const preview = page.locator('.table-preview:not([hidden])');
await preview.waitFor();
await page.screenshot({ path: `${output}/hover-preview-1920.png` });
let box = await preview.boundingBox();
const viewport = page.viewportSize();
assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height, 'hover preview must stay fully inside the viewport (center card)');
// Force the source card toward the right edge and re-check the clamp actually engages there too.
await page.mouse.move(0, 0);
await page.waitForTimeout(200);
await page.evaluate(() => { document.querySelector('.physical-hand .table-card--hand').scrollIntoView({ inline: 'end' }); });
// Stay inside the rounded card silhouette (the extreme corner belongs to the hand container).
await handCard.hover({ position: { x: 8, y: 8 } });
await page.waitForTimeout(250);
box = await preview.boundingBox();
assert.ok(box && box.x >= 0 && box.x + box.width <= viewport.width, 'hover preview remains inside viewport');
await page.mouse.move(0, 0);
await page.waitForTimeout(250);

// V2: hover state, independent P/T tones, overflow, pin/restore, current observation refresh.
const opponent = page.locator('.physical-board[data-player-id="ai"]');
const stateCard = card('Serra Angel', 'state-card', 'battlefield', 'Creature — Angel', {
  power: 5, toughness: 2, basePower: 4, baseToughness: 4, summoningSick: true,
  combatKeywords: ['flying','vigilance','menace','lifelink'], counters: {'+1/+1': 1},
});
observation.players[1].battlefield.push(stateCard);
await page.waitForTimeout(1900);
const angel = opponent.locator('[data-card-ref="state-card"]');
await angel.hover();
await page.waitForTimeout(150);
assert.match(await preview.innerText(), /Current state/i);
assert.match(await preview.innerText(), /Base 4 \/ 4/);
assert.equal(await angel.locator('[data-tone="raised"]').textContent(), '5');
assert.equal(await angel.locator('[data-tone="lowered"]').textContent(), '2');
assert.equal(await angel.locator('.table-card-keyword-overflow').textContent(), '+2');
await angel.locator('.table-card-keyword').first().hover();
assert.equal(await page.locator('.card-state-tooltip:not([hidden])').count(), 1);
await angel.click({button:'right'});
await page.mouse.move(5,5);
await page.waitForTimeout(350);
assert.equal(await page.locator('.physical-inspection-pinned').count(), 1);
await opponent.locator('[data-card-ref="aisol"]').hover();
assert.match(await preview.innerText(), /Sol Ring/);
await page.mouse.move(5,5); await page.waitForTimeout(350);
assert.match(await preview.innerText(), /Serra Angel/);
stateCard.power = 6;
await page.waitForTimeout(500);
assert.equal(await preview.locator('.inspection-state [data-tone="raised"]').textContent(), '6');
for (const size of [{width:1920,height:1080},{width:1366,height:768}]) {
  await page.setViewportSize(size); await page.waitForTimeout(350);
  const rail = await preview.boundingBox(); const twin = await human.boundingBox();
  assert.ok(twin.x + twin.width < rail.x, 'pinned inspector must not overlap digital twin');
  await page.screenshot({path:`${output}/v2-inspection-${size.width}.png`});
}
await page.keyboard.press('Escape');
assert.equal(await page.locator('.physical-inspection-pinned').count(), 0);
await page.screenshot({path:`${output}/v2-normal-1366.png`});
await page.setViewportSize({width:1920,height:1080});
await page.screenshot({path:`${output}/v2-normal-1920.png`});

// --- 3. Autocomplete: a broad candidate pool stays bounded and internally scrollable ------------
const manyCandidates = Array.from({ length: 60 }, (_, i) => ({ name: `Fixture Card ${i}`, remaining: 1 }));
state.pendingDecision = {
  decisionId: 'declare', type: 'physical_identity_declare', context: { ...observation.game, stackSize: 0 }, selectedCardRefs: null, combatPairings: null,
  rendered: { kind: 'physical_declare', title: 'Declare your opening hand', decisionId: 'declare', count: 7, eventKind: 'draw', candidates: manyCandidates },
};
await page.waitForTimeout(500);
const input = page.getByRole('combobox', { name: 'Declare a card', exact: true });
assert.equal(await input.evaluate(el => el === document.activeElement), true, 'opening a declaration focuses its search after mounting');
await input.fill('Fixture');
await page.waitForTimeout(150);
await page.screenshot({ path: `${output}/autocomplete-bounded.png` });
const resultsBox = await page.locator('.card-search-results').boundingBox();
assert.ok(resultsBox && resultsBox.height <= 280, `autocomplete list must stay bounded, was ${resultsBox?.height}px`);
assert.equal(await page.evaluate(() => { const el = document.querySelector('.card-search-results'); return getComputedStyle(el).overflowY; }), 'auto', 'autocomplete list must scroll internally rather than growing unbounded');
// Keyboard nav must keep working with the now-scrollable list.
await page.keyboard.press('ArrowDown');
await page.keyboard.press('ArrowDown');
assert.equal(await page.locator('.card-search-result--active').count(), 1);

// --- 4. Opening hand review: all seven cards + Keep/Mulligan fit without scrolling, both sizes --
const openingHand = Array.from({ length: 7 }, (_, i) => card(`Hand Card ${i}`, `hand-${i}`, 'hand', 'Creature'));
observation.players[0].hand = openingHand;
state.pendingDecision = {
  decisionId: 'keep-mull', type: 'yes_no', context: { ...observation.game, stackSize: 0 }, selectedCardRefs: null, combatPairings: null,
  rendered: { kind: 'opening_hand', title: 'Opening hand', items: [{ label: 'Keep', choice: { decisionId: 'keep-mull', kind: 'action', choice: 'yes', reason: '' } }, { label: 'Mulligan', choice: { decisionId: 'keep-mull', kind: 'action', choice: 'no', reason: '' } }] },
};
for (const size of [{ width: 1920, height: 1080 }, { width: 1366, height: 768 }]) {
  await page.setViewportSize(size);
  await page.waitForTimeout(500);
  assert.equal(await page.locator('.opening-hand-fan .table-card--hand').count(), 7, `all 7 cards render at ${size.width}x${size.height}`);
  const keep = page.getByRole('button', { name: 'Keep', exact: true });
  const mulligan = page.getByRole('button', { name: 'Mulligan', exact: true });
  await keep.waitFor(); await mulligan.waitFor();
  await page.screenshot({ path: `${output}/opening-hand-review-${size.width}.png` });
  const dockBox = await page.locator('.table-decision-dock').boundingBox();
  assert.ok(dockBox.y >= 0 && dockBox.y + dockBox.height <= size.height, `the whole opening-hand dock fits on screen at ${size.width}x${size.height} without scrolling`);
  const keepBox = await keep.boundingBox();
  assert.ok(keepBox.y >= 0 && keepBox.y + keepBox.height <= size.height, 'Keep stays visible without scrolling');
}
await page.setViewportSize({ width: 1920, height: 1080 });

// --- 5. Major phase transition banner: fires once on a genuine turn change ----------------------
state.pendingDecision = { decisionId: 'd2', type: 'priority_action', context: { ...observation.game, turn: 2, activePlayerId: 'human', priorityPlayerId: 'human', stackSize: 0 }, rendered: { kind: 'menu', title: 'Choose an action', items: [passItem] }, selectedCardRefs: null, combatPairings: null };
observation.game = { ...observation.game, turn: 2, activePlayerId: 'human', priorityPlayerId: 'human' };
await page.waitForTimeout(500);
assert.ok(await page.locator('.table-phase-banner--visible').count() >= 1 || (await page.locator('.table-phase-banner').textContent()) === 'YOUR TURN', 'a turn-change shows the YOUR TURN banner');

// --- 6. Newly played card reveal: a fresh non-land battlefield arrival gets a large presentation
observation.players[1].battlefield = [...observation.players[1].battlefield, card('Reveal Test Creature', 'reveal-1', 'battlefield', 'Creature')];
state.pendingDecision = { ...state.pendingDecision, decisionId: 'd3' };
await page.waitForTimeout(500);
assert.equal(await page.locator('.table-card-reveal--visible .table-card-reveal-card').count(), 1, 'a new non-land permanent gets a temporary large reveal');
await page.screenshot({ path: `${output}/card-reveal.png` });

// --- 7. Card state iconography: a reported combat keyword shows its compact original pictogram --
observation.players[1].battlefield = observation.players[1].battlefield.map((c) =>
  c.cardRef === 'reveal-1' ? { ...c, combatKeywords: ['vigilance', 'flying'] } : c);
state.pendingDecision = { ...state.pendingDecision, decisionId: 'd4' };
await page.waitForTimeout(500);
const revealedCard = page.locator('.physical-board[data-player-id="ai"] [data-card-ref="reveal-1"]');
assert.equal(await revealedCard.locator('.table-card-keyword').count(), 2, 'vigilance + flying each get a compact icon');
assert.equal(await revealedCard.locator('.table-card-keyword[title="Vigilance"]').count(), 1);

// --- 8. Combat readability: a declared attacker shows what it is attacking -----------------------
state.pendingDecision = {
  decisionId: 'attack', type: 'attackers_selection', context: { ...observation.game, stackSize: 0 }, selectedCardRefs: ['reveal-1'],
  combatPairings: [{ cardRef: 'reveal-1', relatedRef: 'human' }],
  rendered: { kind: 'menu', title: 'Declare attackers', items: [{ label: 'Finish declaring attackers/blockers', choice: { decisionId: 'attack', kind: 'object', choice: 'finish', reason: '' } }] },
};
await page.waitForTimeout(500);
const attackTag = page.locator('.physical-board[data-player-id="ai"] [data-card-ref="reveal-1"] .table-card-combat-tag');
await attackTag.waitFor();
assert.equal(await attackTag.textContent(), 'Attacking You', 'the attacker names its target directly on the card');
await page.screenshot({ path: `${output}/combat-attack-tag.png` });

// A queued instant gets a readable reveal; later frames and the human decision wait for it.
await page.keyboard.press('Escape');
const castObservation = structuredClone(observation);
castObservation.game = {...castObservation.game, turn:3, activePlayerId:'ai', priorityPlayerId:'ai'};
castObservation.stack = [{stackRef:'cast-bolt',position:0,sourceCardRef:'bolt',sourceCardName:'Lightning Bolt',controllerId:'ai',description:null,hidden:false,faceDown:false}];
const resolvedObservation = structuredClone(castObservation); resolvedObservation.stack = [];
state.frames = [
  {id:1,observation:castObservation,event:{id:1,turn:3,phase:'main1',text:'Asphodel casts Lightning Bolt'}},
  {id:2,observation:resolvedObservation,event:null},
];
state.observation = resolvedObservation;
state.pendingDecision = {decisionId:'after-playback',type:'priority_action',context:{...resolvedObservation.game,stackSize:0},rendered:{kind:'menu',title:'Choose an action',items:[passItem]},selectedCardRefs:null};
await page.locator('.table-card-reveal--visible .table-reveal-caption').waitFor();
assert.equal(await page.getByRole('button',{name:'Pass priority',exact:true}).count(),0);
await page.waitForTimeout(1500);
assert.equal(await page.locator('.table-card-reveal--visible .table-reveal-caption').textContent(),'Asphodel casts Lightning Bolt');
assert.equal(await page.getByRole('button',{name:'Stack · 1',exact:true}).count(),1);
await page.screenshot({path:`${output}/v2-spell-playback.png`});
await page.getByRole('button',{name:'Continue · Esc',exact:true}).click();
await page.waitForFunction(() => document.querySelector('.table-root')?.getAttribute('data-playback') === 'idle');
assert.match(await page.locator('.table-decision-dock').innerText(), /Pass priority/);
assert.equal(await page.getByRole('button',{name:'Stack · 0',exact:true}).count(),1);

// An old DOM callback must never submit twice, even when polling repeats N after acceptance.
const setPriority = id => {
  state.pendingDecision = {decisionId:id,type:'priority_action',context:{...state.observation.game,stackSize:0},
    rendered:{kind:'menu',title:'Choose an action',items:[{...passItem,choice:{...passItem.choice,decisionId:id}}]},selectedCardRefs:null};
};
setPriority('stabilization-N');
await page.waitForTimeout(800);
await page.evaluate(() => { window.stalePass = document.querySelector('.decision-option--pass'); });
await page.locator('.decision-option--pass').click();
await page.waitForTimeout(800);
assert.equal(submittedChoices.filter(c=>c.decisionId==='stabilization-N').length,1);
assert.equal(await page.locator('.decision-option--pass').count(),0,'consumed N must not remount');
setPriority('stabilization-N+1');
await page.waitForTimeout(800);
await page.evaluate(() => window.stalePass.click());
await page.waitForTimeout(100);
assert.equal(submittedChoices.filter(c=>c.decisionId==='stabilization-N').length,1,'detached stale callback rejected');
await page.locator('.decision-option--pass').click();
await page.waitForTimeout(200);
assert.equal(submittedChoices.filter(c=>c.decisionId==='stabilization-N+1').length,1);

await page.evaluate(() => { window.bufferedSpace = new KeyboardEvent('keydown', {code:'Space',bubbles:true}); });
setPriority('space-guard');
state.pendingDecision.rendered.title='Space guard priority';
await page.getByText('Space guard priority',{exact:true}).waitFor();
await page.evaluate(() => { document.activeElement?.blur(); });
await page.keyboard.press('Space');
assert.equal(submittedChoices.filter(c=>c.decisionId==='space-guard').length,0,'newly mounted priority must resist rapid Space');
await page.waitForTimeout(750);
await page.evaluate(() => document.body.dispatchEvent(window.bufferedSpace));
await page.waitForTimeout(100);
assert.equal(submittedChoices.filter(c=>c.decisionId==='space-guard').length,0,'buffered old event cannot answer a new window');
await page.keyboard.press('Space');
await page.waitForTimeout(200);
assert.equal(submittedChoices.filter(c=>c.decisionId==='space-guard').length,1,'a deliberate fresh key remains usable');
for (const type of ['attackers_selection','blockers_selection']) {
  await page.locator('.physical-board[data-player-id="ai"] .physical-board-focus').click();
  state.pendingDecision={decisionId:type,type,context:{...state.observation.game,stackSize:0},
    rendered:{kind:'menu',title:type,items:[]},selectedCardRefs:[],combatPairings:[]};
  await page.getByText(type,{exact:true}).waitFor();
  assert.equal(await human.getAttribute('data-density'),'primary','human combat automatically focuses the human board');
}

assert.deepEqual(errors, []);
await browser.close();
console.log('Polish checks passed: commander tax zero/non-zero, hover-preview clamped to viewport, bounded scrollable autocomplete, fanned opening-hand review at 1920/1366 without scrolling, phase transition banner, newly played card reveal, keyword icons, combat attacker/target tag.');
