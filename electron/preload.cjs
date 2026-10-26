const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);

contextBridge.exposeInMainWorld('atomicChat', Object.freeze({
  getContractVersion: () => invoke('p0.contract.version'),
  account: Object.freeze({
    setSecret: (input) => invoke('account.setSecret', input),
    connect: (input) => invoke('account.connect', input),
    disconnect: (accountId) => invoke('account.disconnect', accountId),
  }),
  session: Object.freeze({ getState: (accountId) => invoke('session.getState', accountId) }),
  presence: Object.freeze({ set: (input) => invoke('presence.set', input) }),
  roster: Object.freeze({ list: (accountId) => invoke('roster.list', accountId) }),
  messaging: Object.freeze({ send: (input) => invoke('message.send', input) }),
  history: Object.freeze({ list: (input) => invoke('messages.list', input) }),
  preferences: Object.freeze({ get: (input) => invoke('preferences.get', input), update: (input) => invoke('preferences.update', input), reset: (input) => invoke('preferences.reset', input) }),
  subscribe: (listener) => { const handler = (_event, value) => listener(value); ipcRenderer.on('domain.event', handler); return () => ipcRenderer.removeListener('domain.event', handler); },
}));
