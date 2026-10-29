const { preferenceDefaults } = require('./ipc-helpers.cjs');

function registerPreferenceHandlers({ ipcMain, assertSender, getRuntime, helpers }) {
  const { requestId, preferenceScope, validatePreferences } = helpers;

  ipcMain.handle('preferences.get', (event, input) => {
    assertSender(event);
    const { persistence, xmpp } = getRuntime();
    const accountId = input?.accountId || [...xmpp.sessions.keys()][0] || '';
    const values = { ...preferenceDefaults };
    for (const key of Object.keys(preferenceDefaults)) {
      const target = preferenceScope(key, accountId);
      Object.assign(values, persistence.getPreferences(target.scope, target.scopeId));
    }
    return { ok: true, value: values, version: 1, requestId: requestId(event) };
  });
  ipcMain.handle('preferences.update', (event, input) => {
    assertSender(event);
    validatePreferences(input?.changes);
    const { persistence, xmpp } = getRuntime();
    const accountId = input?.accountId || [...xmpp.sessions.keys()][0] || '';
    for (const [key, value] of Object.entries(input.changes)) {
      const target = preferenceScope(key, accountId);
      persistence.updatePreferences(target.scope, target.scopeId, { [key]: value });
    }
    return { ok: true, value: input.changes, version: 1, requestId: requestId(event) };
  });
  ipcMain.handle('preferences.reset', (event, input) => {
    assertSender(event);
    const { persistence, xmpp } = getRuntime();
    const accountId = input?.accountId || [...xmpp.sessions.keys()][0] || '';
    persistence.resetPreferences('global', 'app');
    persistence.resetPreferences('account', accountId);
    return { ok: true, value: preferenceDefaults, version: 1, requestId: requestId(event) };
  });
}

module.exports = { registerPreferenceHandlers };
