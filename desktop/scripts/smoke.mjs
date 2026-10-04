import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
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
  console.log('Desktop smoke passed: startup, artwork decode/offline restart, real local game, persistent decks/localStorage, active-game shutdown.');
} finally {
  if (electron) await electron.close();
  await rm(userData, { recursive: true, force: true });
}
