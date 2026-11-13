const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const PlainMechanism = require('sasl-plain');
const { SecretStore } = require('../electron/security/secrets.cjs');
const { createIpcHelpers } = require('../electron/ipc/ipc-helpers.cjs');
const { registerAccountHandlers } = require('../electron/ipc/ipc-account-handlers.cjs');

const syntheticPassword = '"Demo·2026!';

function createAccountHarness({ secrets, connect }) {
  const handlers = new Map();
  const historySecurity = {
    beginConnection: () => 'synthetic-connection',
    completeConnection: () => undefined,
    finishConnection: () => undefined,
  };
  const persistence = {
    getConnectionProfile: () => null,
    upsertAccount: () => undefined,
  };
  const xmpp = { connect };
  const runtime = { persistence, secrets, xmpp };
  const helpers = createIpcHelpers({
    assertSender: () => undefined,
    validateXmppTransport: (endpoint) => ({ ...endpoint, rejectUnauthorized: true }),
    appIsPackaged: false,
    getRuntime: () => runtime,
    fileTransfers: {},
    outgoingFileTransfers: {},
    historySecurity,
  });
  registerAccountHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    assertSender: () => undefined,
    getRuntime: () => runtime,
    historySecurity,
    helpers,
    validateXmppTransport: (endpoint) => ({ ...endpoint, rejectUnauthorized: true }),
  });
  return { handlers, helpers, runtime };
}

test('preserves U+0022 and U+00B7 through temporary and remembered IPC credentials', async () => {
  for (const remember of [false, true]) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-login-credentials-'));
    const safeStorage = {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value, 'utf8'),
      decryptString: (value) => value.toString('utf8'),
    };
    const secrets = new SecretStore(safeStorage, directory);
    let deliveredPassword;
    const harness = createAccountHarness({
      secrets,
      connect: async (input, password) => {
        deliveredPassword = password;
        return {
          accountId: input.accountId,
          status: 'connected',
          retryable: false,
          since: new Date().toISOString(),
        };
      },
    });
    const event = { sender: { id: 9 } };
    const stored = harness.handlers.get('account.setSecret')(event, {
      version: 1,
      requestId: `set-secret-${remember}`,
      accountId: 'demo@example.test',
      credentialRef: 'account:demo@example.test',
      secret: syntheticPassword,
      remember,
    });
    assert.equal(stored.ok, true);

    const connected = await harness.handlers.get('account.connect')(event, {
      version: 1,
      requestId: `connect-${remember}`,
      accountId: 'demo@example.test',
      credentialRef: 'account:demo@example.test',
      endpoint: { host: 'xmpp.example.test', port: 5222, transport: 'starttls' },
    });
    assert.equal(connected.ok, true);
    assert.equal(deliveredPassword, syntheticPassword);
    assert.deepEqual(
      [...syntheticPassword].map((character) => character.codePointAt(0)),
      [34, 68, 101, 109, 111, 183, 50, 48, 50, 54, 33],
    );
    assert.doesNotMatch(fs.readFileSync(path.join(directory, 'secrets.json'), 'utf8'), /Demo/);
  }
});

test('keeps the previous encrypted file when atomic replacement fails', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-login-atomic-'));
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (value) => value.toString('utf8'),
  };
  const store = new SecretStore(safeStorage, directory);
  store.put('account:demo@example.test', 'previous', { remember: true });
  const file = path.join(directory, 'secrets.json');
  const before = fs.readFileSync(file, 'utf8');
  const rename = fs.renameSync;
  fs.renameSync = () => {
    throw new Error('simulated interruption');
  };
  try {
    assert.throws(
      () => store.put('account:demo@example.test', 'replacement', { remember: true }),
      /secret_unavailable/,
    );
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(store.get('account:demo@example.test'), 'previous');
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  assert.deepEqual(
    fs.readdirSync(directory).filter((name) => name.endsWith('.tmp')),
    [],
  );
});

test('fails closed without overwriting a corrupt secret file', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-login-corrupt-'));
  const file = path.join(directory, 'secrets.json');
  const corrupt = '{"account:demo@example.test":';
  fs.writeFileSync(file, corrupt, 'utf8');
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (value) => value.toString('utf8'),
  };
  const store = new SecretStore(safeStorage, directory);

  assert.equal(store.hasPersistent('account:demo@example.test'), false);
  assert.throws(() => store.get('account:demo@example.test'), /secret_unavailable/);
  assert.throws(
    () => store.put('account:demo@example.test', 'replacement', { remember: true }),
    /secret_unavailable/,
  );
  assert.equal(fs.readFileSync(file, 'utf8'), corrupt);
});

test('allows a session-only credential while persistent storage awaits recovery', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-login-corrupt-session-'));
  const file = path.join(directory, 'secrets.json');
  const corrupt = '{corrupt';
  fs.writeFileSync(file, corrupt, 'utf8');
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (value) => value.toString('utf8'),
  };
  const store = new SecretStore(safeStorage, directory);

  store.put('account:demo@example.test', 'session-password', { remember: false });
  assert.equal(store.get('account:demo@example.test'), 'session-password');
  assert.equal(fs.readFileSync(file, 'utf8'), corrupt);
});

