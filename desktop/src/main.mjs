import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell, utilityProcess } from 'electron';
import { randomBytes } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ORIGIN, assetPath, isApiPath, prepareUserData } from './paths.mjs';
import { ArtCache, installArtworkHeaderGuard } from './art-cache.mjs';
import { ArtworkLibrary, installArtworkCommands } from './artwork-library.mjs';
import { DisplayPreferences } from './display-preferences.mjs';
import { desktopWindowOptions, installWindowControls } from './window-controls.mjs';
import { installCloseGuard } from './close-guard.mjs';
import { atomicWrite, LibraryBackups } from './library-backups.mjs';
import { isTrustedDesktopFrame } from './display-preferences.mjs';
import { pathToFileURL } from 'node:url';

protocol.registerSchemesAsPrivileged([{ scheme: 'asphodel', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }]);
app.setName('Asphodel');
if (process.env.ASPHODEL_TEST_USER_DATA) app.setPath('userData', process.env.ASPHODEL_TEST_USER_DATA);
const here = dirname(fileURLToPath(import.meta.url));
const runtime = app.isPackaged ? join(process.resourcesPath, 'runtime') : join(here, '../runtime');
let window;
let backend;
let address;
let quitting = false;
let displayPreferences;
let libraryBackups;
let artworkLibrary;
const token = randomBytes(32).toString('hex');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json' };
const csp = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https://cards.scryfall.io data: blob:; font-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-src 'none'";

async function log(message) {
  await appendFile(join(app.getPath('userData'), 'desktop.log'), `${new Date().toISOString()} ${message}\n`).catch(() => {});
}

function startBackend(env) {
  return new Promise((resolve, reject) => {
    backend = utilityProcess.fork(join(here, 'backend-worker.mjs'), [], {
      env: { ...process.env, ...env, ASPHODEL_RUNTIME: runtime, ASPHODEL_DESKTOP_TOKEN: token },
      cwd: app.getPath('userData'), stdio: 'pipe', serviceName: 'Asphodel backend',
    });
    const timer = setTimeout(() => reject(new Error('Le démarrage a dépassé 30 secondes.')), 30_000);
    backend.stderr?.on('data', data => void log(String(data)));
    backend.stdout?.on('data', data => void log(String(data)));
    backend.on('message', message => {
      if (message.type === 'ready') { clearTimeout(timer); address = message.address; resolve(); }
      if (message.type === 'error') { clearTimeout(timer); reject(new Error(message.message)); }
    });
    backend.once('exit', code => {
      clearTimeout(timer);
      backend = undefined;
      if (!address) reject(new Error(`Le moteur local s'est arrêté (${code}).`));
      else if (!quitting) {
        void log(`Unexpected backend exit: ${code}`);
        dialog.showErrorBox('Asphodel — moteur arrêté', 'Le moteur local s’est arrêté. Ferme puis relance Asphodel. Tes decks sont conservés.');
        app.quit();
      }
    });
  });
}

