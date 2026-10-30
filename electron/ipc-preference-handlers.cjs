const { preferenceDefaults } = require('./ipc-helpers.cjs');
const { normalizeDownloadDirectory } = require('./download-directory.cjs');

function registerPreferenceHandlers({
  ipcMain,
  assertSender,
  getRuntime,
  helpers,
  selectDownloadDirectory = async () => null,
  defaultDownloadDirectory = '',
}) {
  const { requestId, preferenceKeys, preferenceScope, validatePreferences, normalizeThemeId } =
    helpers;
  const defaults = { ...preferenceDefaults, downloadDirectory: defaultDownloadDirectory };

  ipcMain.handle('preferences.get', (event, input) => {
    assertSender(event);
    const { persistence, xmpp } = getRuntime();
    const accountId = input?.accountId || [...xmpp.sessions.keys()][0] || '';
    const values = { ...defaults };
    for (const key of preferenceKeys) {
      const target = preferenceScope(key, accountId);
      Object.assign(values, persistence.getPreferences(target.scope, target.scopeId));
    }
    values.theme = normalizeThemeId(values.theme);
    values.downloadDirectory = normalizeDownloadDirectory(
      values.downloadDirectory,
      defaultDownloadDirectory,
    );
    return { ok: true, value: values, version: 1, requestId: requestId(event) };
  });
  ipcMain.handle('preferences.update', (event, input) => {
    assertSender(event);
    validatePreferences(input?.changes);
    const { persistence, xmpp } = getRuntime();
    const accountId = input?.accountId || [...xmpp.sessions.keys()][0] || '';
    const changes = input?.changes || {};
    const current = { ...defaults };
    for (const key of preferenceKeys) {
      const target = preferenceScope(key, accountId);
      Object.assign(current, persistence.getPreferences(target.scope, target.scopeId));
    }
    current.downloadDirectory = normalizeDownloadDirectory(
      current.downloadDirectory,
      defaultDownloadDirectory,
    );
    const merged = { ...current, ...changes };
    validatePreferences(merged, true);
    if (merged.theme === 'custom' && !merged.customTheme) throw new Error('INVALID_INPUT');
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
  ipcMain.handle('preferences.selectDownloadDirectory', async (event, input) => {
    assertSender(event);
    const directory = normalizeDownloadDirectory(await selectDownloadDirectory(), null);
    return { ok: true, value: directory, version: 1, requestId: requestId(event, input) };
  });
  ipcMain.handle('preferences.reset', (event, input) => {
    assertSender(event);
    const { persistence, xmpp } = getRuntime();
    const accountId = input?.accountId || [...xmpp.sessions.keys()][0] || '';
    persistence.resetPreferences('global', 'app');
    persistence.resetPreferences('account', accountId);
    return { ok: true, value: defaults, version: 1, requestId: requestId(event, input) };
  });
}

module.exports = { registerPreferenceHandlers };
