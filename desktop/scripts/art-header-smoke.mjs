import { app, session } from 'electron';
import { createServer } from 'node:net';
import assert from 'node:assert/strict';
import { installArtworkHeaderGuard } from '../src/art-cache.mjs';

const deadline = setTimeout(() => app.exit(2), 15_000);
process.on('uncaughtException', error => { console.error(error); app.exit(1); });
void app.whenReady().then(async () => {
  const bytes = Buffer.from('image payload');
  const server = createServer(socket => {
    socket.once('data', () => socket.end(Buffer.concat([
      Buffer.from(`HTTP/1.1 200 OK\r\nContent-Type: image/jpeg\r\nContent-Disposition: inline; filename="Swamp ★.jpg"\r\nContent-Length: ${bytes.length}\r\nConnection: close\r\n\r\n`, 'utf8'), bytes,
    ])));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/image.jpg`;
  const downloads = session.fromPartition('asphodel-header-probe', { cache: false });
  let original;
  // Use the production callback on a local HTTP fixture, without Scryfall or TLS.
  installArtworkHeaderGuard({ webRequest: { onHeadersReceived: (_filter, listener) => {
    downloads.webRequest.onHeadersReceived({ urls: [`http://127.0.0.1:${server.address().port}/*`] }, (details, callback) => {
      original = details.responseHeaders;
      listener(details, callback);
    });
  } } });
  try {
    const response = await downloads.fetch(url);
    assert.ok(Object.values(original).flat().some(value => value.includes('★')), 'Fixture must deliver a Unicode header through Chromium');
    assert.equal(response.headers.get('content-disposition'), null);
    assert.equal(response.headers.get('content-type'), 'image/jpeg');
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
    console.log('Artwork header smoke passed: Unicode filename filtered before session.fetch, payload intact.');
    clearTimeout(deadline); server.close(); app.exit(0);
  } catch (error) { console.error(error); server.close(); app.exit(1); }
}).catch(error => { console.error(error); app.exit(1); });