async function installProtocol() {
  // A separate Chromium session uses system networking without re-entering the
  // renderer's HTTPS cache handler. Its HTTP cache is disabled: ArtCache owns
  // persistent storage, including offline reuse across application restarts.
  const artDownloads = session.fromPartition('asphodel-art-downloads', { cache: false });
  installArtworkHeaderGuard(artDownloads);
  const art = new ArtCache(join(app.getPath('userData'), 'card-art'), join(runtime, 'card-art'),
    (url, options) => artDownloads.fetch(url, options));
  artworkLibrary = new ArtworkLibrary(art,join(app.getPath('userData'),'artwork-library.json'),{onError:error=>void log(error.stack??String(error))});
  await artworkLibrary.ready;
  protocol.handle('asphodel', async request => {
    try {
      const url = new URL(request.url);
      if (url.host !== 'app') return new Response('Not found', { status: 404 });
      if (url.pathname === '/__art') {
        const target = url.searchParams.get('url');
        return await art.response(target, request.method);
      }
      if (isApiPath(url.pathname)) {
        if (!address) return new Response('Démarrage en cours', { status: 503 });
        const headers = new Headers(request.headers);
        headers.set('x-asphodel-desktop-token', token);
        headers.delete('host'); headers.delete('content-length');
        const response = await fetch(`${address}${url.pathname}${url.search}`, {
          method: request.method, headers,
          ...(request.method === 'GET' || request.method === 'HEAD' ? {} : { body: await request.arrayBuffer() }),
        });
        return new Response(response.body, { status: response.status, headers: response.headers });
      }
      if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
      const file = assetPath(join(runtime, 'frontend'), url.pathname);
      if (!file) return new Response('Not found', { status: 404 });
      const data = await readFile(file);
      return new Response(request.method === 'HEAD' ? null : data, { headers: { 'content-type': mime[extname(file)] ?? 'application/octet-stream', 'content-security-policy': csp } });
    } catch (error) {
      if (error.code !== 'ENOENT') void log(error.message);
      return new Response('Ressource indisponible', { status: 404 });
    }
  });
  // Serve artwork at its original HTTPS URL. Redirecting an image request into
  // a custom scheme can fail before reaching the cache's protocol handler.
  protocol.handle('https', async request => {
    if (new URL(request.url).hostname !== 'cards.scryfall.io') {
      return session.defaultSession.fetch(request, { bypassCustomProtocolHandlers: true });
    }
    try { return await art.response(request.url, request.method); }
    catch (error) {
      const message = `Illustration indisponible: ${request.url} — ${error.message}`;
      console.error(`[Asphodel] ${message}`);
      void log(message);
      return new Response('Illustration indisponible', { status: 502, headers: { 'access-control-allow-origin': '*' } });
    }
  });
  session.defaultSession.webRequest.onErrorOccurred({ urls: ['https://cards.scryfall.io/*'] }, details => {
    const message = `Erreur réseau illustration: ${details.error} — ${details.url}`;
    console.error(`[Asphodel] ${message}`);
    void log(message);
  });
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback) => {
    callback(contents === window?.webContents && contents.getURL().startsWith(`${APP_ORIGIN}/`) && permission === 'media');
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission, origin) => {
    return contents === window?.webContents && origin.startsWith(APP_ORIGIN) && permission === 'media';
  });
}

