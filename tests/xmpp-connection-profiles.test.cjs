const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const tls = require('node:tls');
const EventEmitter = require('node:events');
const { resolveXmppEndpoints } = require('../electron/xmpp-discovery.cjs');
const { PersistenceStore } = require('../electron/storage.cjs');
const { SecretStore } = require('../electron/secrets.cjs');
const {
  registerConnectionProfileHandlers,
} = require('../electron/ipc-connection-profile-handlers.cjs');
const { createIpcHelpers } = require('../electron/ipc-helpers.cjs');
const { XmppAdapter } = require('../electron/xmpp-adapter.cjs');

function resolver(recordsByService, errorByService = {}) {
  return async (service) => {
    if (errorByService[service])
      throw Object.assign(new Error(errorByService[service]), { code: errorByService[service] });
    if (!(service in recordsByService))
      throw Object.assign(new Error('missing'), { code: 'ENODATA' });
    return recordsByService[service];
  };
}

test('DNS SRV separates STARTTLS and direct TLS and honors priority and weight', async () => {
  const result = await resolveXmppEndpoints('Example.com', {
    resolveSrv: resolver({
      '_xmpp-client._tcp.example.com': [
        { name: 'start.example.com.', port: 5222, priority: 10, weight: 1 },
        { name: 'other.example.com.', port: 5222, priority: 20, weight: 100 },
      ],
      '_xmpps-client._tcp.example.com': [
        { name: 'secure.example.com.', port: 5223, priority: 10, weight: 0 },
      ],
    }),
    random: () => 0,
  });
  assert.equal(result.domain, 'example.com');
  assert.equal(result.fallback, false);
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.host),
    ['start.example.com', 'secure.example.com', 'other.example.com'],
  );
  assert.deepEqual(
    result.candidates.map((candidate) => candidate.transport),
    ['starttls', 'direct-tls', 'starttls'],
  );
});

test('DNS SRV deduplicates valid records and falls back only when both services are absent', async () => {
  const duplicate = { name: 'chat.localhost.', port: 5222, priority: 0, weight: 0 };
  const result = await resolveXmppEndpoints('localhost', {
    resolveSrv: resolver({ '_xmpp-client._tcp.localhost': [duplicate, duplicate] }),
  });
  assert.equal(result.fallback, false);
  assert.equal(result.candidates.length, 1);
  const fallback = await resolveXmppEndpoints('localhost', { resolveSrv: resolver({}) });
  assert.deepEqual(fallback.candidates[0], {
    host: 'localhost',
    port: 5222,
    priority: 0,
    weight: 0,
    transport: 'starttls',
  });
});

test('DNS SRV rejects explicit service denial, invalid records, and transient errors', async () => {
  await assert.rejects(
    () =>
      resolveXmppEndpoints('example.com', {
        resolveSrv: resolver({
          '_xmpp-client._tcp.example.com': [{ name: '.', port: 5222, priority: 0, weight: 0 }],
        }),
      }),
    /SERVICE_UNAVAILABLE/,
  );
  await assert.rejects(
    () =>
      resolveXmppEndpoints('example.com', {
        resolveSrv: resolver({
          '_xmpp-client._tcp.example.com': [
            { name: 'bad host', port: 5222, priority: 0, weight: 0 },
          ],
        }),
      }),
    /INVALID_DNS_RESPONSE/,
  );
  await assert.rejects(
    () =>
      resolveXmppEndpoints('example.com', {
        resolveSrv: resolver({}, { '_xmpp-client._tcp.example.com': 'EAI_AGAIN' }),
      }),
    /EAI_AGAIN/,
  );
});

test('direct TLS probes TCP at the SRV host but sends SNI for the logical XMPP domain', async () => {
  const certificate = {
    raw: Buffer.from('synthetic-certificate'),
    fingerprint256: 'AA:BB:CC:DD',
    subject: { CN: 'empresa.com' },
    issuer: { CN: 'empresa.com' },
    valid_from: 'Jan 01 00:00:00 2020 GMT',
    valid_to: 'Jan 01 00:00:00 2035 GMT',
    subjectaltname: 'DNS:empresa.com',
    sigalg: 'RSA-SHA256',
    bits: 2048,
  };
  certificate.issuerCertificate = certificate;
  const originalConnect = tls.connect;
  let options;
  tls.connect = (connectionOptions) => {
    options = connectionOptions;
    const socket = new EventEmitter();
    socket.getPeerCertificate = () => certificate;
    socket.authorizationError = undefined;
    socket.authorized = true;
    socket.destroy = () => undefined;
    queueMicrotask(() => socket.emit('secureConnect'));
    return socket;
  };
  try {
    const adapter = new XmppAdapter();
    const result = await adapter.probeDirectCertificate(
      { host: 'srv.empresa.com', port: 5223 },
      'empresa.com',
    );
    assert.equal(options.host, 'srv.empresa.com');
    assert.equal(options.servername, 'empresa.com');
    assert.equal(result.certificate, certificate);
    adapter.probeDirectCertificate = async () => ({
      certificate: { ...certificate, subjectaltname: 'DNS:srv.empresa.com' },
      authorized: true,
      authorizationError: undefined,
    });
    await assert.rejects(
      () =>
        adapter.resolveTlsOptions(
          {
            requestId: 'tls-domain',
            accountId: 'juan@empresa.com',
            endpoint: { host: 'srv.empresa.com', domain: 'empresa.com', port: 5223 },
          },
          1,
          { transport: 'direct-tls' },
        ),
      (error) => error.code === 'CERTIFICATE_INVALID',
    );
  } finally {
    tls.connect = originalConnect;
  }
});

