const crypto = require('node:crypto');

function registerAccountHandlers({ ipcMain, assertSender, getRuntime, historySecurity, helpers }) {
  const {
    requestId,
    validVersion,
    requireText,
    validateAccountInput,
    validateCertificateDecision,
    connectionError,
  } = helpers;

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
    getRuntime().secrets.put(input.credentialRef, input.secret);
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
}

module.exports = { registerAccountHandlers };
