const assert = require('node:assert/strict');
const test = require('node:test');
const { createIpcHelpers } = require('../electron/ipc-helpers.cjs');
const { registerPreferenceHandlers } = require('../electron/ipc-preference-handlers.cjs');

function setup(defaultDownloadDirectory = '') {
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
    selectDownloadDirectory: async () => defaultDownloadDirectory || null,
    defaultDownloadDirectory,
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

test('close-to-tray is opt-in, global, boolean and resettable', () => {
  const { handlers, values } = setup();
  const event = { sender: { id: 1 } };
  assert.equal(handlers.get('preferences.get')(event, {}).value.closeToTray, false);
  handlers.get('preferences.update')(event, { changes: { closeToTray: true } });
  assert.equal(values.get('global:app').closeToTray, true);
  assert.equal(handlers.get('preferences.get')(event, { accountId: 'other' }).value.closeToTray, true);
  assert.throws(() => handlers.get('preferences.update')(event, { changes: { closeToTray: 'yes' } }), /INVALID_INPUT/);
  assert.equal(handlers.get('preferences.reset')(event, {}).value.closeToTray, false);
});

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

test('accepts common CSS color formats while rejecting arbitrary CSS values', () => {
  const { handlers } = setup();
  const flexiblePalette = {
    ...palette,
    background: '#1234',
    surface: '#11223344',
    accent: 'rgb(114, 255, 139)',
    focus: 'hsl(128 100% 86% / 80%)',
  };
  handlers.get('preferences.update')(
    { sender: { id: 1 } },
    {
      accountId: 'account@example.invalid',
      changes: { theme: 'custom', customTheme: flexiblePalette },
    },
  );
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
        {
          accountId: 'account@example.invalid',
          changes: { customTheme: { ...palette, accent: 'red; color: blue' } },
        },
      ),
    /INVALID_INPUT/,
  );
  assert.throws(
    () =>
      setup().handlers.get('preferences.update')(
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

test('reset removes the saved custom palette from every preference scope', () => {
  const { handlers, values } = setup();
  handlers.get('preferences.update')(
    { sender: { id: 1 } },
    {
      accountId: 'account@example.invalid',
      changes: { theme: 'custom', customTheme: palette, autoLogin: true },
    },
  );

  handlers.get('preferences.reset')({ sender: { id: 1 } }, { accountId: 'account@example.invalid' });

  assert.equal(values.has('global:app'), false);
  assert.equal(values.has('account:account@example.invalid'), false);
  const restored = handlers.get('preferences.get')({ sender: { id: 1 } }, { accountId: '' });
  assert.equal(restored.value.theme, 'atomic');
  assert.equal(Object.hasOwn(restored.value, 'customTheme'), false);
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
      changes: {
        hideClosedConversations: true,
        fileTransferTimeoutSeconds: 600,
        autoAcceptFileTransfers: true,
      },
    },
  );
  assert.deepEqual(calls, [
    ['global', 'app', { hideClosedConversations: true }],
    ['global', 'app', { fileTransferTimeoutSeconds: 600 }],
    ['global', 'app', { autoAcceptFileTransfers: true }],
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
  assert.throws(
    () =>
      handlers.get('preferences.update')(
        { sender: { id: 1 } },
        { accountId: 'account@example.invalid', changes: { autoAcceptFileTransfers: 'yes' } },
      ),
    /INVALID_INPUT/,
  );
});

test('uses Documents/Downloads as the default and returns a selected directory', async () => {
  const defaultDirectory = 'C:\\Users\\tester\\Documents\\Downloads';
  const { handlers } = setup(defaultDirectory);
  const preferences = handlers.get('preferences.get')({ sender: { id: 1 } }, { accountId: '' });
  assert.equal(preferences.value.downloadDirectory, defaultDirectory);
  assert.equal(preferences.value.autoAcceptFileTransfers, false);

  const selected = await handlers.get('preferences.selectDownloadDirectory')({ sender: { id: 1 } });
  assert.deepEqual(selected, {
    ok: true,
    value: defaultDirectory,
    version: 1,
    requestId: selected.requestId,
  });
});