test('connection profiles survive restart without storing credentials and preserve account isolation', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-conn-profile-'));
  let store = new PersistenceStore(directory);
  const profileA = {
    accountId: 'juan@empresa-a.com',
    domain: 'empresa-a.com',
    mode: 'automatic',
    updatedAt: '2026-10-29T12:00:00.000Z',
  };
  const profileB = {
    accountId: 'juan@empresa-b.com',
    domain: 'empresa-b.com',
    mode: 'manual',
    manualEndpoint: { host: 'chat.empresa-b.com', port: 5222, transport: 'starttls' },
    updatedAt: '2026-10-29T12:01:00.000Z',
  };
  assert.deepEqual(store.saveConnectionProfile(profileA), profileA);
  assert.deepEqual(store.saveConnectionProfile(profileB), profileB);
  store.upsertAccount({
    accountId: profileA.accountId,
    host: 'srv.empresa-a.com',
    port: 5222,
    tls: 1,
    credentialRef: 'account:juan@empresa-a.com',
    createdAt: profileA.updatedAt,
  });
  store.saveMessage({
    id: 'message-a',
    accountId: profileA.accountId,
    conversationId: 'contact@empresa-a.com',
    clientMessageId: 'client-a',
    senderJid: profileA.accountId,
    body: { kind: 'text', text: 'a' },
    status: 'sent',
    createdAt: profileA.updatedAt,
  });
  store.close();
  store = new PersistenceStore(directory);
  assert.deepEqual(store.listConnectionProfiles(), [profileB, profileA]);
  store.deleteConnectionProfile(profileA.accountId);
  assert.equal(store.listMessages(profileA.accountId, 'contact@empresa-a.com').length, 1);
  assert.equal(store.getConnectionProfile(profileA.accountId), null);
  store.close();
});

test('legacy account identity remains stable while an explicit XMPP domain is supplied for connection', async () => {
  const calls = [];
  const profile = {
    accountId: 'juan',
    domain: '',
    mode: 'manual',
    manualEndpoint: { host: 'srv.empresa.com', port: 5222, transport: 'starttls' },
    updatedAt: '2026-10-29T12:00:00.000Z',
  };
  const persistence = {
    getConnectionProfile: (accountId) => (accountId === 'juan' ? profile : null),
    upsertAccount: (value) => calls.push(['account', value]),
  };
  const secrets = {
    get: (reference) => {
      calls.push(['secret', reference]);
      return 'legacy-password';
    },
    clearSession: () => undefined,
  };
  const xmpp = {
    connect: async (input) => {
      calls.push(['connect', input]);
      return {
        accountId: input.accountId,
        status: 'connected',
        retryable: false,
        since: new Date().toISOString(),
      };
    },
  };
  const handlers = new Map();
  const historySecurity = {
    beginConnection: () => 'token',
    completeConnection: () => undefined,
    finishConnection: () => undefined,
  };
  const { registerAccountHandlers } = require('../electron/ipc-account-handlers.cjs');
  const options = {
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    assertSender: () => undefined,
    getRuntime: () => ({ persistence, secrets, xmpp }),
    historySecurity,
    validateXmppTransport: (endpoint) => ({ ...endpoint, rejectUnauthorized: true }),
    helpers: createIpcHelpers({
      assertSender: () => undefined,
      validateXmppTransport: (endpoint) => ({ ...endpoint, rejectUnauthorized: true }),
      appIsPackaged: false,
      getRuntime: () => ({ xmpp }),
      fileTransfers: {},
      outgoingFileTransfers: {},
      historySecurity,
    }),
  };
  registerAccountHandlers(options);
  const result = await handlers.get('account.connect')(
    { sender: { id: 1 } },
    {
      version: 1,
      requestId: 'legacy-connect',
      accountId: 'juan',
      profileId: 'juan',
      profileDomain: 'empresa.com',
      credentialRef: 'account:juan',
    },
  );
  assert.equal(result.ok, true);
  assert.equal(calls.find((call) => call[0] === 'secret')[1], 'account:juan');
  const connected = calls.find((call) => call[0] === 'connect')[1];
  assert.equal(connected.accountId, 'juan');
  assert.equal(connected.endpoint.domain, 'empresa.com');
  const secretCallCount = calls.filter((call) => call[0] === 'secret').length;
  const rejected = await handlers.get('account.connect')(
    { sender: { id: 1 } },
    {
      version: 1,
      requestId: 'cross-account',
      accountId: 'maria',
      credentialRef: 'account:juan',
      endpoint: { host: 'srv.empresa.com', port: 5222, transport: 'starttls' },
    },
  );
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error.code, 'INVALID_INPUT');
  assert.equal(calls.filter((call) => call[0] === 'secret').length, secretCallCount);
});

