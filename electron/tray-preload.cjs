const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld(
  'trayMenu',
  Object.freeze({
    getState: () => ipcRenderer.invoke('tray.getState'),
    action: (action) => ipcRenderer.invoke('tray.action', action),
    subscribe: (listener) => {
      const handler = (_event, state) => listener(state);
      ipcRenderer.on('tray.state', handler);
      return () => ipcRenderer.removeListener('tray.state', handler);
    },
  }),
);
