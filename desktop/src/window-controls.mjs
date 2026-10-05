import { app, ipcMain, Menu, shell } from 'electron';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isTrustedDesktopFrame } from './display-preferences.mjs';

const here = dirname(fileURLToPath(import.meta.url));

export function desktopWindowOptions(preferences) {
  return {
    fullscreen: preferences.fullscreen,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: false,
      preload: join(here, 'preload.cjs'),
    },
  };
}

export function installWindowControls(window, preferences, onError = console.error) {
  Menu.setApplicationMenu(null);
  window.setMenu(null);
  window.setMenuBarVisibility(false);
  let saveError = null;
  const state = () => ({ fullscreen: window.isFullScreen(), saveError });
  const notify = () => {
    if (!window.webContents.isDestroyed()) window.webContents.send('asphodel:display-changed', state());
  };
  function save(fullscreen) {
    try { preferences.setFullscreen(fullscreen); saveError = null; }
    catch (error) {
      saveError = 'Impossible de conserver le mode d’affichage. Vérifie l’accès au dossier de données.';
      onError(error); notify(); throw error;
    }
  }
  function setFullscreen(fullscreen) {
    if (typeof fullscreen !== 'boolean') throw new TypeError('Fullscreen must be a boolean');
    save(fullscreen);
    window.setFullScreen(fullscreen);
    notify();
  }
  const handle = (channel, action) => ipcMain.handle(channel, (event, ...args) => {
    if (!isTrustedDesktopFrame(event, window.webContents)) throw new Error('Desktop command refused');
    return action(...args);
  });
  handle('asphodel:display-state', state);
  handle('asphodel:set-fullscreen', setFullscreen);
  handle('asphodel:open-data', async () => {
    const error = await shell.openPath(app.getPath('userData'));
    if (error) throw new Error(error);
  });
  handle('asphodel:quit', () => app.quit());
  // Also persist changes made by the window manager, not only our own buttons.
  const changed = () => {
    if (preferences.fullscreen !== window.isFullScreen()) {
      try { save(window.isFullScreen()); } catch { /* reported above */ }
    }
    notify();
  };
  window.on('enter-full-screen', changed);
  window.on('leave-full-screen', changed);
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return;
    if (input.key === 'F11') {
      event.preventDefault();
      try { setFullscreen(!window.isFullScreen()); } catch { /* UI receives the save error */ }
    }
    if (!app.isPackaged && input.control && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault(); window.webContents.toggleDevTools();
    }
  });
  window.once('closed', () => {
    for (const channel of ['asphodel:display-state', 'asphodel:set-fullscreen', 'asphodel:open-data', 'asphodel:quit']) ipcMain.removeHandler(channel);
  });
}
