import { randomUUID } from 'node:crypto';
import { isTrustedDesktopFrame } from './display-preferences.mjs';

/** Hold both native Close and Quit while the renderer drains its save queue. */
export function installCloseGuard({ app, ipcMain, window, shutdown, confirmFailure, onError = console.error, timeoutMs = 15_000, canClose = () => true }) {
  // Keep the EventEmitter reference while the native window is alive: reading
  // BrowserWindow.webContents inside 'closed' throws in Electron.
  const contents = window.webContents;
  let ready = false, ending = false, closed = false, attempt;
  let pending;
  const trusted = event => !closed && !contents.isDestroyed() && isTrustedDesktopFrame(event, contents);
  const onReady = event => { if (trusted(event)) ready = true; };
  const onResult = (event, id, saved) => {
    if (trusted(event) && pending?.id === id && typeof saved === 'boolean') pending.finish(saved);
  };
  ipcMain.on('asphodel:save-ready', onReady);
  ipcMain.on('asphodel:save-result', onResult);
  const navigating = event => {
    if (event.isMainFrame && !event.isSameDocument) { ready = false; pending?.finish(false); }
  };
  contents.on('did-start-navigation', navigating);
  function save() {
    if (!ready || closed || contents.isDestroyed()) return Promise.resolve(true);
    return new Promise(resolve => {
      const id = randomUUID();
      const timer = setTimeout(() => pending?.finish(false), timeoutMs);
      pending = { id, finish(result) { clearTimeout(timer); pending = undefined; resolve(result); } };
      try { contents.send('asphodel:prepare-close', id); }
      catch (error) { onError(error); pending?.finish(false); }
    });
  }
  function request() {
    if (closed || !canClose()) return Promise.resolve();
    if (attempt || ending) return attempt;
    attempt = (async () => {
      let saved = false;
      try { saved = await save(); } catch (error) { onError(error); }
      if (!saved && !closed && !await confirmFailure()) return;
      ending = true;
      await shutdown();
    })().catch(onError).finally(() => { attempt = undefined; });
    return attempt;
  }
  const intercept = event => { if (!ending) { event.preventDefault(); void request(); } };
  app.on('before-quit', intercept);
  window.on('close', intercept);
  window.once('closed', () => {
    closed = true;
    pending?.finish(false);
    app.removeListener('before-quit', intercept);
    window.removeListener('close', intercept);
    ipcMain.removeListener('asphodel:save-ready', onReady);
    ipcMain.removeListener('asphodel:save-result', onResult);
    contents.removeListener('did-start-navigation', navigating);
  });
  return { request };
}
