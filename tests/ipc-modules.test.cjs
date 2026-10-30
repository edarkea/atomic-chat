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
const { registerAttentionHandlers } = require('../electron/ipc-attention-handlers.cjs');
const { registerBroadcastHandlers } = require('../electron/ipc-broadcast-handlers.cjs');
const { registerFileHistoryHandlers } = require('../electron/ipc-file-history-handlers.cjs');
const { registerPreviewHandlers } = require('../electron/ipc-preview-handlers.cjs');

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
  'chatState.send',
  'broadcast.send',
  'muc.discover',
  'muc.join',
  'muc.leave',
  'muc.sendMessage',
  'file.send',
  'file.sendDropped',
  'file.accept',
  'file.reject',
  'file.cancel',
  'file.open',
  'file.reveal',
  'file.listActive',
  'preview.get',
  'preview.open',
  'preview.read',
  'preview.close',
  'preview.revoke',
  'fileHistory.open',
  'fileHistory.reveal',
  'messages.list',
  'messages.page',
  'timeline.page',
  'conversations.list',
  'media.list',
  'preferences.get',
  'preferences.update',
  'preferences.selectDownloadDirectory',
  'preferences.reset',
  'connectionProfiles.list',
  'connectionProfiles.save',
  'connectionProfiles.delete',
  'account.forgetSecret',
  'attention.request',
  'attention.clear',
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
  let historyGate = null;
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
  const localFileActions = {
    open: async (senderId, input) => {
      calls.push(['open', senderId, input.transferId]);
    },
    reveal: async (senderId, input) => {
      calls.push(['reveal', senderId, input.transferId]);
    },
  };
  const fileHistory = {
    open: async (accountId, conversationId, fileId, isAuthorized) => {
      if (historyGate) await historyGate;
      if (isAuthorized && !isAuthorized()) throw new Error('UNAUTHORIZED');
      calls.push(['history-open', accountId, conversationId, fileId]);
    },
    reveal: async (accountId, conversationId, fileId, isAuthorized) => {
      if (historyGate) await historyGate;
      if (isAuthorized && !isAuthorized()) throw new Error('UNAUTHORIZED');
      calls.push(['history-reveal', accountId, conversationId, fileId]);
    },
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
    getRuntime: () => ({ persistence, secrets, xmpp, fileHistory }),
    fileTransfers: incoming,
    outgoingFileTransfers: outgoing,
    localFileActions,
    historySecurity,
    selectFileSource: async () => null,
    selectDownloadDirectory: async () => null,
    defaultDownloadDirectory: 'C:\\Users\\tester\\Documents\\Downloads',
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
    setHistoryGate(value) {
      historyGate = value;
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
    [
      registerAccountHandlers,
      [
        'contract.version',
        'account.setSecret',
        'account.connect',
        'certificate.decide',
        'account.disconnect',
        'session.getState',
        'presence.set',
        'roster.list',
        'message.send',
        'chatState.send',
      ],
    ],
    [registerBroadcastHandlers, ['broadcast.send']],
    [registerMucHandlers, channels.slice(11, 15)],
    [registerFileHandlers, channels.slice(15, 23)],
    [registerPreviewHandlers, channels.slice(23, 28)],
    [registerFileHistoryHandlers, channels.slice(28, 30)],
    [registerHistoryHandlers, channels.slice(30, 35)],
    [registerPreferenceHandlers, channels.slice(35, 39)],
    [registerConnectionProfileHandlers, channels.slice(39, 43)],
    [registerAttentionHandlers, channels.slice(43, 45)],
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

test('broadcast uses the transport without persisting sender copies', async () => {
  const harness = createHarness();
  const result = await harness.handlers.get('broadcast.send')(event(), {
    version: 1,
    requestId: 'broadcast-request',
    accountId: 'one@example.invalid',
    broadcastId: 'broadcast-1',
    recipientJids: ['two@example.invalid', 'two@example.invalid', 'three@example.invalid'],
    body: { kind: 'text', text: 'hola' },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value.recipients.map((item) => item.recipientJid), [
    'two@example.invalid',
    'three@example.invalid',
  ]);
  assert.ok(result.value.recipients.every((item) => item.status === 'submitted'));
  assert.equal(callsWith(harness.calls, 'saveMessage').length, 0);
});

test('validates and propagates alert mode through the authorized IPC path', async () => {
  const harness = createHarness();
  const sent = [];
  harness.xmpp.sendMessage = async (_accountId, input) => {
    sent.push(input);
    return { body: input.body, createdAt: 'now' };
  };
  const result = await harness.handlers.get('broadcast.send')(event(), {
    version: 1,
    requestId: 'alert-request',
    accountId: 'one@example.invalid',
    broadcastId: 'broadcast-alert',
    mode: 'alert',
    recipientJids: ['two@example.invalid'],
    body: { kind: 'text', text: 'alerta' },
  });
  assert.equal(result.ok, true);
  assert.equal(sent[0].mode, 'alert');
  const invalid = await harness.handlers.get('broadcast.send')(event(), {
    version: 1,
    requestId: 'invalid-mode-request',
    accountId: 'one@example.invalid',
    broadcastId: 'broadcast-invalid',
    mode: 'headline',
    recipientJids: ['two@example.invalid'],
    body: { kind: 'text', text: 'invalido' },
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'INVALID_INPUT');
});

test('private message.send keeps its existing sender persistence', async () => {
  const harness = createHarness();
  const result = await harness.handlers.get('message.send')(event(), {
    version: 1,
    requestId: 'private-request',
    accountId: 'one@example.invalid',
    conversationId: 'two@example.invalid',
    clientMessageId: 'private-message-1',
    body: { kind: 'text', text: 'privado' },
  });
  assert.equal(result.ok, true);
  assert.equal(callsWith(harness.calls, 'saveMessage').length, 1);
});

function callsWith(calls, name) {
  return calls.filter(([call]) => call === name);
}

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

test('routes dropped files through the authorized sender and existing XMPP transfer path', async () => {
  const harness = createHarness();
  const calls = [];
  harness.xmpp.sendFile = async (accountId, input) => {
    calls.push([accountId, input]);
    return { offer: { transferId: 'drop-1' } };
  };
  const result = await harness.handlers.get('file.sendDropped')(event(7), {
    version: 1,
    source: 'preload-webutils-file-v1',
    requestId: 'file-drop-1',
    accountId: 'one@example.invalid',
    conversationId: 'contact@example.invalid',
    filePath: '/tmp/fixtures/theme.html',
  });
  assert.equal(result.ok, true);
  assert.equal(result.requestId, 'file-drop-1');
  assert.deepEqual(calls, [
    [
      'one@example.invalid',
      {
        filePath: '/tmp/fixtures/theme.html',
        fileName: 'theme.html',
        conversationId: 'contact@example.invalid',
        ownerSenderId: 7,
      },
    ],
  ]);
  const invalidSource = await harness.handlers.get('file.sendDropped')(event(7), {
    version: 1,
    requestId: 'file-drop-invalid-source',
    accountId: 'one@example.invalid',
    conversationId: 'contact@example.invalid',
    filePath: '/tmp/fixtures/other.html',
  });
  assert.equal(invalidSource.ok, false);
  assert.equal(invalidSource.error.code, 'INVALID_INPUT');
  assert.equal(calls.length, 1);
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
  for (const channel of ['file.accept', 'file.reject', 'file.cancel', 'file.open', 'file.reveal']) {
    const result = await harness.handlers.get(channel)(event(7), input);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'UNAUTHORIZED');
    assert.equal(result.error.requestId, 'file-origin-1');
  }
  assert.deepEqual(harness.calls, []);
});

test('local file actions keep account and renderer authorization without XMPP connectivity', async () => {
  const harness = createHarness();
  harness.xmpp.sessions.clear();
  harness.xmpp.states.clear();
  const input = {
    version: 1,
    requestId: 'file-local-1',
    accountId: 'one@example.invalid',
    transferId: 'transfer-1',
  };
  const opened = await harness.handlers.get('file.open')(event(7), input);
  const revealed = await harness.handlers.get('file.reveal')(event(7), input);
  assert.equal(opened.ok, true);
  assert.equal(revealed.ok, true);
  assert.deepEqual(harness.calls, [
    ['open', 7, 'transfer-1'],
    ['reveal', 7, 'transfer-1'],
  ]);
});

test('historical file actions use opaque ids and preserve account/window authorization', async () => {
  const harness = createHarness();
  const input = {
    version: 1,
    requestId: 'history-file-1',
    accountId: 'one@example.invalid',
    conversationId: 'contact@example.invalid',
    fileId: 'file_opaque',
  };
  const opened = await harness.handlers.get('fileHistory.open')(event(7), input);
  const revealed = await harness.handlers.get('fileHistory.reveal')(event(7), input);
  assert.equal(opened.ok, true);
  assert.equal(revealed.ok, true);
  assert.deepEqual(harness.calls.slice(-2), [
    ['history-open', input.accountId, input.conversationId, input.fileId],
    ['history-reveal', input.accountId, input.conversationId, input.fileId],
  ]);
  harness.setAuthorized(false);
  const denied = await harness.handlers.get('fileHistory.open')(event(7), input);
  assert.equal(denied.ok, false);
  assert.equal(denied.error.code, 'UNAUTHORIZED');
});

test('historical IPC action is rejected when authorization expires while pending', async () => {
  const harness = createHarness();
  let release;
  harness.setHistoryGate(new Promise((resolve) => { release = resolve; }));
  const input = {
    version: 1,
    requestId: 'history-pending-1',
    accountId: 'one@example.invalid',
    conversationId: 'contact@example.invalid',
    fileId: 'file_opaque',
  };
  const pending = harness.handlers.get('fileHistory.open')(event(7), input);
  await new Promise((resolve) => setImmediate(resolve));
  harness.setAuthorized(false);
  release();
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'UNAUTHORIZED');
  assert.equal(harness.calls.some(([name]) => name === 'history-open'), false);
});

test('preserves safe MUC diagnostics at the IPC boundary', async () => {
  const harness = createHarness();
  harness.xmpp.joinMuc = async () => {
    throw Object.assign(new Error('policy'), { code: 'MUC_POLICY_MISMATCH' });
  };
  const result = await harness.handlers.get('muc.join')(event(7), {
    version: 1,
    requestId: 'muc-diagnostic-1',
    accountId: 'one@example.invalid',
    roomJid: 'lobby@conference.example.invalid',
    nickname: 'operator',
  });
  assert.equal(result.error.code, 'MUC_POLICY_MISMATCH');
  assert.match(result.error.message, /endpoint/);
  assert.equal(result.error.message.includes('password'), false);
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
