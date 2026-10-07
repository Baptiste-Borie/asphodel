import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const send = message => process.parentPort ? process.parentPort.postMessage(message) : process.send?.(message);
try {
  const { prepareCatalog } = await import(pathToFileURL(join(process.env.ASPHODEL_RUNTIME, 'backend/src/cards/catalog-validation.js')).href);
  const catalog = await prepareCatalog(process.argv[2], (phase, cards) => send({ type: 'progress', phase, cards }));
  send({ type: 'complete', catalog });
  // Utility-process messages are drained before exiting in the normal Electron lifecycle.
} catch (error) { send({ type: 'failure', message: error.message, code: error.code }); process.exitCode = 1; }
