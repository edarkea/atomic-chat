const { normalizeXmppDomain } = require('./xmpp-discovery.cjs');

function registerConnectionProfileHandlers({ ipcMain, assertSender, getRuntime, helpers }) {
  const { requestId, validVersion, validateConnectionProfile } = helpers;
  ipcMain.handle('connectionProfiles.list', (event, input) => {
    assertSender(event);
    if (!validVersion(input)) throw new Error('INVALID_INPUT');
    return {
      ok: true,
      value: getRuntime().persistence.listConnectionProfiles(),
      version: 1,
      requestId: requestId(event, input),
    };
  });
  ipcMain.handle('connectionProfiles.save', (event, input) => {
    assertSender(event);
    if (!validVersion(input)) throw new Error('INVALID_INPUT');
    const profile = validateConnectionProfile(input.profile);
    const value = getRuntime().persistence.saveConnectionProfile({
      ...profile,
      domain: normalizeXmppDomain(profile.domain),
      updatedAt: new Date().toISOString(),
    });
    return { ok: true, value, version: 1, requestId: requestId(event, input) };
  });
  ipcMain.handle('connectionProfiles.delete', (event, input) => {
    assertSender(event);
    if (
      !validVersion(input) ||
      typeof input.accountId !== 'string' ||
      !input.accountId.trim() ||
      input.accountId.length > 512
    )
      throw new Error('INVALID_INPUT');
    const runtime = getRuntime();
    runtime.persistence.deleteConnectionProfile(input.accountId);
    runtime.secrets.delete(`account:${input.accountId}`);
    runtime.persistence.updatePreferences('account', input.accountId, { autoLogin: false });
    return { ok: true, value: undefined, version: 1, requestId: requestId(event, input) };
  });
  ipcMain.handle('account.forgetSecret', (event, input) => {
    assertSender(event);
    if (
      !validVersion(input) ||
      typeof input.accountId !== 'string' ||
      !input.accountId.trim() ||
      input.accountId.length > 512
    )
      throw new Error('INVALID_INPUT');
    const runtime = getRuntime();
    if (!runtime.persistence.getConnectionProfile(input.accountId))
      throw new Error('INVALID_INPUT');
    runtime.secrets.delete(`account:${input.accountId}`);
    runtime.persistence.updatePreferences('account', input.accountId, { autoLogin: false });
    return { ok: true, value: undefined, version: 1, requestId: requestId(event, input) };
  });
}

module.exports = { registerConnectionProfileHandlers };
