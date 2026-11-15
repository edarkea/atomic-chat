const { requireBareJid } = require('../xmpp/xmpp-user-profile.cjs');

/**
 * @typedef {{version?: unknown, requestId?: unknown, accountId?: unknown, jid?: unknown, mode?: unknown, profile?: unknown, referenceId?: unknown, streamId?: unknown, sequence?: unknown}} ProfileInput
 * @typedef {{sender: {id: number}}} IpcEvent
 * @typedef {{handle: (channel: string, handler: (event: IpcEvent, input: ProfileInput) => Promise<unknown>) => void}} IpcMain
 * @typedef {{authorize: (senderId: number, accountId: string) => boolean}} HistorySecurity
 * @typedef {{validVersion: (input: ProfileInput) => boolean, requestId: (event: IpcEvent, input?: ProfileInput) => string}} IpcHelpers
 * @typedef {{getUserProfile: (senderId: number, accountId: string, jid: string, mode?: 'remote' | 'stored') => Promise<unknown>, updateUserProfile: (senderId: number, accountId: string, input: Record<string, string | null | undefined>) => Promise<unknown>, updateUserProfileAvatar: (senderId: number, accountId: string, filePath: string | null) => Promise<unknown>, clearUserProfileAvatar: (senderId: number, accountId: string) => Promise<unknown>, openUserProfileImage: (senderId: number, input: ProfileInput) => Promise<unknown>, readUserProfileImage: (senderId: number, input: ProfileInput) => Promise<unknown>, closeUserProfileImage: (senderId: number, input: ProfileInput) => Promise<unknown>, revokeUserProfileImage: (senderId: number, input: ProfileInput) => Promise<unknown>}} ProfileXmpp
 * @typedef {{xmpp: ProfileXmpp}} ProfileRuntime
 */

