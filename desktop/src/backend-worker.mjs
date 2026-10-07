import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The main process provides all writable paths before these modules are imported.
const runtime = process.env.ASPHODEL_RUNTIME;
const moduleAt = path => import(pathToFileURL(join(runtime, path)).href);
let server;
let database;
let probe;
let closing = false;
const send = message => process.parentPort ? process.parentPort.postMessage(message) : process.send?.(message);

async function close(exitCode = 0) {
  if (closing) return;
  closing = true;
  try { await probe?.stop(); await server?.close(); } finally { database?.close(); process.exit(exitCode); }
}
process.parentPort?.on('message', ({ data }) => { if (data?.type === 'shutdown') void close(); });
process.on('message', data => { if (data?.type === 'shutdown') void close(); });
process.once('SIGTERM', () => void close());

try {
  const [{ buildApp }, { createDatabase }, { LibraryCardProvider }, { ScryfallCardProvider }, { ForgeBridgeClient }] = await Promise.all([
    moduleAt('backend/src/app.js'), moduleAt('backend/src/db/client.js'),
    moduleAt('backend/src/cards/library-card-provider.js'), moduleAt('backend/src/cards/scryfall-provider.js'),
    moduleAt('backend/src/forge/forge-bridge-client.js'),
  ]);
  probe = new ForgeBridgeClient({ requestTimeoutMs: 15_000 });
  try { await probe.start(); await probe.request({ type: 'ping' }); }
  finally { await probe.stop(); probe = undefined; }
  database = await createDatabase();
  server = await buildApp({
    database,
    cardProvider: new LibraryCardProvider(database.db, new ScryfallCardProvider({ refreshIntervalMs: Infinity, allowDownload: false })),
  });
  // The ephemeral loopback listener is private to the desktop protocol handler.
  server.addHook('onRequest', async (request, reply) => {
    if (request.headers['x-asphodel-desktop-token'] !== process.env.ASPHODEL_DESKTOP_TOKEN) {
      return reply.code(403).send({ error: 'DESKTOP_ACCESS_DENIED' });
    }
  });
  const address = await server.listen({ host: '127.0.0.1', port: 0 });
  send({ type: 'ready', address });
} catch (error) {
  send({ type: 'error', message: error.stack ?? String(error) });
  await close(1);
}
