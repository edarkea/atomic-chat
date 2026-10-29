const { preferenceDefaults } = require('./ipc-helpers.cjs');

function registerPreferenceHandlers({ ipcMain, assertSender, getRuntime, helpers }) {
  const { requestId, preferenceKeys, preferenceScope, validatePreferences } = helpers;

  ipcMain.handle('preferences.get', (event, input) => {
    assertSender(event);
    const { persistence, xmpp } = getRuntime();
    const accountId = input?.accountId || [...xmpp.sessions.keys()][0] || '';
    const values = { ...preferenceDefaults };
    for (const key of preferenceKeys) {
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
    const changes = input?.changes || {};
    const current = { ...preferenceDefaults };
    for (const key of preferenceKeys) {
      const target = preferenceScope(key, accountId);
      Object.assign(current, persistence.getPreferences(target.scope, target.scopeId));
    }
    validatePreferences({ ...current, ...changes });
    const grouped = new Map();
    for (const [key, value] of Object.entries(changes)) {
      const target = preferenceScope(key, accountId);
      const isThemeBundle = key === 'theme' || key === 'customTheme';
      const groupKey = isThemeBundle
        ? `${target.scope}:${target.scopeId}:theme`
        : `${target.scope}:${target.scopeId}:${key}`;
      const group = grouped.get(groupKey) || { target, values: {} };
      group.values[key] = value;
      grouped.set(groupKey, group);
    }
    for (const { target, values } of grouped.values())
      persistence.updatePreferences(target.scope, target.scopeId, values);
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
