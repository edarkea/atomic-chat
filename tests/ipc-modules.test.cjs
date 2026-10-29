const test = require('node:test');
const assert = require('node:assert/strict');
const { registerAppLifecycle } = require('../electron/app-lifecycle.cjs');
const { registerAccountHandlers } = require('../electron/ipc-account-handlers.cjs');
const { registerFileHandlers } = require('../electron/ipc-file-handlers.cjs');
const { registerHistoryHandlers } = require('../electron/ipc-history-handlers.cjs');
const { registerIpcHandlers } = require('../electron/ipc-handlers.cjs');
const { createIpcHelpers } = require('../electron/ipc-helpers.cjs');
const { registerMucHandlers } = require('../electron/ipc-muc-handlers.cjs');
const { registerPreferenceHandlers } = require('../electron/ipc-preference-handlers.cjs');
const {
  registerConnectionProfileHandlers,
} = require('../electron/ipc-connection-profile-handlers.cjs');
const { createEventRouter } = require('../electron/event-router.cjs');

const channels = [
  'contract.version',
  'account.setSecret',
  'account.connect',
  'certificate.decide',
  'account.disconnect',
  'session.getState',
  'presence.set',
  'roster.list',
  'message.send',
  'muc.discover',
  'muc.join',
  'muc.leave',
  'muc.sendMessage',
  'file.send',
  'file.accept',
  'file.reject',
  'file.cancel',
  'file.listActive',
  'messages.list',
  'messages.page',
  'conversations.list',
  'preferences.get',
  'preferences.update',
  'preferences.reset',
  'connectionProfiles.list',
  'connectionProfiles.save',
  'connectionProfiles.delete',
  'account.forgetSecret',
];

function createHarness() {
  const handlers = new Map();
  const calls = [];
  let accountAuthorized = true;
  let senderAuthorized = true;
  const ownership = new Map([[7, 'one@example.invalid']]);
  const historySecurity = {
    authorize: (senderId, accountId) => accountAuthorized && ownership.get(senderId) === accountId,
    beginConnection: () => 'connection-token',
    completeConnection: (_senderId, _token, accountId) => ownership.set(7, accountId),
    finishConnection: () => undefined,
    encodeCursor: (value) => JSON.stringify(value),
    decodeCursor: () => {
      throw new Error('INVALID_INPUT');
    },
  };
  const xmpp = {
    sessions: new Map([['one@example.invalid', {}]]),
    states: new Map([['one@example.invalid', { status: 'connected' }]]),
    connect: async (input) => ({ accountId: input.accountId, status: 'connected' }),
    disconnect: async () => undefined,
    setPresence: async (_accountId, input) => input,
    listRoster: async () => [],
    sendMessage: async () => ({ body: { kind: 'text', text: 'sent' }, createdAt: 'now' }),
    discoverMuc: async () => [],
    joinMuc: async () => ({}),
    leaveMuc: async () => ({}),
    sendMucMessage: async () => ({}),
    sendFile: async () => ({}),
    decideCertificateTrust: () => undefined,
  };
  const persistence = {
    upsertAccount: (...args) => calls.push(['upsertAccount', args]),
    saveMessage: (...args) => calls.push(['saveMessage', args]),
    listMessages: () => [],
    listMessagesPage: () => ({ items: [], hasMore: false }),
    listConversations: () => [],
    getPreferences: () => ({}),
    updatePreferences: (...args) => calls.push(['updatePreferences', args]),
    resetPreferences: (...args) => calls.push(['resetPreferences', args]),
  };
  const secrets = { put: () => undefined, get: () => 'secret' };
  const incoming = {
    get: () => ({
      offer: { accountId: 'one@example.invalid', transferId: 'transfer-1' },
      ownerSenderId: 7,
    }),
    accept: async () => {
      calls.push(['accept']);
      return {};
    },
    reject: async () => {
      calls.push(['reject']);
      return {};
    },
    cancel: async () => {
      calls.push(['cancel']);
      return {};
    },
    list: () => [],
  };
  const outgoing = {
    get: () => {
      throw new Error('missing');
    },
    cancel: async () => ({}),
    list: () => [],
  };

  const options = {
    ipcMain: {
      handle: (channel, handler) => {
        if (handlers.has(channel)) throw new Error(`DUPLICATE_CHANNEL:${channel}`);
        handlers.set(channel, handler);
      },
    },
    assertSender: () => {
      if (!senderAuthorized) throw new Error('UNAUTHORIZED');
    },
    validateXmppTransport: () => ({ transport: 'starttls' }),
    appIsPackaged: false,
    getRuntime: () => ({ persistence, secrets, xmpp }),
    fileTransfers: incoming,
    outgoingFileTransfers: outgoing,
    historySecurity,
    selectFileSource: async () => null,
  };
  registerIpcHandlers(options);
  return {
    handlers,
    options,
    calls,
    xmpp,
    incoming,
    setAuthorized(value) {
      accountAuthorized = value;
      senderAuthorized = value;
    },
    setOriginAuthorized(value) {
      senderAuthorized = value;
    },
  };
}

