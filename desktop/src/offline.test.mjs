import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtCache, artKey } from './art-cache.mjs';
import { assetPath, isApiPath, prepareUserData } from './paths.mjs';

test('updates seed decks once and preserve user changes and writable paths', async () => {
  const root = await mkdtemp(join(tmpdir(), 'asphodel-desktop-'));
  try {
    const runtime = join(root, 'runtime'), userData = join(root, 'user');
    await mkdir(join(runtime, 'backend/data'), { recursive: true });
    await writeFile(join(runtime, 'backend/data/asphodel.sqlite'), 'seed v1');
    const env = await prepareUserData(runtime, userData);
    const database = env.DB_FILE_NAME.slice(5);
    assert.equal(await readFile(database, 'utf8'), 'seed v1');
    await writeFile(database, 'my deck edits');
    await writeFile(join(runtime, 'backend/data/asphodel.sqlite'), 'seed v2');
    assert.deepEqual(await prepareUserData(runtime, userData), env);
    assert.equal(await readFile(database, 'utf8'), 'my deck edits');
    assert.ok(env.ASPHODEL_SEARCH_INDEX.startsWith(userData));
    assert.ok(env.ASPHODEL_REPORTS_ROOT.startsWith(userData));
    assert.ok(env.ASPHODEL_JAVA_PATH.startsWith(runtime));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('art survives process restarts without network, including bundled seed artwork', async () => {
  const root = await mkdtemp(join(tmpdir(), 'asphodel-art-'));
  const url = 'https://cards.scryfall.io/normal/front/a/b/printing.jpg?123';
  let downloads = 0;
  try {
    const cache = new ArtCache(root, undefined, async () => {
      downloads++;
      return new Response('picture', { headers: { 'content-type': 'image/jpeg' } });
    });
    await Promise.all([cache.get(url), cache.get(url)]);
    assert.equal(downloads, 1);
    const offline = new ArtCache(root, undefined, async () => { throw new Error('offline'); });
    assert.equal((await offline.get(url.replace('?123', '?456'))).toString(), 'picture');
    const seeded = new ArtCache(join(root, 'new-user'), root, async () => { throw new Error('offline'); });
    assert.equal((await seeded.get(url)).toString(), 'picture');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('desktop routing confines file reads and artwork downloads', () => {
  assert.equal(assetPath('/app/frontend', '/%2e%2e/private.txt'), null);
  assert.equal(assetPath('/app/frontend', '/%5c..%5cprivate.txt'), null);
  assert.equal(assetPath('/app/frontend', '/%00.txt'), null);
  assert.equal(assetPath('/app/frontend', '/%zz'), null);
  assert.equal(assetPath('/app/frontend', '/'), '/app/frontend/index.html');
  assert.equal(isApiPath('/cards/search'), true);
  assert.equal(isApiPath('/cards-other.js'), false);
  for (const url of ['http://cards.scryfall.io/a.jpg', 'https://elsewhere.test/a.jpg', 'https://cards.scryfall.io:8080/a.jpg']) assert.throws(() => artKey(url));
});

test('artwork responses expose image bytes and reuse disk cache after a failed download', async () => {
  const root = await mkdtemp(join(tmpdir(), 'asphodel-art-response-'));
  const url = 'https://cards.scryfall.io/normal/front/a/b/printing.png?123';
  let attempts = 0;
  try {
    const cache = new ArtCache(root, undefined, async () => {
      attempts++;
      return attempts === 1 ? new Response('unavailable', { status: 503 })
        : new Response('PNG bytes', { headers: { 'content-type': 'image/png' } });
    });
    await assert.rejects(cache.response(url), /503/);
    const response = await cache.response(url);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/png');
    assert.equal(response.headers.get('access-control-allow-origin'), '*');
    assert.equal(await response.text(), 'PNG bytes');
    const offline = new ArtCache(root, undefined, async () => { throw new Error('offline'); });
    assert.equal(await (await offline.response(url.replace('?123', '?456'))).text(), 'PNG bytes');
    assert.equal(await (await offline.response(url, 'HEAD')).text(), '');
    assert.equal((await offline.response(url, 'POST')).status, 405);
    assert.equal(attempts, 2);
  } finally { await rm(root, { recursive: true, force: true }); }
});
