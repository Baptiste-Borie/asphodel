const { contextBridge, ipcRenderer } = require('electron');

// Expose only app commands, never ipcRenderer or arbitrary channel/path access.
contextBridge.exposeInMainWorld('asphodelDesktop', {
  getArtworkState: () => ipcRenderer.invoke('asphodel:art-state'),
  planArtwork: request => ipcRenderer.invoke('asphodel:art-plan', request),
  prepareArtwork: request => ipcRenderer.invoke('asphodel:art-prepare', request),
  controlArtwork: action => ipcRenderer.invoke('asphodel:art-control', action),
  setArtworkLimit: bytes => ipcRenderer.invoke('asphodel:art-limit', bytes),
  setArtworkKeep: (id, keep) => ipcRenderer.invoke('asphodel:art-keep', id, keep),
  forgetArtwork: id => ipcRenderer.invoke('asphodel:art-forget', id),
  purgeArtwork: () => ipcRenderer.invoke('asphodel:art-purge'),
  resetArtworkSettings: () => ipcRenderer.invoke('asphodel:art-reset'),
  saveDeckText: (name, text) => ipcRenderer.invoke('asphodel:deck-text-save', name, text),
  saveBackup: storage => ipcRenderer.invoke('asphodel:backup-save', storage),
  chooseBackup: () => ipcRenderer.invoke('asphodel:backup-choose'),
  restoreBackup: storage => ipcRenderer.invoke('asphodel:backup-restore', storage),
  getRestoredStorage: () => ipcRenderer.invoke('asphodel:restored-storage'),
  acknowledgeRestore: () => ipcRenderer.invoke('asphodel:restore-ack'),
  getDisplayState: () => ipcRenderer.invoke('asphodel:display-state'),
  setFullscreen: fullscreen => {
    if (typeof fullscreen !== 'boolean') return Promise.reject(new TypeError('Fullscreen must be a boolean'));
    return ipcRenderer.invoke('asphodel:set-fullscreen', fullscreen);
  },
  openData: () => ipcRenderer.invoke('asphodel:open-data'),
  quit: () => ipcRenderer.invoke('asphodel:quit'),
  onBeforeClose: callback => {
    const listener = async (_event, id) => {
      let saved = false;
      try { saved = await callback() === true; } catch { /* keep the window open */ }
      ipcRenderer.send('asphodel:save-result', id, saved);
    };
    ipcRenderer.on('asphodel:prepare-close', listener);
    ipcRenderer.send('asphodel:save-ready');
    return () => ipcRenderer.removeListener('asphodel:prepare-close', listener);
  },
  onDisplayState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('asphodel:display-changed', listener);
    return () => ipcRenderer.removeListener('asphodel:display-changed', listener);
  },
});
