const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);
const service = process.env.ATOMIC_XMPP_SERVICE || '';
const serviceUrl = service.includes('://') ? new URL(service) : null;
const configuredTransport = process.env.ATOMIC_XMPP_TRANSPORT;
const legacyTls = process.env.ATOMIC_XMPP_TLS !== 'false';
const configuredPort = Number(process.env.ATOMIC_XMPP_PORT || 0);
const transport = configuredTransport || (serviceUrl?.protocol === 'xmpps:' ? 'direct-tls' : legacyTls && configuredPort === 5223 ? 'direct-tls' : 'starttls');
const endpoint = Object.freeze({ host: serviceUrl?.hostname || service, domain: process.env.ATOMIC_XMPP_DOMAIN || '', port: configuredPort, tls: true, transport, allowInsecureTls: process.env.ATOMIC_XMPP_ALLOW_INSECURE_TLS === 'true' });

contextBridge.exposeInMainWorld('atomicChat', Object.freeze({
  config: Object.freeze({ accountId: process.env.ATOMIC_XMPP_USERNAME || '', endpoint }),
  getContractVersion: () => invoke('contract.version'),
  account: Object.freeze({
    setSecret: (input) => invoke('account.setSecret', input),
    connect: (input) => invoke('account.connect', input),
    disconnect: (accountId) => invoke('account.disconnect', accountId),
  }),
  certificate: Object.freeze({ decide: (input) => invoke('certificate.decide', input) }),
  session: Object.freeze({ getState: (accountId) => invoke('session.getState', accountId) }),
  presence: Object.freeze({ set: (input) => invoke('presence.set', input) }),
  roster: Object.freeze({ list: (accountId) => invoke('roster.list', accountId) }),
  messaging: Object.freeze({ send: (input) => invoke('message.send', input) }),
  muc: Object.freeze({ discover: (input) => invoke('muc.discover', input), join: (input) => invoke('muc.join', input), leave: (input) => invoke('muc.leave', input), sendMessage: (input) => invoke('muc.sendMessage', input) }),
  file: Object.freeze({ accept: (input) => invoke('file.accept', input), reject: (input) => invoke('file.reject', input), cancel: (input) => invoke('file.cancel', input), listActive: (input) => invoke('file.listActive', input) }),
  history: Object.freeze({ list: (input) => invoke('messages.list', input), listPage: (input) => invoke('messages.page', input), conversations: (input) => invoke('conversations.list', input) }),
  preferences: Object.freeze({ get: (input) => invoke('preferences.get', input), update: (input) => invoke('preferences.update', input), reset: (input) => invoke('preferences.reset', input) }),
  subscribe: (listener) => { const handler = (_event, value) => listener(value); ipcRenderer.on('domain.event', handler); return () => ipcRenderer.removeListener('domain.event', handler); },
}));
