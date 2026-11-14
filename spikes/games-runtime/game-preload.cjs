const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();

ipcRenderer.on('spike-game-ack', (_event, value) => {
  for (const listener of listeners) listener(value);
});

contextBridge.exposeInMainWorld('spikeGame', Object.freeze({
  send: (value) => ipcRenderer.send('spike.game-message', value),
  onAck: (listener) => {
    if (typeof listener !== 'function') return () => undefined;
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
}));