/** @param {{ipcMain: IpcMain, assertSender: (event: IpcEvent) => void, getRuntime: () => ProfileRuntime, historySecurity: HistorySecurity, selectAvatarSource: () => Promise<string | null>, helpers: IpcHelpers}} dependencies */
function registerUserProfileHandlers({
  ipcMain,
  assertSender,
  getRuntime,
  historySecurity,
  selectAvatarSource,
  helpers,
}) {
  const { requestId, validVersion } = helpers;
  const knownCodes = new Set([
    'INVALID_INPUT',
    'INVALID_ACCOUNT',
    'INVALID_JID',
    'UNAUTHORIZED',
    'NOT_CONNECTED',
    'TIMEOUT',
    'RESOURCE_CONSTRAINT',
    'STALE_RESPONSE',
    'PROFILE_UNAVAILABLE',
    'MEDIA_TYPE_UNSUPPORTED',
    'MEDIA_SIZE_EXCEEDED',
    'MEDIA_DIMENSIONS_INVALID',
    'MEDIA_DECODE_FAILED',
    'MEDIA_REFERENCE_REVOKED',
    'CONFLICT',
  ]);
  const messages = /** @type {Record<string, string>} */ ({
    INVALID_INPUT: 'La solicitud de perfil no es válida.',
    INVALID_ACCOUNT: 'La cuenta de la solicitud no es válida.',
    INVALID_JID: 'El JID del perfil no es válido.',
    UNAUTHORIZED: 'La ventana o cuenta no están autorizadas para este perfil.',
    NOT_CONNECTED: 'La cuenta no está conectada.',
    TIMEOUT: 'La consulta del perfil agotó el tiempo permitido.',
    RESOURCE_CONSTRAINT: 'Se alcanzó el límite temporal de consultas o streams.',
    STALE_RESPONSE: 'La respuesta del perfil pertenece a una sesión obsoleta.',
    PROFILE_UNAVAILABLE: 'El perfil XMPP no está disponible.',
    MEDIA_TYPE_UNSUPPORTED: 'La foto del perfil no es PNG/JPEG estático.',
    MEDIA_SIZE_EXCEEDED: 'La foto del perfil supera el tamaño permitido.',
    MEDIA_DIMENSIONS_INVALID: 'Las dimensiones de la foto del perfil no están permitidas.',
    MEDIA_DECODE_FAILED: 'La foto del perfil no se pudo validar.',
    MEDIA_REFERENCE_REVOKED: 'La referencia de la foto expiró o fue revocada.',
    CONFLICT: 'El estado o la secuencia de la foto no es válido.',
  });

  /** @param {unknown} error @param {IpcEvent} event @param {ProfileInput} input */
  function errorResult(error, event, input) {
    const typedError = /** @type {{code?: unknown, message?: unknown}} */ (error);
    const raw =
      typeof typedError.code === 'string'
        ? typedError.code
        : typeof typedError.message === 'string'
          ? typedError.message
          : '';
    const code = knownCodes.has(raw) ? raw : 'INTERNAL';
    return {
      ok: false,
      version: 1,
      error: {
        code,
        retryable: code === 'TIMEOUT' || code === 'RESOURCE_CONSTRAINT' || code === 'NOT_CONNECTED',
        requestId: requestId(event, input),
        message: messages[code] || 'No fue posible leer el perfil XMPP.',
      },
    };
  }

  /** @param {IpcEvent} event @param {ProfileInput} input @param {boolean} [needsReference] */
  function authorize(event, input, needsReference = false) {
    assertSender(event);
    if (
      !validVersion(input) ||
      typeof input?.requestId !== 'string' ||
      !input.requestId.trim() ||
      typeof input?.accountId !== 'string' ||
      !input.accountId.trim()
    )
      throw new Error('INVALID_INPUT');
    if (input.mode !== undefined && input.mode !== 'remote' && input.mode !== 'stored')
      throw new Error('INVALID_INPUT');
    if (needsReference) {
      if (typeof input.referenceId !== 'string' || !input.referenceId.trim())
        throw new Error('INVALID_INPUT');
    }
    if (!historySecurity.authorize(event.sender.id, input.accountId))
      throw new Error('UNAUTHORIZED');
  }

  /** @param {unknown} profile @returns {Record<string, string | null | undefined>} */
  function profileUpdate(profile) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile))
      throw new Error('INVALID_INPUT');
    const value = /** @type {Record<string, unknown>} */ (profile);
    const allowed = new Set([
      'displayName',
      'givenName',
      'middleName',
      'familyName',
      'company',
      'jobTitle',
      'homeAddress',
      'homeCity',
      'homeState',
      'homePostalCode',
      'homeCountry',
      'phone',
      'mobile',
      'fax',
      'pager',
      'birthday',
      'description',
      'website',
      'nickname',
      'email',
    ]);
    for (const [key, field] of Object.entries(value)) {
      if (!allowed.has(key) || (field !== null && typeof field !== 'string'))
        throw new Error('INVALID_INPUT');
      if (
        typeof field === 'string' &&
        field.length >
          (key === 'email'
            ? 1280
            : key === 'birthday'
              ? 40
              : key === 'description'
                ? 4000
                : key === 'website'
                  ? 8192
                  : ['phone', 'mobile', 'fax', 'pager'].includes(key)
                    ? 256
                    : 640)
      )
        throw new Error('INVALID_INPUT');
    }
    return /** @type {Record<string, string | null | undefined>} */ (value);
  }

  ipcMain.handle('userProfiles.get', async (event, input) => {
    try {
      authorize(event, input);
      const accountId = requireBareJid(input.accountId);
      const jid = requireBareJid(input.jid);
      const value = await getRuntime().xmpp.getUserProfile(
        event.sender.id,
        accountId,
        jid,
        input.mode === 'stored' ? 'stored' : 'remote',
      );
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return errorResult(error, event, input);
    }
  });

  ipcMain.handle('userProfiles.update', async (event, input) => {
    try {
      authorize(event, input);
      const accountId = requireBareJid(input.accountId);
      const value = await getRuntime().xmpp.updateUserProfile(
        event.sender.id,
        accountId,
        profileUpdate(input.profile),
      );
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return errorResult(error, event, input);
    }
  });

  ipcMain.handle('userProfiles.avatar.update', async (event, input) => {
    try {
      authorize(event, input);
      const accountId = requireBareJid(input.accountId);
      const filePath = await selectAvatarSource();
      if (!filePath) return { ok: true, value: null, version: 1, requestId: input.requestId };
      if (!historySecurity.authorize(event.sender.id, accountId)) throw new Error('UNAUTHORIZED');
      const value = await getRuntime().xmpp.updateUserProfileAvatar(
        event.sender.id,
        accountId,
        filePath,
      );
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return errorResult(error, event, input);
    }
  });

  ipcMain.handle('userProfiles.avatar.clear', async (event, input) => {
    try {
      authorize(event, input);
      const accountId = requireBareJid(input.accountId);
      const value = await getRuntime().xmpp.clearUserProfileAvatar(event.sender.id, accountId);
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return errorResult(error, event, input);
    }
  });

  ipcMain.handle('userProfiles.image.open', async (event, input) => {
    try {
      authorize(event, input, true);
      const value = await getRuntime().xmpp.openUserProfileImage(event.sender.id, input);
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return errorResult(error, event, input);
    }
  });

  ipcMain.handle('userProfiles.image.read', async (event, input) => {
    try {
      authorize(event, input, true);
      if (
        typeof input.streamId !== 'string' ||
        !input.streamId.trim() ||
        typeof input.sequence !== 'number' ||
        !Number.isInteger(input.sequence) ||
        input.sequence < 0
      )
        throw new Error('INVALID_INPUT');
      const value = await getRuntime().xmpp.readUserProfileImage(event.sender.id, input);
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return errorResult(error, event, input);
    }
  });

  ipcMain.handle('userProfiles.image.close', async (event, input) => {
    try {
      authorize(event, input, true);
      if (typeof input.streamId !== 'string' || !input.streamId.trim())
        throw new Error('INVALID_INPUT');
      await getRuntime().xmpp.closeUserProfileImage(event.sender.id, input);
      return { ok: true, value: undefined, version: 1, requestId: input.requestId };
    } catch (error) {
      return errorResult(error, event, input);
    }
  });

  ipcMain.handle('userProfiles.image.revoke', async (event, input) => {
    try {
      authorize(event, input, true);
      await getRuntime().xmpp.revokeUserProfileImage(event.sender.id, input);
      return { ok: true, value: undefined, version: 1, requestId: input.requestId };
    } catch (error) {
      return errorResult(error, event, input);
    }
  });
}

module.exports = { registerUserProfileHandlers };
