const { contextBridge, ipcRenderer } = require('electron');

// Expose only app commands, never ipcRenderer or arbitrary channel/path access.
contextBridge.exposeInMainWorld('asphodelDesktop', {
  getDisplayState: () => ipcRenderer.invoke('asphodel:display-state'),
  setFullscreen: fullscreen => {
    if (typeof fullscreen !== 'boolean') return Promise.reject(new TypeError('Fullscreen must be a boolean'));
    return ipcRenderer.invoke('asphodel:set-fullscreen', fullscreen);
  },
  openData: () => ipcRenderer.invoke('asphodel:open-data'),
  quit: () => ipcRenderer.invoke('asphodel:quit'),
  onDisplayState: callback => {
    const listener = (_event, state) => callback(state);
    ipcRenderer.on('asphodel:display-changed', listener);
    return () => ipcRenderer.removeListener('asphodel:display-changed', listener);
  },
});