function createWindow() {
  window = new BrowserWindow({
    width: 1440, height: 900, minWidth: 960, minHeight: 640, title: 'Asphodel', icon: join(here, 'icon.png'),
    backgroundColor: '#edf1e9', show: false,
    ...desktopWindowOptions(displayPreferences),
  });
  installWindowControls(window, displayPreferences, error => {
    console.error('[Asphodel] Préférence d’affichage:', error);
    void log(error.stack ?? String(error));
  });
  installArtworkCommands({ipcMain,window,library:artworkLibrary});
  installCloseGuard({ app, ipcMain, window, canClose: () => !libraryBackups?.busy,
    onError: error => void log(error.stack ?? String(error)),
    confirmFailure: async () => {
      const { response } = await dialog.showMessageBox(window, {
        type: 'warning', title: 'Asphodel — enregistrement inachevé',
        message: 'Les dernières modifications n’ont pas pu être enregistrées.',
        detail: 'Reste dans l’application pour réessayer. Si tu quittes, seules les modifications dont le brouillon local a pu être écrit seront récupérables.',
        buttons: ['Rester dans l’application', 'Quitter quand même'], defaultId: 0, cancelId: 0,
      });
      return response === 1;
    },
    shutdown: async () => {
      quitting = true;
      await artworkLibrary?.close().catch(error=>void log(error.stack??String(error)));
      session.defaultSession.flushStorageData();
      if (!backend) { app.exit(); return; }
      const worker = backend;
      // Only stop the backend after deck/table saves finish (Forge/report flush stays bounded).
      const timer = setTimeout(() => { worker.kill(); app.exit(); }, 8_000);
      worker.once('exit', () => { clearTimeout(timer); app.exit(); });
      worker.postMessage({ type: 'shutdown' });
    },
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  window.webContents.on('will-navigate', (event, url) => {
    if (new URL(url).origin !== new URL(APP_ORIGIN).origin || !url.startsWith(`${APP_ORIGIN}/`)) event.preventDefault();
  });
  window.on('closed', () => { window = undefined; });
  return window;
}

async function installLibraryBackups(currentWindow) {
  const codec = await import(pathToFileURL(join(runtime, 'shared/library-backup.mjs')).href);
  const api = async (path, payload) => {
    const response = await fetch(`${address}${path}`, {
      method: payload ? 'POST' : 'GET', headers: { 'x-asphodel-desktop-token': token, 'content-type': 'application/json' },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw Object.assign(new Error(body.message ?? 'La restauration a échoué. La bibliothèque précédente est conservée.'), { definite: true });
    }
    return response.json();
  };
  const filters = [{ name: 'Sauvegarde Asphodel', extensions: ['json'] }];
  libraryBackups = new LibraryBackups({
    userData: app.getPath('userData'), version: app.getVersion(), codec,
    api: { snapshot: () => api('/decks/library-backup'), restore: library => api('/decks/library-restore', library) },
    getDisplay: () => ({ fullscreen: displayPreferences.fullscreen }),
    setDisplay: state => { displayPreferences.setFullscreen(state.fullscreen); currentWindow.setFullScreen(state.fullscreen); },
    dialogs: {
      save: async defaultPath => { const result = await dialog.showSaveDialog(currentWindow, { title: 'Sauvegarder ma bibliothèque', defaultPath, filters }); return result.canceled ? null : result.filePath; },
      open: async () => { const result = await dialog.showOpenDialog(currentWindow, { title: 'Choisir une sauvegarde Asphodel', filters, properties: ['openFile'] }); return result.canceled ? null : result.filePaths[0]; },
      confirm: async (archive, count) => {
        const result = await dialog.showMessageBox(currentWindow, {
          type: 'warning', title: 'Restaurer la bibliothèque',
          message: `Remplacer les ${count} decks actuels par les ${archive.library.decks.length} decks de cette sauvegarde ?`,
          detail: 'Les tables, la sélection et les brouillons seront remplacés. Une sauvegarde de secours sera créée dans le dossier de tes données. La partie en cours doit être terminée.',
          buttons: ['Annuler', 'Restaurer la sauvegarde'], defaultId: 0, cancelId: 0,
        });
        return result.response === 1;
      },
    },
  });
  const commands = {
    'asphodel:deck-text-save': async (name, text) => {
      if (typeof name !== 'string' || !/^[^\x00-\x1f<>:"/\\|?*]{1,104}\.txt$/.test(name) || typeof text !== 'string' || text.length > 1000000) throw new Error('Export texte invalide.');
      return libraryBackups.exclusive(async () => {
        const result = await dialog.showSaveDialog(currentWindow, { title: 'Exporter le deck', defaultPath: name, filters: [{ name: 'Liste de cartes', extensions: ['txt'] }] });
        if (result.canceled) return false;
        await atomicWrite(result.filePath, text, true); return true;
      });
    },
    'asphodel:backup-save': storage => libraryBackups.save(storage),
    'asphodel:backup-choose': () => libraryBackups.choose(),
    'asphodel:backup-restore': storage => libraryBackups.restore(storage),
    'asphodel:restored-storage': () => libraryBackups.restoredStorage(),
    'asphodel:restore-ack': () => { session.defaultSession.flushStorageData(); return libraryBackups.acknowledge(); },
  };
  for (const [channel, action] of Object.entries(commands)) ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedDesktopFrame(event, currentWindow.webContents)) throw new Error('Desktop command refused');
    return action(...args);
  });
  currentWindow.once('closed', () => { for (const channel of Object.keys(commands)) ipcMain.removeHandler(channel); });
}

console.log('[Asphodel] Initialisation du desktop…');
if (!app.requestSingleInstanceLock()) {
  console.log('[Asphodel] Une autre instance est déjà ouverte.');
  app.quit();
}
else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.show(); window?.focus(); });
  app.on('window-all-closed', () => app.quit());
  // Electron emits ready only after its ESM entry point finishes evaluating.
  // A top-level await here would make the module and ready wait on each other.
  void app.whenReady().then(async () => {
    try {
      console.log('[Asphodel] Electron prêt, préparation des données…');
      const env = await prepareUserData(runtime, app.getPath('userData'));
      displayPreferences = new DisplayPreferences(join(app.getPath('userData'), 'display-preferences.json'), error => void log(error.message));
      Menu.setApplicationMenu(null);
      await installProtocol();
      const currentWindow = createWindow();
      await currentWindow.loadFile(join(here, 'splash.html'));
      console.log('[Asphodel] Démarrage du moteur local…');
      await startBackend(env);
      await installLibraryBackups(currentWindow);
      await libraryBackups.resume();
      await currentWindow.loadURL(`${APP_ORIGIN}/`);
      console.log('[Asphodel] Application prête.');
    } catch (error) {
      console.error('[Asphodel] Échec du démarrage:', error);
      await log(error.stack ?? String(error));
      dialog.showErrorBox('Asphodel — démarrage impossible', `Impossible de démarrer Asphodel.\n\n${error.message}\n\nDétails dans desktop.log, dans ${app.getPath('userData')}`);
      app.quit();
    }
  });
}