test('restores the latest valid encrypted backup and preserves corrupt evidence', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-login-recovery-'));
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (value) => value.toString('utf8'),
  };
  const store = new SecretStore(safeStorage, directory);
  store.put('account:demo@example.test', 'first', { remember: true });
  store.put('account:demo@example.test', 'latest', { remember: true });
  const file = path.join(directory, 'secrets.json');
  fs.writeFileSync(file, '{corrupt', 'utf8');

  const damaged = new SecretStore(safeStorage, directory);
  assert.equal(damaged.getStatus(), 'recovery_available');
  assert.throws(() => damaged.get('account:demo@example.test'), /secret_unavailable/);
  damaged.recover();

  assert.equal(damaged.getStatus(), 'available');
  assert.equal(damaged.get('account:demo@example.test'), 'latest');
  assert.ok(fs.readdirSync(directory).some((name) => name.startsWith('secrets.json.corrupt-')));
  assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /latest/);
});

test('resets a corrupt store without deleting profiles or leaving a recoverable backup', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-login-reset-'));
  const file = path.join(directory, 'secrets.json');
  fs.writeFileSync(file, '{corrupt', 'utf8');
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: (value) => Buffer.from(value, 'utf8'),
    decryptString: (value) => value.toString('utf8'),
  };
  const store = new SecretStore(safeStorage, directory);
  store.reset();

  assert.equal(store.getStatus(), 'available');
  assert.equal(fs.readFileSync(file, 'utf8'), '{}');
  assert.equal(fs.existsSync(path.join(directory, 'secrets.json.bak')), false);
  store.put('account:demo@example.test', 'new-password', { remember: true });
  assert.equal(store.get('account:demo@example.test'), 'new-password');
});

test('keeps temporary credentials usable when platform secure storage is unavailable', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-login-session-only-'));
  const safeStorage = {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.from('unreachable'),
    decryptString: () => 'unreachable',
  };
  const store = new SecretStore(safeStorage, directory);

  store.put('account:demo@example.test', 'session-password', { remember: false });
  assert.equal(store.get('account:demo@example.test'), 'session-password');
  store.clearSession('account:demo@example.test');
  assert.throws(() => store.get('account:demo@example.test'), /secret_unavailable/);
});

test('PLAIN SASL payload retains the exact UTF-8 password without XML interpolation', () => {
  const mechanism = new PlainMechanism();
  const response = mechanism.response({
    authzid: '',
    username: 'demo',
    password: syntheticPassword,
  });
  const expected = `\0demo\0${syntheticPassword}`;
  assert.equal(response, expected);
  assert.equal(Buffer.from(response, 'utf8').toString('utf8'), expected);
});

test('classifies XMPP conditions with server text as authentication failures', () => {
  const helpers = createIpcHelpers({
    assertSender: () => undefined,
    validateXmppTransport: (endpoint) => endpoint,
    appIsPackaged: false,
    getRuntime: () => ({}),
    fileTransfers: {},
    outgoingFileTransfers: {},
    historySecurity: {},
  });
  const result = helpers.connectionError(
    { condition: 'not-authorized', message: 'not-authorized - server detail' },
    'auth-condition',
  );
  assert.equal(result.error.code, 'AUTH_FAILED');
  assert.equal(result.error.message, 'El servidor rechazó la autenticación.');
});

test('classifies unexpected login failures as INTERNAL and keeps details out of the result', () => {
  const helpers = createIpcHelpers({
    assertSender: () => undefined,
    validateXmppTransport: (endpoint) => endpoint,
    appIsPackaged: false,
    getRuntime: () => ({}),
    fileTransfers: {},
    outgoingFileTransfers: {},
    historySecurity: {},
  });
  const result = helpers.connectionError(new Error(syntheticPassword), 'internal-error');
  assert.equal(result.error.code, 'INTERNAL');
  assert.doesNotMatch(JSON.stringify(result), /Demo/);
});

test('does not log arbitrary XMPP error details', async () => {
  const harness = createAccountHarness({
    secrets: { get: () => syntheticPassword, clearSession: () => undefined },
    connect: async () => {
      throw new Error(syntheticPassword);
    },
  });
  const originalError = console.error;
  const output = [];
  console.error = (...args) => output.push(args);
  try {
    const result = await harness.handlers.get('account.connect')(
      { sender: { id: 9 } },
      {
        version: 1,
        requestId: 'log-safety',
        accountId: 'demo@example.test',
        credentialRef: 'account:demo@example.test',
        endpoint: { host: 'xmpp.example.test', port: 5222, transport: 'starttls' },
      },
    );
    assert.equal(result.error.code, 'INTERNAL');
  } finally {
    console.error = originalError;
  }
  assert.doesNotMatch(JSON.stringify(output), /Demo/);
});

test('reports secure-storage failures without exposing the credential', () => {
  const secrets = {
    put: () => {
      throw new Error(`storage failed for ${syntheticPassword}`);
    },
  };
  const harness = createAccountHarness({
    secrets,
    connect: async () => {
      throw new Error('must not connect');
    },
  });
  const result = harness.handlers.get('account.setSecret')(
    { sender: { id: 9 } },
    {
      version: 1,
      requestId: 'storage-error',
      accountId: 'demo@example.test',
      credentialRef: 'account:demo@example.test',
      secret: syntheticPassword,
      remember: true,
    },
  );
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'STORAGE_FAILED');
  assert.doesNotMatch(JSON.stringify(result), /Demo/);
});
