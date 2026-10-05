import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ArtCache, byteSafeArtworkHeaders, installArtworkHeaderGuard } from './art-cache.mjs';

test('Unicode artwork filename reproduces ByteString crash; filtering preserves image headers', () => {
  const headers = {
    'content-disposition': ['inline; filename="Swamp ★.jpg"'],
    'content-type': ['image/jpeg'],
    'content-encoding': ['gzip'],
    'cache-control': ['public, max-age=3600'],
    'cross-origin-resource-policy': ['cross-origin'],
    'x-latin1': ['café'],
    'x-multiple': ['first', 'second'],
  };
  assert.equal(headers['content-disposition'][0].charCodeAt(24), 9733);
  const electronHeaders = values => {
    const result = new Headers();
    for (const [key, value] of Object.entries(values)) result.set(key, Array.isArray(value) ? value.join(', ') : value);
    return result;
  };
  assert.throws(() => electronHeaders(headers), /ByteString/);
  const safe = byteSafeArtworkHeaders(headers);
  assert.equal(safe['content-disposition'], undefined);
  assert.equal(electronHeaders(safe).get('content-type'), 'image/jpeg');
  assert.deepEqual(safe, Object.fromEntries(Object.entries(headers).filter(([key]) => key !== 'content-disposition')));
  assert.equal(headers['content-disposition'][0], 'inline; filename="Swamp ★.jpg"', 'source headers are not mutated');
  assert.deepEqual(byteSafeArtworkHeaders(), {});
  assert.deepEqual(byteSafeArtworkHeaders({ 'Content-Disposition': ['inline; filename="swamp.jpg"'], 'content-type': ['image/jpeg'] }), { 'content-type': ['image/jpeg'] });
});

test('guard runs on the artwork download session before fetch creates headers; image is cached for offline reuse', async () => {
  let filter, listener;
  installArtworkHeaderGuard({ webRequest: { onHeadersReceived: (receivedFilter, receivedListener) => {
    filter = receivedFilter; listener = receivedListener;
  } } });
  assert.deepEqual(filter, { urls: ['https://cards.scryfall.io/*'] });
  const directory = await mkdtemp(join(tmpdir(), 'asphodel-header-test-'));
  const url = 'https://cards.scryfall.io/normal/front/a/b/island.jpg';
  const bytes = Buffer.from('test image bytes');
  let downloads = 0;
  try {
    const cache = new ArtCache(directory, null, async () => {
      downloads++;
      let result;
      listener({ responseHeaders: { 'content-type': ['image/jpeg'], 'content-disposition': ['inline; filename="Island ★.jpg"'] } }, response => { result = response; });
      const headers = new Headers();
      for (const [name, values] of Object.entries(result.responseHeaders)) headers.set(name, values.join(', '));
      return new Response(bytes, { headers });
    });
    const response = await cache.response(url);
    assert.equal(response.status, 200);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    assert.equal(downloads, 1);
    const offline = new ArtCache(directory, null, async () => { throw new Error('offline'); });
    assert.deepEqual(await offline.get(url), bytes);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
