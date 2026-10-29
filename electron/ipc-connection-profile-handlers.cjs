const { normalizeXmppDomain } = require('./xmpp-discovery.cjs');

function registerConnectionProfileHandlers({ ipcMain, assertSender, getRuntime, helpers }) {
  const { requestId, validVersion, validateConnectionProfile } = helpers;
  const withCredentialMetadata = (runtime, profile) => ({
    ...profile,
    hasPersistentCredential: Boolean(
      runtime.secrets.hasPersistent?.(`account:${profile.accountId}`),
    ),
  });
  ipcMain.handle('connectionProfiles.list', (event, input) => {
    assertSender(event);
    if (!validVersion(input)) throw new Error('INVALID_INPUT');
    const runtime = getRuntime();
    const profiles = runtime.persistence
      .listConnectionProfiles()
      .map((profile) => withCredentialMetadata(runtime, profile));
    return {
      ok: true,
      value: profiles,
      version: 1,
      requestId: requestId(event, input),
    };
  });
  ipcMain.handle('connectionProfiles.save', (event, input) => {
    assertSender(event);
    if (!validVersion(input)) throw new Error('INVALID_INPUT');
    const runtime = getRuntime();
    if (
      !input.profile ||
      typeof input.profile.accountId !== 'string' ||
      !input.profile.accountId.trim() ||
      input.profile.accountId.length > 512
    )
      throw new Error('INVALID_INPUT');
    const existing = runtime.persistence.getConnectionProfile(input.profile?.accountId);
    const allowLegacy = Boolean(
      existing &&
      existing.accountId === input.profile?.accountId &&
      !existing.accountId.includes('@'),
    );
    const profile = validateConnectionProfile(input.profile, { allowLegacy });
    const value = runtime.persistence.saveConnectionProfile({
      accountId: profile.accountId,
      domain: normalizeXmppDomain(profile.domain),
      mode: profile.mode,
      ...(profile.mode === 'manual' ? { manualEndpoint: profile.manualEndpoint } : {}),
      updatedAt: new Date().toISOString(),
    });
    return {
      ok: true,
      value: withCredentialMetadata(runtime, value),
      version: 1,
      requestId: requestId(event, input),
    };
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
