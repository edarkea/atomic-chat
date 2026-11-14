const { contextBridge, ipcRenderer } = require('electron');

const listeners = new Set();

ipcRenderer.on('spike-host-ack', (_event, value) => {
  for (const listener of listeners) listener(value);
});

contextBridge.exposeInMainWorld('spikeHost', Object.freeze({
  notify: (value) => ipcRenderer.send('spike.host-message', value),
  onAck: (listener) => {
    if (typeof listener !== 'function') return () => undefined;
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
}));

// Sentinel only for this experiment: the trusted host has a privileged-looking
// name while the game must not inherit it through either isolation strategy.
contextBridge.exposeInMainWorld('atomicChat', Object.freeze({ spikeSentinel: true }));

