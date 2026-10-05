import { app, BrowserWindow, dialog, ipcMain, Menu, protocol, session, shell, utilityProcess } from 'electron';
import { randomBytes } from 'node:crypto';
import { appendFile, readFile } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ORIGIN, assetPath, isApiPath, prepareUserData } from './paths.mjs';
import { ArtCache, installArtworkHeaderGuard } from './art-cache.mjs';
import { DisplayPreferences } from './display-preferences.mjs';
import { desktopWindowOptions, installWindowControls } from './window-controls.mjs';
import { installCloseGuard } from './close-guard.mjs';

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
  installCloseGuard({ app, ipcMain, window,
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
