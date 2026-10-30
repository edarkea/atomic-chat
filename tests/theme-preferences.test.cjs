const assert = require('node:assert/strict');
const test = require('node:test');
const { createIpcHelpers } = require('../electron/ipc-helpers.cjs');
const { registerPreferenceHandlers } = require('../electron/ipc-preference-handlers.cjs');

function setup() {
  const handlers = new Map();
  const values = new Map();
  const calls = [];
  const persistence = {
    getPreferences: (scope, scopeId) => values.get(`${scope}:${scopeId}`) || {},
    updatePreferences: (scope, scopeId, changes) => {
      calls.push([scope, scopeId, changes]);
      const key = `${scope}:${scopeId}`;
      values.set(key, { ...values.get(key), ...changes });
    },
    resetPreferences: (scope, scopeId) => values.delete(`${scope}:${scopeId}`),
  };
  const xmpp = { sessions: new Map([['account@example.invalid', {}]]) };
  const helpers = createIpcHelpers({
    assertSender: () => undefined,
    validateXmppTransport: (endpoint) => endpoint,
    appIsPackaged: false,
    getRuntime: () => ({ persistence, xmpp }),
  });
  registerPreferenceHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    assertSender: () => undefined,
    getRuntime: () => ({ persistence, xmpp }),
    helpers,
  });
  return { handlers, calls, values };
}

const palette = {
  background: '#101410',
  surface: '#182019',
  surfaceRaised: '#263328',
  accent: '#72ff8b',
  text: '#f1fff3',
  textSecondary: '#c9ffd0',
  border: '#74d487',
  incomingBubble: '#28422d',
  outgoingBubble: '#365f3f',
  focus: '#baffc2',
};

test('persists theme id and palette together while retaining preference scopes', () => {
  const { handlers, calls } = setup();
  handlers.get('preferences.update')(
    { sender: { id: 1 } },
    {
      accountId: 'account@example.invalid',
      changes: { theme: 'custom', customTheme: palette, notifications: false, autoLogin: true },
    },
  );

  assert.deepEqual(calls, [
    ['global', 'app', { theme: 'custom', customTheme: palette }],
    ['global', 'app', { notifications: false }],
    ['account', 'account@example.invalid', { autoLogin: true }],
  ]);
});

test('rejects arbitrary CSS keys and non-hex values', () => {
  const { handlers } = setup();
  assert.throws(
    () =>
      handlers.get('preferences.update')(
        { sender: { id: 1 } },
        { accountId: 'account@example.invalid', changes: { customTheme: { '--evil': 'url(x)' } } },
      ),
    /INVALID_INPUT/,
  );
  assert.throws(
    () =>
      handlers.get('preferences.update')(
        { sender: { id: 1 } },
        { accountId: 'account@example.invalid', changes: { theme: 'custom' } },
      ),
    /INVALID_INPUT/,
  );
  for (const theme of ['dark', 'light'])
    assert.throws(
      () =>
        handlers.get('preferences.update')(
          { sender: { id: 1 } },
          { accountId: 'account@example.invalid', changes: { theme } },
        ),
      /INVALID_INPUT/,
    );
});

test('accepts only the current Wasteland presets and switches only the active theme id', () => {
  const { handlers, calls, values } = setup();
  values.set('global:app', { theme: 'custom', customTheme: palette });

  handlers.get('preferences.update')(
    { sender: { id: 1 } },
    { accountId: 'account@example.invalid', changes: { theme: 'atomic-light' } },
  );
  handlers.get('preferences.update')(
    { sender: { id: 1 } },
    { accountId: 'account@example.invalid', changes: { theme: 'atomic' } },
  );

  assert.deepEqual(calls, [
    ['global', 'app', { theme: 'atomic-light' }],
    ['global', 'app', { theme: 'atomic' }],
  ]);
  assert.deepEqual(values.get('global:app').customTheme, palette);
});

test('normalizes legacy corporate ids on read and allows unrelated updates', () => {
  const dark = setup();
  dark.values.set('global:app', { theme: 'dark', customTheme: palette, notifications: false });
  const darkResult = dark.handlers.get('preferences.get')({ sender: { id: 1 } }, { accountId: '' });
  assert.equal(darkResult.value.theme, 'atomic');
  dark.handlers.get('preferences.update')(
    { sender: { id: 1 } },
    { accountId: 'account@example.invalid', changes: { notifications: true } },
  );
  assert.deepEqual(dark.calls, [['global', 'app', { notifications: true }]]);
  assert.equal(dark.values.get('global:app').theme, 'dark');

  const light = setup();
  light.values.set('global:app', { theme: 'light', customTheme: palette });
  const lightResult = light.handlers.get('preferences.get')(
    { sender: { id: 1 } },
    { accountId: '' },
  );
  assert.equal(lightResult.value.theme, 'atomic-light');
});

test('reads global theme before account login and keeps legacy defaults', () => {
  const { handlers, values } = setup();
  values.set('global:app', { theme: 'custom', customTheme: palette, notifications: false });
  values.set('account:account@example.invalid', { autoLogin: true });

  const result = handlers.get('preferences.get')({ sender: { id: 1 } }, { accountId: '' });

  assert.equal(result.ok, true);
  assert.equal(result.value.theme, 'custom');
  assert.equal(result.value.notifications, false);
  assert.equal(result.value.autoLogin, true);
  assert.deepEqual(result.value.customTheme, palette);
});

test('validates the conversation and transfer preference additions', () => {
  const { handlers, calls } = setup();
  handlers.get('preferences.update')(
    { sender: { id: 1 } },
    {
      accountId: 'account@example.invalid',
      changes: { hideClosedConversations: true, fileTransferTimeoutSeconds: 600 },
    },
  );
  assert.deepEqual(calls, [
    ['global', 'app', { hideClosedConversations: true }],
    ['global', 'app', { fileTransferTimeoutSeconds: 600 }],
  ]);
  for (const value of [0, 61, 301, 1000, '300'])
    assert.throws(
      () =>
        handlers.get('preferences.update')(
          { sender: { id: 1 } },
          { accountId: 'account@example.invalid', changes: { fileTransferTimeoutSeconds: value } },
        ),
      /INVALID_INPUT/,
    );
  assert.throws(
    () =>
      handlers.get('preferences.update')(
        { sender: { id: 1 } },
        { accountId: 'account@example.invalid', changes: { hideClosedConversations: 'yes' } },
      ),
    /INVALID_INPUT/,
  );
});