const event = (senderId = 7) => ({ sender: { id: senderId } });

test('registers every existing IPC channel exactly once', () => {
  const harness = createHarness();
  assert.deepEqual([...harness.handlers.keys()], channels);
  assert.equal(harness.handlers.size, channels.length);
});

test('each domain registrar owns only its assigned channels', () => {
  const harness = createHarness();
  const groups = [
    [registerAccountHandlers, channels.slice(0, 9)],
    [registerMucHandlers, channels.slice(9, 13)],
    [registerFileHandlers, channels.slice(13, 18)],
    [registerHistoryHandlers, channels.slice(18, 21)],
    [registerPreferenceHandlers, channels.slice(21, 24)],
    [registerConnectionProfileHandlers, channels.slice(24, 28)],
  ];
  for (const [registrar, expected] of groups) {
    const registered = new Map();
    registrar({
      ...harness.options,
      ipcMain: { handle: (channel, handler) => registered.set(channel, handler) },
      helpers: createIpcHelpers(harness.options),
    });
    assert.deepEqual([...registered.keys()], expected);
  }
});

test('rejects unauthorized senders before returning a successful response', () => {
  const harness = createHarness();
  harness.setAuthorized(false);
  assert.throws(() => harness.handlers.get('contract.version')(event()), /UNAUTHORIZED/);
  assert.throws(
    () =>
      harness.handlers.get('account.setSecret')(event(), {
        version: 1,
        credentialRef: 'ref',
        secret: 'secret',
      }),
    /UNAUTHORIZED/,
  );
});

test('preserves input validation and request correlation', async () => {
  const harness = createHarness();
  assert.throws(
    () =>
      harness.handlers.get('account.setSecret')(event(), {
        version: 2,
        credentialRef: 'ref',
        secret: 'secret',
      }),
    /INVALID_INPUT/,
  );
  await assert.rejects(
    harness.handlers.get('presence.set')(event(), {
      version: 1,
      accountId: 'one@example.invalid',
      availability: 'invalid',
    }),
    /INVALID_INPUT/,
  );
  const result = await harness.handlers.get('account.connect')(event(), {
    version: 1,
    requestId: 'connect-1',
    accountId: 'two@example.invalid',
    endpoint: { host: 'example.invalid', port: 5222, tls: true },
  });
  assert.equal(result.ok, true);
  assert.equal(result.requestId, 'connect-1');
  assert.deepEqual(harness.calls[0][0], 'upsertAccount');
});

test('keeps MUC, file ownership and history authorization checks', async () => {
  const harness = createHarness();
  const mucResult = await harness.handlers.get('muc.join')(event(8), {
    version: 1,
    requestId: 'muc-1',
    accountId: 'one@example.invalid',
    roomJid: 'lobby@conference.example.invalid',
    nickname: 'operator',
  });
  assert.equal(mucResult.ok, false);
  assert.equal(mucResult.error.code, 'UNAUTHORIZED');

  const fileResult = await harness.handlers.get('file.accept')(event(8), {
    version: 1,
    requestId: 'file-1',
    accountId: 'one@example.invalid',
    transferId: 'transfer-1',
  });
  assert.equal(fileResult.ok, false);
  assert.equal(fileResult.error.code, 'UNAUTHORIZED');
  assert.deepEqual(harness.calls, []);

  const historyResult = await harness.handlers.get('messages.list')(event(8), {
    version: 1,
    requestId: 'history-1',
    accountId: 'one@example.invalid',
    conversationId: 'contact@example.invalid',
  });
  assert.equal(historyResult.ok, false);
  assert.equal(historyResult.error.code, 'UNAUTHORIZED');
});

test('file actions reject an unauthorized origin before account or owner checks', async () => {
  const harness = createHarness();
  const input = {
    version: 1,
    requestId: 'file-origin-1',
    accountId: 'one@example.invalid',
    transferId: 'transfer-1',
  };
  harness.setAuthorized(true);
  harness.setOriginAuthorized(false);
  for (const channel of ['file.accept', 'file.reject', 'file.cancel']) {
    const result = await harness.handlers.get(channel)(event(7), input);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'UNAUTHORIZED');
    assert.equal(result.error.requestId, 'file-origin-1');
  }
  assert.deepEqual(harness.calls, []);
});

