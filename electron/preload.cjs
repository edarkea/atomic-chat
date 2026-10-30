const { contextBridge, ipcRenderer, webUtils } = require('electron');

// This marker is internal to the trusted preload -> Main boundary. The path
// is accepted only after webUtils derives it from the public File object.
const DROPPED_FILE_SOURCE = 'preload-webutils-file-v1';

const invoke = (channel, payload) => ipcRenderer.invoke(channel, payload);
const service = process.env.ATOMIC_XMPP_SERVICE || '';
const serviceUrl = service.includes('://') ? new URL(service) : null;
const configuredTransport = process.env.ATOMIC_XMPP_TRANSPORT;
const legacyTls = process.env.ATOMIC_XMPP_TLS !== 'false';
const configuredPort = Number(process.env.ATOMIC_XMPP_PORT || 0);
const transport =
  configuredTransport ||
  (serviceUrl?.protocol === 'xmpps:'
    ? 'direct-tls'
    : legacyTls && configuredPort === 5223
      ? 'direct-tls'
      : 'starttls');
const endpoint = Object.freeze({
  host: serviceUrl?.hostname || service,
  domain: process.env.ATOMIC_XMPP_DOMAIN || '',
  port: configuredPort,
  tls: true,
  transport,
  allowInsecureTls: process.env.ATOMIC_XMPP_ALLOW_INSECURE_TLS === 'true',
});
const legacyConfig =
  service && configuredPort
    ? Object.freeze({ accountId: process.env.ATOMIC_XMPP_USERNAME || '', endpoint })
    : undefined;

contextBridge.exposeInMainWorld(
  'atomicChat',
  Object.freeze({
    config: legacyConfig,
    getContractVersion: () => invoke('contract.version'),
    account: Object.freeze({
      setSecret: (input) => invoke('account.setSecret', input),
      connect: (input) => invoke('account.connect', input),
      disconnect: (accountId) => invoke('account.disconnect', accountId),
      forgetSecret: (input) => invoke('account.forgetSecret', input),
    }),
    connectionProfiles: Object.freeze({
      list: (input) => invoke('connectionProfiles.list', input),
      save: (input) => invoke('connectionProfiles.save', input),
      delete: (input) => invoke('connectionProfiles.delete', input),
    }),
    certificate: Object.freeze({ decide: (input) => invoke('certificate.decide', input) }),
    attention: Object.freeze({
      request: (input) => invoke('attention.request', input),
      clear: (input) => invoke('attention.clear', input),
    }),
    session: Object.freeze({ getState: (accountId) => invoke('session.getState', accountId) }),
    presence: Object.freeze({ set: (input) => invoke('presence.set', input) }),
    roster: Object.freeze({ list: (accountId) => invoke('roster.list', accountId) }),
    messaging: Object.freeze({ send: (input) => invoke('message.send', input) }),
    broadcast: Object.freeze({ send: (input) => invoke('broadcast.send', input) }),
    chatState: Object.freeze({ send: (input) => invoke('chatState.send', input) }),
    muc: Object.freeze({
      discover: (input) => invoke('muc.discover', input),
      join: (input) => invoke('muc.join', input),
      leave: (input) => invoke('muc.leave', input),
      sendMessage: (input) => invoke('muc.sendMessage', input),
    }),
    file: Object.freeze({
      send: (input) => invoke('file.send', input),
      sendDropped: (input) => {
        let filePath = '';
        try {
          if (input?.file && typeof webUtils?.getPathForFile === 'function')
            filePath = webUtils.getPathForFile(input.file) || '';
        } catch {
          filePath = '';
        }
        return invoke('file.sendDropped', {
          source: DROPPED_FILE_SOURCE,
          version: input?.version,
          requestId: input?.requestId,
          accountId: input?.accountId,
          conversationId: input?.conversationId,
          filePath,
        });
      },
      accept: (input) => invoke('file.accept', input),
      reject: (input) => invoke('file.reject', input),
      cancel: (input) => invoke('file.cancel', input),
      open: (input) => invoke('file.open', input),
      reveal: (input) => invoke('file.reveal', input),
      listActive: (input) => invoke('file.listActive', input),
    }),
    preview: Object.freeze({
      get: (input) => invoke('preview.get', input),
      open: (input) => invoke('preview.open', input),
      read: (input) => invoke('preview.read', input),
      close: (input) => invoke('preview.close', input),
      revoke: (input) => invoke('preview.revoke', input),
    }),
    stickers: Object.freeze({
      import: (input) => invoke('stickers.import', input),
      list: (input) => invoke('stickers.list', input),
      delete: (input) => invoke('stickers.delete', input),
      preview: Object.freeze({
        get: (input) => invoke('stickers.preview.get', input),
        open: (input) => invoke('stickers.preview.open', input),
        read: (input) => invoke('stickers.preview.read', input),
        close: (input) => invoke('stickers.preview.close', input),
        revoke: (input) => invoke('stickers.preview.revoke', input),
      }),
    }),
    history: Object.freeze({
      list: (input) => invoke('messages.list', input),
      listPage: (input) => invoke('messages.page', input),
      timelinePage: (input) => invoke('timeline.page', input),
      conversations: (input) => invoke('conversations.list', input),
    }),
    media: Object.freeze({
      list: (input) => invoke('media.list', input),
    }),
    fileHistory: Object.freeze({
      open: (input) => invoke('fileHistory.open', input),
      reveal: (input) => invoke('fileHistory.reveal', input),
    }),
    preferences: Object.freeze({
      get: (input) => invoke('preferences.get', input),
      update: (input) => invoke('preferences.update', input),
      reset: (input) => invoke('preferences.reset', input),
      selectDownloadDirectory: () => invoke('preferences.selectDownloadDirectory'),
    }),
    subscribe: (listener) => {
      const handler = (_event, value) => listener(value);
      ipcRenderer.on('domain.event', handler);
      return () => ipcRenderer.removeListener('domain.event', handler);
    },
  }),
);
