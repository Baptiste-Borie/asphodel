import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareUserData } from '../src/paths.mjs';
import { EMPTY_FORGE_EDITIONS, FORGE_DIRECTORY_MARKER } from './forge-assets.mjs';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const runtime = process.env.ASPHODEL_SMOKE_RUNTIME ?? join(desktop, 'runtime');
const userData = await mkdtemp(join(tmpdir(), 'asphodel-runtime-smoke-'));
const token = 'test-secret-never-in-renderer';
const executable = process.env.ASPHODEL_SMOKE_ELECTRON ?? join(desktop, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron');
let child;
async function launch() {
  const env = await prepareUserData(runtime, userData);
  child = fork(join(desktop, 'src/backend-worker.mjs'), [], {
    execPath: executable,
    execArgv: ['--import', fileURLToPath(new URL('offline-loader.mjs', import.meta.url))],
    env: { ...process.env, ...env, ELECTRON_RUN_AS_NODE: '1', ASPHODEL_RUNTIME: runtime, ASPHODEL_DESKTOP_TOKEN: token },
    cwd: userData, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.stderr.on('data', data => { if (!String(data).includes('ExperimentalWarning')) process.stderr.write(data); });
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Worker startup timed out')), 40_000);
    child.on('message', message => {
      if (message.type === 'ready') { clearTimeout(timer); resolve(message.address); }
      if (message.type === 'error') { clearTimeout(timer); reject(new Error(message.message)); }
    });
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`Worker exited during startup: ${code}`)); });
  });
  return async (path, options = {}) => {
    const response = await fetch(`${ready}${path}`, { ...options, headers: { 'content-type': 'application/json', 'x-asphodel-desktop-token': token, ...options.headers } });
    if (response.status === 204) return null;
    const data = await response.json();
    if (!response.ok) throw new Error(`${response.status}: ${JSON.stringify(data)}`);
    return data;
  };
}
async function close() {
  const closed = once(child, 'exit');
  child.send({ type: 'shutdown' });
  const timer = setTimeout(() => child.kill('SIGKILL'), 8_000);
  const [code] = await closed;
  clearTimeout(timer); child = undefined;
  assert.equal(code, 0, 'worker, database and active Forge game close cleanly');
}
try {
  assert.ok((await stat(join(runtime, 'vendor/forge/forge-gui/res', EMPTY_FORGE_EDITIONS))).isDirectory(), 'custom editions must be prepared by the build, before Forge starts');
  assert.ok((await stat(join(runtime, 'vendor/forge/forge-gui/res', EMPTY_FORGE_EDITIONS, FORGE_DIRECTORY_MARKER))).isFile(), 'the packaged directory marker must be retained');
  let api = await launch();
  await assert.rejects(api('/decks', { headers: { 'x-asphodel-desktop-token': 'wrong-token' } }), /403/);
  const decks = (await api('/decks')).decks;
  assert.ok(decks.length > 0);
  const id = decks[0].id;
  await api(`/decks/${id}`, { method: 'PATCH', body: JSON.stringify({ name: 'Persistent offline deck' }) });
  const detail = await api(`/decks/${id}`);
  const presentation = await api('/cards/presentation', { method: 'POST', body: JSON.stringify({ names: [detail.cards[0].name] }) });
  assert.ok(presentation.cards[detail.cards[0].name], 'saved metadata works with external networking disabled');
  await close();
  api = await launch();
  assert.equal((await api(`/decks/${id}`)).name, 'Persistent offline deck');
  // Store a small known-compatible deck through the same API, then play from the library.
  // This tests the offline library path independently of unsupported cards in user decks.
  const saved = await api('/decks', { method: 'POST', body: JSON.stringify({ name: 'Offline game smoke', decklist: 'Commander\n1x Krenko, Tin Street Kingpin\n\nMainboard\n99x Mountain' }) });
  const { sessionId } = await api('/playtests', { method: 'POST', body: JSON.stringify({ humanDeck: { type: 'library', value: String(saved.id) }, asphodelDeck: { type: 'fixture' }, seed: 7 }) });
  const deadline = Date.now() + 40_000;
  let state;
  do {
    state = await api(`/playtests/${sessionId}`);
    if (state.status === 'failed') throw new Error(JSON.stringify(state));
    if (state.status === 'waiting_for_human') break;
    await new Promise(resolve => setTimeout(resolve, 100));
  } while (Date.now() < deadline);
  assert.equal(state.status, 'waiting_for_human', 'bundled Java/Forge reaches a real human choice offline');
  const runningReview = await api(`/playtests/reviews/${sessionId}`);
  assert.equal(runningReview.status, 'running');
  assert.equal(runningReview.humanDeck.name, 'Offline game smoke');
  assert.equal(runningReview.humanDeck.cards.reduce((n,c) => n+c.quantity,0), 100);
  await api(`/decks/${saved.id}`, {method:'PATCH',body:JSON.stringify({name:'Edited after launch'})});
  await close();
  api = await launch();
  const finishedReview = await api(`/playtests/reviews/${sessionId}`);
  assert.equal(finishedReview.status, 'ended_by_human');
  assert.equal(finishedReview.humanDeck.name, 'Offline game smoke');
  const feedback = {note:'Try more draw',cards:[{name:'Mountain',verdict:'test',note:'Check flooding'}]};
  await api(`/playtests/reviews/${sessionId}/feedback`, {method:'PUT',body:JSON.stringify({revision:finishedReview.revision,feedback})});
  assert.ok((await api('/decks/library-backup')).reviews.some(r => r.sessionId===sessionId));
  await close(); api = await launch();
  assert.deepEqual((await api(`/playtests/reviews/${sessionId}`)).feedback, feedback);
  await close();
  const reports = await readdir(join(userData, 'playtest-reports'));
  assert.ok(reports.length > 0, 'quitting a game writes a local report');
  console.log('Electron runtime smoke passed: authenticated local API, seed library, offline metadata, restart persistence, bundled Java/Forge game, active-game shutdown, frozen list and review/feedback/backup restart persistence.');
} finally {
  if (child) child.kill('SIGKILL');
  await rm(userData, { recursive: true, force: true });
}
