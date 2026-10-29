const crypto = require('node:crypto');
const path = require('node:path');

const preferenceDefaults = { theme: 'atomic', notifications: true, autoLogin: false };

function registerIpcHandlers({
  ipcMain,
  assertSender,
  validateXmppTransport,
  appIsPackaged,
  getRuntime,
  fileTransfers,
  outgoingFileTransfers,
  historySecurity,
  selectFileSource,
}) {
  function requestId(event, input) {
    return input?.requestId || `ipc_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  }

  function validVersion(input) {
    return input?.version === 1;
  }

  function requireText(value, name) {
    if (typeof value !== 'string' || !value.trim() || value.length > 512)
      throw new Error(`INVALID_${name}`);
    return value.trim();
  }

  function validateAccountInput(input) {
    if (!validVersion(input)) throw new Error('UNSUPPORTED');
    requireText(input.accountId, 'ACCOUNT');
    return validateXmppTransport(input.endpoint, appIsPackaged);
  }

  function validateCertificateDecision(input) {
    if (
      !validVersion(input) ||
      typeof input.requestId !== 'string' ||
      !input.requestId.trim() ||
      typeof input.accountId !== 'string' ||
      !input.accountId.trim() ||
      typeof input.fingerprintSha256 !== 'string' ||
      !input.fingerprintSha256.trim() ||
      !['cancel', 'trust_once', 'trust_and_remember'].includes(input.decision)
    )
      throw new Error('INVALID_INPUT');
  }

  function connectionError(error, requestIdValue) {
    const certificate = error?.verificationError;
    const knownCodes = new Set([
      'CERTIFICATE_REJECTED',
      'CERTIFICATE_DECISION_TIMEOUT',
      'CERTIFICATE_INVALID',
      'TRANSPORT_INCOMPATIBLE',
      'STARTTLS_UNAVAILABLE',
      'TLS_NEGOTIATION_FAILED',
      'SERVER_UNREACHABLE',
      'AUTH_FAILED',
      'TLS_POLICY',
    ]);
    const rawCode = error?.code;
    const code =
      error?.message === 'secret_unavailable' ||
      error?.message === 'certificate_storage_unavailable'
        ? 'STORAGE_FAILED'
        : rawCode === 'TLS_POLICY'
          ? 'UNSUPPORTED'
          : ['not-authorized', 'AUTH_FAILED'].includes(rawCode)
            ? 'AUTH_FAILED'
            : ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(rawCode)
              ? 'SERVER_UNREACHABLE'
              : [
                    'ERR_SSL_WRONG_VERSION_NUMBER',
                    'ERR_SSL_UNSUPPORTED_PROTOCOL',
                    'ERR_TLS_CERT_ALTNAME_INVALID',
                    'TLS_NEGOTIATION_FAILED',
                  ].includes(rawCode)
                ? 'TLS_NEGOTIATION_FAILED'
                : knownCodes.has(rawCode)
                  ? rawCode
                  : 'TRANSPORT_FAILED';
    const messages = {
      CERTIFICATE_REJECTED: 'La conexión fue cancelada porque no se aceptó el certificado.',
      CERTIFICATE_INVALID:
        certificate?.message || 'El certificado no cumple la política de seguridad.',
      TRANSPORT_INCOMPATIBLE: 'El transporte configurado no coincide con el servidor o el puerto.',
      STARTTLS_UNAVAILABLE: 'El servidor no ofrece STARTTLS.',
      TLS_NEGOTIATION_FAILED: 'Falló la negociación TLS.',
      SERVER_UNREACHABLE: 'No fue posible alcanzar el servidor XMPP.',
      AUTH_FAILED: 'El servidor rechazó la autenticación.',
      STORAGE_FAILED: 'No fue posible acceder al almacenamiento seguro.',
      UNSUPPORTED: 'La política de seguridad no permite este transporte.',
    };
    const message = messages[code] || 'No fue posible conectar con el servidor XMPP.';
    return {
      ok: false,
      version: 1,
      error: {
        code,
        retryable: code === 'TRANSPORT_FAILED',
        requestId: requestIdValue,
        message,
        ...(certificate ? { certificate } : {}),
      },
    };
  }

  function authorizeMucInput(event, input) {
    const { xmpp } = getRuntime();
    if (
      !validVersion(input) ||
      typeof input.requestId !== 'string' ||
      !input.requestId.trim() ||
      typeof input.accountId !== 'string' ||
      !input.accountId.trim()
    )
      throw new Error('INVALID_INPUT');
    if (!historySecurity.authorize(event.sender.id, input.accountId))
      throw new Error('UNAUTHORIZED');
    if (
      !xmpp.sessions.has(input.accountId) ||
      xmpp.states.get(input.accountId)?.status !== 'connected'
    )
      throw new Error('NOT_CONNECTED');
  }

  function mucError(error, event, input) {
    const raw = error?.code || error?.message;
    const known = new Set([
      'INVALID_INPUT',
      'UNAUTHORIZED',
      'NOT_CONNECTED',
      'TIMEOUT',
      'TRANSPORT_FAILED',
      'CONFLICT',
      'UNSUPPORTED',
      'INTERNAL',
    ]);
    const code = known.has(raw)
      ? raw
      : raw === 'not_connected'
        ? 'NOT_CONNECTED'
        : 'TRANSPORT_FAILED';
    const messages = {
      INVALID_INPUT: 'La solicitud MUC no es válida.',
      UNAUTHORIZED:
        'La operación MUC no está autorizada o requiere configuración del administrador.',
      NOT_CONNECTED: 'La cuenta no está conectada o la sala ya no está disponible.',
      TIMEOUT: 'La operación MUC excedió el tiempo límite.',
      CONFLICT: 'La operación MUC entra en conflicto con el estado actual de la sala.',
      UNSUPPORTED: 'El servidor no ofrece la capacidad MUC solicitada.',
      INTERNAL: 'No fue posible completar la operación MUC.',
      TRANSPORT_FAILED: 'El transporte XMPP no pudo completar la operación MUC.',
    };
    return {
      ok: false,
      version: 1,
      error: {
        code,
        retryable: code === 'TIMEOUT' || code === 'TRANSPORT_FAILED',
        requestId: requestId(event, input),
        message: messages[code],
      },
    };
  }

  function validateMucRoomInput(input, requireBody = false) {
    if (
      typeof input.roomJid !== 'string' ||
      !input.roomJid.trim() ||
      input.roomJid.length > 512 ||
      input.roomJid.includes('/') ||
      !/^[^@\s]+@[^@\s]+$/.test(input.roomJid.trim())
    )
      throw new Error('INVALID_INPUT');
    if (
      requireBody &&
      (typeof input.clientMessageId !== 'string' ||
        !input.clientMessageId.trim() ||
        input.clientMessageId.length > 512)
    )
      throw new Error('INVALID_INPUT');
  }

  function fileRecord(transferId) {
    try {
      return fileTransfers.get(transferId);
    } catch {
      return outgoingFileTransfers.get(transferId);
    }
  }

  function authorizeFileInput(event, input) {
    const { xmpp } = getRuntime();
    assertSender(event);
    if (
      !validVersion(input) ||
      typeof input.requestId !== 'string' ||
      !input.requestId.trim() ||
      typeof input.accountId !== 'string' ||
      !input.accountId.trim() ||
      typeof input.transferId !== 'string' ||
      !input.transferId.trim()
    )
      throw new Error('INVALID_INPUT');
    if (!historySecurity.authorize(event.sender.id, input.accountId))
      throw new Error('UNAUTHORIZED');
    if (
      !xmpp.sessions.has(input.accountId) ||
      xmpp.states.get(input.accountId)?.status !== 'connected'
    )
      throw new Error('NOT_CONNECTED');
    const record = fileRecord(input.transferId);
    if (record.offer.accountId !== input.accountId || record.ownerSenderId !== event.sender.id)
      throw new Error('UNAUTHORIZED');
    return record;
  }

  function fileResultError(error, event, input) {
    const raw = error?.code || error?.message;
    const known = new Set([
      'INVALID_INPUT',
      'UNAUTHORIZED',
      'NOT_CONNECTED',
      'TIMEOUT',
      'CONFLICT',
      'STORAGE_FAILED',
      'TRANSPORT_FAILED',
      'UNSUPPORTED',
      'INTERNAL',
    ]);
    const code = known.has(raw)
      ? raw
      : raw === 'RESOURCE_CONSTRAINT'
        ? 'CONFLICT'
        : raw === 'UNSUPPORTED_METHOD'
          ? 'UNSUPPORTED'
          : raw === 'RECIPIENT_UNAVAILABLE'
            ? 'NOT_CONNECTED'
            : raw === 'REMOTE_REJECTED'
              ? 'CONFLICT'
              : 'INTERNAL';
    return {
      ok: false,
      version: 1,
      error: {
        code,
        retryable: code === 'TIMEOUT' || code === 'TRANSPORT_FAILED' || code === 'NOT_CONNECTED',
        requestId: requestId(event, input),
        message:
          code === 'STORAGE_FAILED'
            ? 'No fue posible acceder al archivo.'
            : code === 'NOT_CONNECTED'
              ? 'El destinatario ya no está disponible.'
              : 'No fue posible completar la transferencia.',
      },
    };
  }

  function authorizeHistoryInput(event, input) {
    if (
      !validVersion(input) ||
      typeof input.requestId !== 'string' ||
      !input.requestId.trim() ||
      typeof input.accountId !== 'string' ||
      !input.accountId.trim()
    )
      throw new Error('INVALID_INPUT');
    if (!historySecurity.authorize(event.sender.id, input.accountId))
      throw new Error('UNAUTHORIZED');
  }

  function historyError(error, event, input) {
    const code =
      error.message === 'INVALID_INPUT'
        ? 'INVALID_INPUT'
        : error.message === 'UNAUTHORIZED'
          ? 'UNAUTHORIZED'
          : 'STORAGE_FAILED';
    return {
      ok: false,
      version: 1,
      error: {
        code,
        retryable: false,
        requestId: requestId(event, input),
        message:
          code === 'INVALID_INPUT'
            ? 'La solicitud de historial no es válida.'
            : code === 'UNAUTHORIZED'
              ? 'La cuenta no está autorizada para esta ventana.'
              : 'No fue posible consultar el historial.',
      },
    };
  }

  function preferenceScope(key, accountId) {
    return key === 'autoLogin'
      ? { scope: 'account', scopeId: accountId }
      : { scope: 'global', scopeId: 'app' };
  }

  function validatePreferences(changes) {
    const allowed = {
      theme: (value) => value === 'atomic',
      notifications: (value) => typeof value === 'boolean',
      autoLogin: (value) => typeof value === 'boolean',
    };
    for (const [key, value] of Object.entries(changes || {}))
      if (!allowed[key] || !allowed[key](value)) throw new Error('INVALID_INPUT');
  }

  ipcMain.handle('contract.version', (event) => {
    assertSender(event);
    return { version: 1 };
  });
  ipcMain.handle('account.setSecret', (event, input) => {
    assertSender(event);
    if (
      !validVersion(input) ||
      typeof input.credentialRef !== 'string' ||
      typeof input.secret !== 'string' ||
      !input.secret ||
      input.secret.length > 4096
    )
      throw new Error('INVALID_INPUT');
    const { secrets } = getRuntime();
    secrets.put(input.credentialRef, input.secret);
    return { ok: true, value: { stored: true }, version: 1, requestId: requestId(event, input) };
  });
  ipcMain.handle('account.connect', async (event, input) => {
    assertSender(event);
    const { persistence, secrets, xmpp } = getRuntime();
    const connectionRequest = requestId(event, input);
    const connectionToken = historySecurity.beginConnection(event.sender.id, connectionRequest);
    try {
      const validated = validateAccountInput(input) || {
        transport:
          input.endpoint.transport ||
          (input.endpoint.tls && input.endpoint.port === 5223 ? 'direct-tls' : 'starttls'),
      };
      const password = secrets.get(input.credentialRef);
      persistence.upsertAccount({
        accountId: input.accountId,
        host: input.endpoint.host,
        port: input.endpoint.port,
        tls: 1,
        transport: validated.transport,
        credentialRef: input.credentialRef || null,
        createdAt: new Date().toISOString(),
      });
      const state = await xmpp.connect(
        { ...input, endpoint: { ...input.endpoint, transport: validated.transport, tls: true } },
        password,
        event.sender.id,
      );
      historySecurity.completeConnection(event.sender.id, connectionToken, input.accountId);
      return { ok: true, value: state, version: 1, requestId: connectionRequest };
    } catch (error) {
      console.error('[XMPP-CONNECT-FAILED]', {
        transport:
          input?.endpoint?.transport ||
          (input?.endpoint?.tls && input?.endpoint?.port === 5223 ? 'direct-tls' : 'starttls'),
        port: input?.endpoint?.port,
        phase: error?.phase || 'connect',
        code: error?.code || 'TRANSPORT_FAILED',
      });
      return connectionError(error, connectionRequest);
    } finally {
      historySecurity.finishConnection(event.sender.id, connectionToken);
    }
  });
  ipcMain.handle('certificate.decide', (event, input) => {
    assertSender(event);
    try {
      validateCertificateDecision(input);
      getRuntime().xmpp.decideCertificateTrust(event.sender.id, input);
      return { ok: true, value: undefined, version: 1, requestId: input.requestId };
    } catch (error) {
      const code = error.message === 'CERTIFICATE_DECISION_CONFLICT' ? 'CONFLICT' : 'INVALID_INPUT';
      return {
        ok: false,
        version: 1,
        error: {
          code,
          retryable: false,
          requestId: requestId(event, input),
          message:
            code === 'CONFLICT'
              ? 'La decisión ya no corresponde al certificado mostrado.'
              : 'La decisión del certificado no es válida.',
        },
      };
    }
  });
  ipcMain.handle('account.disconnect', async (event, accountId) => {
    assertSender(event);
    await getRuntime().xmpp.disconnect(accountId);
    return { ok: true, value: undefined, version: 1, requestId: requestId(event) };
  });
  ipcMain.handle('session.getState', (event, accountId) => {
    assertSender(event);
    requireText(accountId, 'ACCOUNT');
    const { xmpp } = getRuntime();
    const state = xmpp.states.get(accountId) || {
      accountId,
      status: 'idle',
      retryable: false,
      since: new Date().toISOString(),
    };
    return { ok: true, value: state, version: 1, requestId: requestId(event) };
  });
  ipcMain.handle('presence.set', async (event, input) => {
    assertSender(event);
    if (
      !validVersion(input) ||
      typeof input.accountId !== 'string' ||
      !input.accountId.trim() ||
      !['available', 'unavailable'].includes(input.availability) ||
      (input.mode !== undefined && !['chat', 'away', 'dnd', 'xa'].includes(input.mode)) ||
      (input.status !== undefined &&
        (typeof input.status !== 'string' || input.status.length > 256))
    )
      throw new Error('INVALID_INPUT');
    const value = await getRuntime().xmpp.setPresence(input.accountId, input);
    return { ok: true, value, version: 1, requestId: requestId(event, input) };
  });
  ipcMain.handle('roster.list', async (event, accountId) => {
    assertSender(event);
    const value = await getRuntime().xmpp.listRoster(accountId);
    return { ok: true, value, version: 1, requestId: requestId(event) };
  });
  ipcMain.handle('message.send', async (event, input) => {
    assertSender(event);
    if (!validVersion(input)) throw new Error('UNSUPPORTED');
    const { persistence, xmpp } = getRuntime();
    const accountId = requireText(input.accountId, 'ACCOUNT');
    if (!xmpp.sessions.has(accountId) || xmpp.states.get(accountId)?.status !== 'connected')
      throw new Error('NOT_CONNECTED');
    const conversationId = requireText(input.conversationId, 'CONVERSATION');
    const clientMessageId = requireText(input.clientMessageId, 'MESSAGE_ID');
    if (
      input.body?.kind !== 'text' ||
      typeof input.body.text !== 'string' ||
      !input.body.text.trim()
    )
      throw new Error('INVALID_BODY');
    const sent = await xmpp.sendMessage(accountId, { ...input, to: conversationId });
    const value = {
      ...sent,
      id: `msg_${crypto.randomUUID()}`,
      accountId,
      conversationId,
      clientMessageId,
      senderJid: accountId,
      status: 'sent',
    };
    persistence.saveMessage(value);
    return { ok: true, value, version: 1, requestId: requestId(event, input) };
  });
  ipcMain.handle('muc.discover', async (event, input) => {
    assertSender(event);
    try {
      authorizeMucInput(event, input);
      const value = await getRuntime().xmpp.discoverMuc(input);
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return mucError(error, event, input);
    }
  });
  ipcMain.handle('muc.join', async (event, input) => {
    assertSender(event);
    try {
      authorizeMucInput(event, input);
      validateMucRoomInput(input);
      if (
        typeof input.nickname !== 'string' ||
        !input.nickname.trim() ||
        input.nickname.length > 128
      )
        throw new Error('INVALID_INPUT');
      const value = await getRuntime().xmpp.joinMuc(input);
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return mucError(error, event, input);
    }
  });
  ipcMain.handle('muc.leave', async (event, input) => {
    assertSender(event);
    try {
      authorizeMucInput(event, input);
      validateMucRoomInput(input);
      const value = await getRuntime().xmpp.leaveMuc(input);
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return mucError(error, event, input);
    }
  });
  ipcMain.handle('muc.sendMessage', async (event, input) => {
    assertSender(event);
    try {
      authorizeMucInput(event, input);
      validateMucRoomInput(input, true);
      if (
        input.body?.kind !== 'text' ||
        typeof input.body.text !== 'string' ||
        !input.body.text.trim() ||
        Buffer.byteLength(input.body.text, 'utf8') > 4096
      )
        throw new Error('INVALID_INPUT');
      const value = await getRuntime().xmpp.sendMucMessage(input);
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return mucError(error, event, input);
    }
  });
  ipcMain.handle('file.send', async (event, input) => {
    try {
      assertSender(event);
      if (
        !validVersion(input) ||
        typeof input.requestId !== 'string' ||
        !input.requestId.trim() ||
        typeof input.accountId !== 'string' ||
        !input.accountId.trim() ||
        typeof input.conversationId !== 'string' ||
        !input.conversationId.trim()
      )
        throw new Error('INVALID_INPUT');
      if (!historySecurity.authorize(event.sender.id, input.accountId))
        throw new Error('UNAUTHORIZED');
      const { xmpp } = getRuntime();
      if (
        !xmpp.sessions.has(input.accountId) ||
        xmpp.states.get(input.accountId)?.status !== 'connected'
      )
        throw new Error('NOT_CONNECTED');
      const filePath = await selectFileSource();
      if (!filePath) return { ok: true, value: null, version: 1, requestId: input.requestId };
      const value = await xmpp.sendFile(input.accountId, {
        filePath,
        fileName: path.basename(filePath),
        conversationId: input.conversationId,
        ownerSenderId: event.sender.id,
      });
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return fileResultError(error, event, input);
    }
  });
  ipcMain.handle('file.accept', async (event, input) => {
    try {
      const record = authorizeFileInput(event, input);
      return {
        ok: true,
        value: await fileTransfers.accept(record.offer.transferId, event.sender.id),
        version: 1,
        requestId: input.requestId,
      };
    } catch (error) {
      return fileResultError(error, event, input);
    }
  });
  ipcMain.handle('file.reject', async (event, input) => {
    try {
      const record = authorizeFileInput(event, input);
      return {
        ok: true,
        value: await fileTransfers.reject(record.offer.transferId),
        version: 1,
        requestId: input.requestId,
      };
    } catch (error) {
      return fileResultError(error, event, input);
    }
  });
  ipcMain.handle('file.cancel', async (event, input) => {
    try {
      const record = authorizeFileInput(event, input);
      const value =
        record.direction === 'outgoing'
          ? await outgoingFileTransfers.cancel(record.offer.transferId)
          : await fileTransfers.cancel(record.offer.transferId);
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return fileResultError(error, event, input);
    }
  });
  ipcMain.handle('file.listActive', (event, input) => {
    try {
      assertSender(event);
      if (
        !validVersion(input) ||
        typeof input.requestId !== 'string' ||
        !input.requestId.trim() ||
        typeof input.accountId !== 'string' ||
        !input.accountId.trim() ||
        !historySecurity.authorize(event.sender.id, input.accountId)
      )
        throw new Error('UNAUTHORIZED');
      return {
        ok: true,
        value: [
          ...fileTransfers.list(input.accountId),
          ...outgoingFileTransfers.list(input.accountId),
        ],
        version: 1,
        requestId: input.requestId,
      };
    } catch (error) {
      return fileResultError(error, event, input);
    }
  });
  ipcMain.handle('messages.list', (event, input) => {
    assertSender(event);
    try {
      authorizeHistoryInput(event, input);
      if (typeof input.conversationId !== 'string' || !input.conversationId.trim())
        throw new Error('INVALID_INPUT');
      const { persistence } = getRuntime();
      return {
        ok: true,
        value: persistence.listMessages(input.accountId, input.conversationId),
        version: 1,
        requestId: requestId(event, input),
      };
    } catch (error) {
      return historyError(error, event, input);
    }
  });
  ipcMain.handle('messages.page', (event, input) => {
    assertSender(event);
    try {
      authorizeHistoryInput(event, input);
      if (
        typeof input.conversationId !== 'string' ||
        !input.conversationId.trim() ||
        !['older', 'newer'].includes(input.direction) ||
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 100
      )
        throw new Error('INVALID_INPUT');
      const cursor =
        input.cursor == null
          ? null
          : historySecurity.decodeCursor(input.cursor, input.accountId, input.conversationId);
      const position = cursor ? cursor[input.direction === 'older' ? 'lower' : 'upper'] : null;
      const result = getRuntime().persistence.listMessagesPage(
        input.accountId,
        input.conversationId,
        input.limit,
        input.direction,
        position,
      );
      const first = result.items[0];
      const last = result.items[result.items.length - 1];
      const nextCursor =
        first && last
          ? historySecurity.encodeCursor({
              accountId: input.accountId,
              conversationId: input.conversationId,
              lower: { createdAt: first.createdAt, id: first.id },
              upper: { createdAt: last.createdAt, id: last.id },
            })
          : null;
      return {
        ok: true,
        value: { ...result, nextCursor },
        version: 1,
        requestId: input.requestId,
      };
    } catch (error) {
      return historyError(error, event, input);
    }
  });
  ipcMain.handle('conversations.list', (event, input) => {
    assertSender(event);
    try {
      authorizeHistoryInput(event, input);
      return {
        ok: true,
        value: getRuntime().persistence.listConversations(input.accountId),
        version: 1,
        requestId: requestId(event, input),
      };
    } catch (error) {
      return historyError(error, event, input);
    }
  });
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

module.exports = { preferenceDefaults, registerIpcHandlers };
