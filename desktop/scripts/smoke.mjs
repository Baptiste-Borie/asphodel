import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const userData = await mkdtemp(join(tmpdir(), 'asphodel-smoke-'));
let electron;
const errors = [];
const artUrl = 'https://cards.scryfall.io/normal/front/a/b/desktop-smoke.png';
async function assertArtworkLoads(page, url) {
  await page.evaluate(url => new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => image.naturalWidth === 1 ? resolve(true) : reject(new Error('Unexpected artwork dimensions'));
    image.onerror = () => reject(new Error('Desktop artwork did not load'));
    image.src = url;
  }), url);
}
const rootFlags = process.platform === 'linux' && process.getuid?.() === 0 ? ['--no-sandbox'] : [];
async function launch() {
  electron = await _electron.launch({ args: [...rootFlags, desktop], env: { ...process.env, ASPHODEL_TEST_USER_DATA: userData }, timeout: 45_000 });
  const page = await electron.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForURL('asphodel://app/', { timeout: 45_000 });
  await page.waitForFunction(() => document.querySelector('#backend-status')?.textContent === 'Prêt');
  return page;
}
try {
  let page = await launch();
  // Exercise the actual renderer HTTPS handler, cache download and image decode
  // without depending on Scryfall availability in CI.
  await electron.evaluate(({ session }) => {
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGPQ9HH8DwADDgG2h6gVAgAAAABJRU5ErkJggg==', 'base64');
    session.fromPartition('asphodel-art-downloads').protocol.handle('https', request =>
      request.url.includes('/desktop-smoke.png')
        ? new Response(png, { headers: { 'content-type': 'image/png' } })
        : new Response('Network disabled in artwork test', { status: 503 }));
  });
  await assertArtworkLoads(page, `${artUrl}?first-launch`);
  const list = await page.evaluate(async () => (await fetch('/decks')).json());
  assert.ok(list.decks.length > 0, 'bundled library loads on first launch');
  const id = list.decks[0].id;
  await page.evaluate(async id => {
    localStorage.setItem('desktop-smoke', 'survives restart');
    const response = await fetch(`/decks/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Desktop persistent deck' }) });
    if (!response.ok) throw new Error('Rename failed');
  }, id);
  // Close immediately after a real builder/table edit, before its debounce can finish.
  await page.getByRole('button', { name: 'Builder', exact: true }).click();
  await page.getByRole('button', { name: 'New empty sheet', exact: true }).click();
  await page.getByLabel('New category name', { exact: true }).fill('Preserved empty role');
  await page.getByLabel('New category name', { exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  assert.equal(await page.locator('[data-rename]').evaluateAll(inputs => inputs.some(input => input.value === 'Preserved empty role')), false);
  await page.getByRole('button', { name: 'Rétablir', exact: true }).click();
  assert.equal(await page.locator('[data-rename]').evaluateAll(inputs => inputs.some(input => input.value === 'Preserved empty role')), true);
  await page.getByRole('button', { name: 'Table V2', exact: true }).click();
  await page.locator('.dt-create summary').click();
  await page.getByLabel('New zone name', { exact: true }).fill('Preserved empty zone');
  await page.getByLabel('New zone name', { exact: true }).press('Enter');
  const zoneId = await page.locator('.dt-zone input').evaluateAll(inputs => inputs.find(input => input.value === 'Preserved empty zone')?.closest('[data-dt-zone]')?.dataset.dtZone);
  assert.ok(zoneId, 'new zone has a stable identity');
  await page.locator('.dt-canvas').press('Control+z');
  assert.equal(await page.locator(`[data-dt-zone="${zoneId}"]`).count(), 0);
  await page.locator('.dt-canvas').press('Control+Shift+z');
  assert.equal(await page.locator(`[data-dt-zone="${zoneId}"]`).count(), 1);
  // One history is shared by both builders, including actions absent from V1's UI.
  await page.getByLabel('Table tools', { exact: true }).click();
  await page.getByRole('button', { name: 'Builder V1', exact: true }).click();
  await page.getByRole('button', { name: 'Annuler', exact: true }).click();
  await page.getByRole('button', { name: 'Table V2', exact: true }).click();
  assert.equal(await page.locator(`[data-dt-zone="${zoneId}"]`).count(), 0);
  await page.getByRole('button', { name: 'Rétablir', exact: true }).click();
  assert.equal(await page.locator(`[data-dt-zone="${zoneId}"]`).count(), 1);
  await page.locator(`[data-resize-zone="${zoneId}"]`).press('ArrowRight');
  assert.equal(await page.locator(`[data-dt-zone="${zoneId}"]`).evaluate(el => el.style.width), '260px');
  await page.locator(`[data-zone-action="lock"][data-zone="${zoneId}"]`).click();
  assert.equal(await page.locator(`[data-resize-zone="${zoneId}"]`).isDisabled(), true);
  await page.locator('.dt-canvas').press('Control+z');
  assert.equal(await page.locator(`[data-resize-zone="${zoneId}"]`).isDisabled(), false);
  await page.locator('.dt-canvas').press('Control+z');
  assert.equal(await page.locator(`[data-dt-zone="${zoneId}"]`).evaluate(el => el.style.width), '250px');
  await page.locator('.dt-canvas').press('Control+y');
  await page.locator('.dt-canvas').press('Control+y');
  // Text remains focused until close: the production checkpoint must finish its history/save.
  await page.getByRole('button', {name:'+ Note',exact:true}).click();
  await page.getByLabel('Texte de la note', {exact:true}).fill('Protection for Aang');
  await page.getByLabel('Couleur de la note', {exact:true}).selectOption('sage');
  await page.getByLabel('Texte de la note', {exact:true}).fill('Protection for Aang — saved before closing');
  const expectedProject = await page.evaluate(() => {
    document.querySelector('.dt-canvas').dispatchEvent(new WheelEvent('wheel', { deltaY: 120, clientX: 400, clientY: 300, bubbles: true, cancelable: true }));
    const key = Object.keys(localStorage).find(key => key.startsWith('asphodel.builder-draft.v1.'));
    if (!key) throw new Error('Builder did not journal its edit');
    return JSON.parse(localStorage.getItem(key)).project;
  });
  await electron.close(); electron = undefined;
  page = await launch();
  await electron.evaluate(({ session }) => {
    session.fromPartition('asphodel-art-downloads').protocol.handle('https', () =>
      new Response('Offline', { status: 503 }));
  });
  // A new query avoids the renderer HTTP cache; only our persistent disk cache
  // can satisfy the request after restart when the downloader is unavailable.
  await assertArtworkLoads(page, `${artUrl}?offline-restart`);
  assert.equal(await page.evaluate(() => localStorage.getItem('desktop-smoke')), 'survives restart');
  assert.equal(await page.evaluate(async id => (await (await fetch(`/decks/${id}`)).json()).name, id), 'Desktop persistent deck');
  const restoredProject = await page.evaluate(async projectId => {
    const library = await (await fetch('/decks')).json();
    for (const deck of library.decks) {
      const detail = await (await fetch(`/decks/${deck.id}`)).json();
      if (detail.project?.projectId === projectId) return detail.project;
    }
    throw new Error('Empty builder project did not survive immediate close');
  }, expectedProject.projectId);
  assert.deepEqual(restoredProject, expectedProject);
  assert.equal(await page.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('asphodel.builder-draft.v1.')).length), 0);
  // Simulate an outstanding disk journal from an interrupted session, then reload the actual UI.
  await page.evaluate(project => localStorage.setItem(`asphodel.builder-draft.v1.${project.projectId}`, JSON.stringify({
    version: 1, project: { ...project, name: 'Recovered interrupted exploration' }, pending: true, updatedAt: new Date().toISOString(),
  })), expectedProject);
  await page.reload();
  await page.getByRole('button', { name: 'Reprendre les brouillons', exact: true }).click();
  await page.locator('.lab-builder [data-save-status][data-status=saved]').waitFor();
  const recovered = await page.evaluate(async () => (await (await fetch('/decks')).json()).decks.filter(d => d.name === 'Recovered interrupted exploration'));
  assert.equal(recovered.length, 1, 'creation retry must reuse the project id rather than duplicate its deck');
  // Real settings/IPC/archive round-trip. Only the operating-system dialogs are stubbed;
  // validation, filesystem writes, SQLite transactions, storage restore and reload are production.
  const archivePath = join(userData, 'portable-library.asphodel.json');
  await electron.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, archivePath);
  await page.evaluate(() => localStorage.setItem('asphodel.voice.approvedVocabulary.v1', JSON.stringify({ version: 1, vocabulary: ['portable vocabulary'] })));
  await page.getByRole('button', { name: 'Paramètres', exact: true }).click();
  await page.getByRole('button', { name: 'Sauvegarder ma bibliothèque', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[data-backup-status]')?.textContent.startsWith('Bibliothèque sauvegardée'));
  const portable = JSON.parse(await readFile(archivePath, 'utf8'));
  assert.equal(portable.format, 'asphodel-library');
  assert.deepEqual(portable.library.projects.find(p => p.projectId === expectedProject.projectId).state.workspace, expectedProject.workspace);
  await page.evaluate(async id => {
    localStorage.setItem('asphodel.voice.approvedVocabulary.v1', 'changed after backup');
    const result = await fetch(`/decks/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Changed after backup' }) });
    if (!result.ok) throw new Error('Smoke rename failed');
  }, id);
  await page.getByRole('button', { name: 'Choisir une sauvegarde…', exact: true }).click();
  await page.locator('[data-backup-preview]:not([hidden])').waitFor();
  await page.getByRole('button', { name: 'Restaurer cette sauvegarde…', exact: true }).click();
  await page.waitForFunction(async id => {
    if (document.querySelector('.desktop-settings')?.open) return false;
    return (await (await fetch(`/decks/${id}`)).json()).name === 'Desktop persistent deck';
  }, id);
  assert.equal(await page.evaluate(() => localStorage.getItem('asphodel.voice.approvedVocabulary.v1')), portable.storage['asphodel.voice.approvedVocabulary.v1']);
  assert.equal(await page.evaluate(() => localStorage.getItem('desktop-smoke')), 'survives restart');
  const rescueNames = await readdir(join(userData, 'backups'));
  assert.equal(rescueNames.length, 1);
  const rescue = JSON.parse(await readFile(join(userData, 'backups', rescueNames[0]), 'utf8'));
  assert.equal(rescue.library.decks.find(d => d.id === id).name, 'Changed after backup');
  assert.equal((await readdir(userData)).includes('pending-library-restore.json'), false);
  await page.getByRole('button', { name: 'Builder', exact: true }).click();
  await page.locator(`[data-open-deck="saved:${recovered[0].id}"]`).click();
  await page.getByRole('button', { name: 'Exporter', exact: true }).click();
  assert.match(await page.getByLabel('Liste du deck à exporter', { exact: true }).inputValue(), /^Commander\n/);
  assert.equal(await page.locator('[data-export-candidates]').isChecked(), false);
  await page.getByRole('button', { name: 'Fermer l’export', exact: true }).click();
  // Real seeded cards exercise pile rendering, pointer capture and persisted state.
  await page.getByRole('button', { name: 'Back to all decks', exact: true }).click();
  await page.locator(`[data-open-deck="saved:${id}"]`).click();
  await page.getByRole('button', { name: 'Table V2', exact: true }).click();
  await page.locator('.lab-table [data-save-status][data-status=saved]').waitFor();
  await page.locator('[data-dt-card]').first().press('Enter');
  await page.getByRole('button', {name:'Inspecter',exact:true}).click();
  await page.locator('.lab-inspect[open] .lab-inspection-info').waitFor();
  assert.ok(await page.locator('.lab-inspection-info h2').textContent());
  await page.getByRole('button', {name:'Ajouter une note liée',exact:true}).click();
  await page.getByLabel('Texte de la note', {exact:true}).fill('Linked idea survives moving the pile');
  await page.locator('.dt-canvas').focus();
  await page.locator('.lab-table [data-save-status][data-status=saved]').waitFor();
  const beforePile = await page.evaluate(async id => (await (await fetch(`/decks/${id}`)).json()), id);
  await page.locator('.dt-canvas').press('Control+a');
  await page.locator('.dt-new-pile summary').click();
  await page.getByLabel('Nom de la pile', { exact: true }).fill('Commander laboratory');
  await page.getByLabel('Nom de la pile', { exact: true }).press('Enter');
  const pileId = await page.locator('[data-dt-pile]').getAttribute('data-dt-pile');
  assert.ok(pileId);
  await page.locator('[data-pile-action=toggle]').click();
  assert.equal(await page.locator('[data-dt-card]:not([hidden])').count(), beforePile.project.groups.flatMap(g => g.entries).length);
  await page.locator('.dt-canvas').press('Control+z');
  await page.locator('[data-dt=fit]').click();
  const card = page.locator('[data-dt-card]:not([hidden])').last();
  const entryId = await card.getAttribute('data-dt-card');
  const originalLeft = await card.evaluate(el => el.style.left);
  const box = await card.boundingBox();
  assert.ok(box);
  await page.mouse.move(box.x + box.width/2, box.y + box.height/2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width/2 + 40, box.y + box.height/2 + 25, { steps: 8 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  assert.equal(await page.locator(`[data-dt-card="${entryId}"]`).evaluate(el => el.style.left), originalLeft);
  await page.locator('.lab-table [data-save-status][data-status=saved]').waitFor();
  const afterPile = await page.evaluate(async id => (await (await fetch(`/decks/${id}`)).json()), id);
  assert.equal(afterPile.totalCards, beforePile.totalCards);
  assert.deepEqual(afterPile.project.groups, beforePile.project.groups);
  assert.equal(afterPile.project.workspace.piles[0].id, pileId);
  await electron.close(); electron = undefined;
  page = await launch();
  assert.deepEqual(await page.evaluate(async id => (await (await fetch(`/decks/${id}`)).json()).project, id), afterPile.project);
  // Block renderer internet: fixture gameplay still uses the real local Java engine.
  await page.route(/^https?:\/\//, route => route.abort());
  const started = await page.evaluate(async () => {
    const response = await fetch('/playtests', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ humanDeck: { type: 'fixture' }, asphodelDeck: { type: 'fixture' }, seed: 7 }) });
    const result = await response.json();
    if (!response.ok) throw new Error(JSON.stringify(result));
    return result;
  });
  assert.ok(started.sessionId);
  await page.waitForFunction(async id => {
    const state = await (await fetch(`/playtests/${id}`)).json();
    if (state.status === 'failed') throw new Error(state.errorMessage ?? 'Local game failed');
    return state.status === 'waiting_for_human';
  }, started.sessionId, { timeout: 45_000 });
  assert.deepEqual(errors, []);
  // Closing mid-game exercises the shutdown hook, rather than only an idle quit.
  await electron.close(); electron = undefined;
  console.log('Desktop smoke passed: startup, offline artwork, local game, shared undo/redo, native pile/cancellation/restart, manual locked zones, notes/full inspection, immediate close, backups/recovery and active-game shutdown.');
} finally {
  if (electron) await electron.close();
  await rm(userData, { recursive: true, force: true });
}
