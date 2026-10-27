const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);
const service = process.env.ATOMIC_XMPP_SERVICE || '';
const serviceUrl = service.includes('://') ? new URL(service) : null;
const endpoint = Object.freeze({ host: serviceUrl?.hostname || service, domain: process.env.ATOMIC_XMPP_DOMAIN || '', port: Number(process.env.ATOMIC_XMPP_PORT || 0), tls: process.env.ATOMIC_XMPP_TLS !== 'false', allowInsecureTls: process.env.ATOMIC_XMPP_ALLOW_INSECURE_TLS === 'true' });

contextBridge.exposeInMainWorld('atomicChat', Object.freeze({
  config: Object.freeze({ endpoint }),
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
  history: Object.freeze({ list: (input) => invoke('messages.list', input), conversations: (input) => invoke('conversations.list', input) }),
  preferences: Object.freeze({ get: (input) => invoke('preferences.get', input), update: (input) => invoke('preferences.update', input), reset: (input) => invoke('preferences.reset', input) }),
  subscribe: (listener) => { const handler = (_event, value) => listener(value); ipcRenderer.on('domain.event', handler); return () => ipcRenderer.removeListener('domain.event', handler); },
}));