test('file actions retain positive behavior and independent account and owner denials', async () => {
  const harness = createHarness();
  const input = {
    version: 1,
    requestId: 'file-action-1',
    accountId: 'one@example.invalid',
    transferId: 'transfer-1',
  };
  const actions = ['file.accept', 'file.reject', 'file.cancel'];
  for (const channel of actions) {
    const result = await harness.handlers.get(channel)(event(7), input);
    assert.equal(result.ok, true);
    assert.equal(result.requestId, 'file-action-1');
  }
  assert.deepEqual(harness.calls, [['accept'], ['reject'], ['cancel']]);

  harness.calls.length = 0;
  const accountDenied = await harness.handlers.get('file.accept')(event(8), input);
  assert.equal(accountDenied.error.code, 'UNAUTHORIZED');
  harness.incoming.get = () => ({
    offer: { accountId: 'one@example.invalid', transferId: 'transfer-1' },
    ownerSenderId: 8,
  });
  const ownerDenied = await harness.handlers.get('file.accept')(event(7), input);
  assert.equal(ownerDenied.error.code, 'UNAUTHORIZED');
  assert.deepEqual(harness.calls, []);
});

test('preserves preference scopes and rejects invalid cursors', () => {
  const harness = createHarness();
  harness.handlers.get('preferences.update')(event(), {
    accountId: 'one@example.invalid',
    changes: { theme: 'atomic', notifications: false, autoLogin: true },
  });
  assert.deepEqual(
    harness.calls
      .filter(([name]) => name === 'updatePreferences')
      .map(([, args]) => args.slice(0, 2)),
    [
      ['global', 'app'],
      ['global', 'app'],
      ['account', 'one@example.invalid'],
    ],
  );
  const pageResult = harness.handlers.get('messages.page')(event(), {
    version: 1,
    requestId: 'page-1',
    accountId: 'one@example.invalid',
    conversationId: 'contact@example.invalid',
    limit: 50,
    direction: 'older',
    cursor: 'invalid',
  });
  assert.equal(pageResult.ok, false);
  assert.equal(pageResult.error.code, 'INVALID_INPUT');
});

test('routes transfer events to their owner and XMPP events to current windows', () => {
  const ownerMessages = [];
  const broadcastMessages = [];
  const owner = { isDestroyed: () => false, send: (...args) => ownerMessages.push(args) };
  const first = { isDestroyed: () => false, send: (...args) => broadcastMessages.push(args) };
  const second = { isDestroyed: () => false, send: (...args) => broadcastMessages.push(args) };
  const router = createEventRouter({
    BrowserWindow: { getAllWindows: () => [{ webContents: first }, { webContents: second }] },
    webContents: { fromId: (id) => (id === 7 ? owner : null) },
  });
  router.forwardTransferEvent({
    targetSenderId: 7,
    type: 'file.stateChanged',
    payload: { transferId: '1' },
  });
  router.forwardXmppEvent({
    type: 'presence.changed',
    correlationId: 'presence-1',
    payload: { jid: 'one' },
  });
  assert.equal(ownerMessages.length, 1);
  assert.equal(broadcastMessages.length, 2);
  assert.equal(ownerMessages[0][1].type, 'file.stateChanged');
  assert.equal(broadcastMessages[0][1].correlationId, 'presence-1');
});

test('guards application lifecycle shutdown and window recreation', async () => {
  const listeners = new Map();
  let windows = [];
  let created = 0;
  let quit = 0;
  let exited = 0;
  let shutdowns = 0;
  const app = {
    on: (name, listener) => listeners.set(name, listener),
    quit: () => {
      quit += 1;
    },
    exit: () => {
      exited += 1;
    },
  };
  registerAppLifecycle({
    app,
    BrowserWindow: { getAllWindows: () => windows },
    createWindow: () => {
      created += 1;
      windows = [{}];
    },
    shutdown: async () => {
      shutdowns += 1;
    },
  });
  listeners.get('activate')();
  assert.equal(created, 1);
  windows = [{}];
  listeners.get('activate')();
  assert.equal(created, 1);
  let prevented = false;
  listeners.get('before-quit')({
    preventDefault: () => {
      prevented = true;
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(prevented, true);
  assert.equal(shutdowns, 1);
  assert.equal(exited, 1);
  listeners.get('window-all-closed')();
  assert.equal(quit, process.platform === 'darwin' ? 0 : 1);
});
