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
  console.log('Desktop smoke passed: startup, real local game, persistent decks/localStorage, active-game shutdown.');
} finally {
  if (electron) await electron.close();
  await rm(userData, { recursive: true, force: true });
}
