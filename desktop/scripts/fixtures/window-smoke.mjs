// Uses the production window configuration/IPC with a fixture catalogue, so
// display checks do not require Java, Forge or a user's deck database.
import { app, BrowserWindow, protocol, ipcMain } from 'electron';
import { readFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTrustedDesktopFrame, DisplayPreferences } from '../../src/display-preferences.mjs';
import { desktopWindowOptions, installWindowControls } from '../../src/window-controls.mjs';
import { assetPath } from '../../src/paths.mjs';
import { ArtCache } from '../../src/art-cache.mjs';
import { CatalogLibrary, installCatalogCommands } from '../../src/catalog-library.mjs';
import { ArtworkLibrary, installArtworkCommands } from '../../src/artwork-library.mjs';

protocol.registerSchemesAsPrivileged([{ scheme: 'asphodel', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.setName('Asphodel window smoke');
app.setPath('userData', process.env.ASPHODEL_TEST_USER_DATA);
const frontend = fileURLToPath(new URL('../../../frontend/dist/', import.meta.url));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
app.on('window-all-closed', () => app.quit());
void app.whenReady().then(async () => {
  protocol.handle('asphodel', async request => {
    const url = new URL(request.url);
    if (url.pathname === '/health') return Response.json({ status: 'ok' });
    if (url.pathname === '/decks') return Response.json({ decks: [] });
    if (url.pathname === '/playtests/active') return Response.json({ error: 'No active session' }, { status: 404 });
    if (url.pathname === '/cards/search/catalog') return Response.json({ sets: [], types: [], languages: [], printings: 0, snapshotDate: '2026-10-05' });
    if (url.pathname === '/cards/search') return Response.json({ cards: [], total: 0, nextOffset: null, catalogPrintings: 0, snapshotDate: '2026-10-05' });
    const file = assetPath(frontend, url.pathname);
    if (!file) return new Response('Not found', { status: 404 });
    try { return new Response(await readFile(file), { headers: { 'content-type': types[extname(file)] ?? 'application/octet-stream' } }); }
    catch { return new Response('Not found', { status: 404 }); }
  });
  const preferences = new DisplayPreferences(join(app.getPath('userData'), 'display-preferences.json'));
  const window = new BrowserWindow({ width: 1280, height: 800, show: false, ...desktopWindowOptions(preferences) });
  installWindowControls(window, preferences);
  const artwork = new ArtworkLibrary(new ArtCache(join(app.getPath('userData'), 'card-art')), join(app.getPath('userData'), 'artwork-library.json'));
  const catalog = new CatalogLibrary({data:join(app.getPath('userData'),'data'),prepare:()=>{throw new Error('Not used in display smoke');}});
  await catalog.ready;
  installCatalogCommands({ipcMain,window,library:catalog,restart:()=>app.quit()});
  await artwork.ready;
  installArtworkCommands({ ipcMain, window, library: artwork });
  ipcMain.handle('asphodel:restored-storage', event => {
    if (!isTrustedDesktopFrame(event, window.webContents)) throw new Error('Desktop command refused');
    return null; // display-only fixture has no database restoration
  });
  window.once('ready-to-show', () => window.show());
  void window.loadURL('asphodel://app/');
});