test('maps typed DNS and transport failures to stable connection error codes', () => {
  const helpers = createIpcHelpers({
    assertSender: () => undefined,
    validateXmppTransport: (endpoint) => endpoint,
    appIsPackaged: false,
    getRuntime: () => ({}),
    fileTransfers: {},
    outgoingFileTransfers: {},
    historySecurity: {},
  });
  for (const code of [
    'INVALID_DOMAIN',
    'INVALID_DNS_RESPONSE',
    'DNS_TIMEOUT',
    'SERVICE_UNAVAILABLE',
    'SERVER_UNREACHABLE',
    'TLS_NEGOTIATION_FAILED',
    'AUTH_FAILED',
  ]) {
    const result = helpers.connectionError({ code }, 'typed-error');
    assert.equal(result.ok, false);
    assert.equal(result.error.code, code);
    assert.equal(result.error.requestId, 'typed-error');
  }
});

test('temporary secrets never reach disk and remember false revokes a prior persistent secret', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-secret-'));
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (value) => value.toString('utf8'),
  };
  const store = new SecretStore(safeStorage, directory);
  store.put('account:a@example.com', 'persistent', { remember: true });
  store.put('account:a@example.com', 'temporary', { remember: false });
  assert.equal(store.get('account:a@example.com'), 'temporary');
  assert.equal(store.hasPersistent('account:a@example.com'), false);
  assert.doesNotMatch(
    fs.readFileSync(path.join(directory, 'secrets.json'), 'utf8'),
    /persistent|temporary/,
  );
  store.clearSession('account:a@example.com');
  assert.equal(store.get('account:a@example.com'), undefined);
});

test('profile IPC validates sender, account identity, and secret revocation without returning secrets', () => {
  const handlers = new Map();
  let authorized = true;
  const profiles = new Map();
  const calls = [];
  const runtime = {
    persistence: {
      listConnectionProfiles: () => [...profiles.values()],
      saveConnectionProfile: (profile) => {
        profiles.set(profile.accountId, profile);
        return profile;
      },
      deleteConnectionProfile: (accountId) => profiles.delete(accountId),
      getConnectionProfile: (accountId) => profiles.get(accountId) || null,
      updatePreferences: (...args) => calls.push(args),
    },
    secrets: { delete: (reference) => calls.push(['delete', reference]) },
  };
  const options = {
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    assertSender: () => {
      if (!authorized) throw new Error('UNAUTHORIZED');
    },
    getRuntime: () => runtime,
    helpers: createIpcHelpers({
      assertSender: () => undefined,
      validateXmppTransport: () => undefined,
      appIsPackaged: false,
      getRuntime: () => runtime,
      fileTransfers: {},
      outgoingFileTransfers: {},
      historySecurity: {},
    }),
  };
  registerConnectionProfileHandlers(options);
  const event = { sender: { id: 1 } };
  const profile = {
    accountId: 'juan@empresa.com',
    domain: 'empresa.com',
    mode: 'automatic',
    updatedAt: new Date().toISOString(),
  };
  assert.equal(
    handlers.get('connectionProfiles.save')(event, { version: 1, requestId: 'save-1', profile }).ok,
    true,
  );
  assert.equal(
    handlers.get('connectionProfiles.list')(event, { version: 1, requestId: 'list-1' }).value[0]
      .accountId,
    profile.accountId,
  );
  assert.equal(
    handlers.get('account.forgetSecret')(event, {
      version: 1,
      requestId: 'forget-1',
      accountId: profile.accountId,
    }).ok,
    true,
  );
  assert.deepEqual(calls[0], ['delete', `account:${profile.accountId}`]);
  assert.throws(
    () =>
      handlers.get('account.forgetSecret')(event, {
        version: 1,
        requestId: 'forget-2',
        accountId: 'other@empresa.com',
      }),
    /INVALID_INPUT/,
  );
  authorized = false;
  assert.throws(
    () => handlers.get('connectionProfiles.list')(event, { version: 1, requestId: 'list-2' }),
    /UNAUTHORIZED/,
  );
});
