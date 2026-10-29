const crypto = require('node:crypto');
const { normalizeXmppDomain, resolveXmppEndpoints } = require('./xmpp-discovery.cjs');

function registerAccountHandlers({
  ipcMain,
  assertSender,
  getRuntime,
  historySecurity,
  helpers,
  validateXmppTransport,
}) {
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
      input.secret.length > 4096 ||
      (input.remember !== undefined && typeof input.remember !== 'boolean') ||
      (input.accountId !== undefined &&
        (typeof input.accountId !== 'string' ||
          input.credentialRef !== `account:${input.accountId}`))
    )
      throw new Error('INVALID_INPUT');
    getRuntime().secrets.put(input.credentialRef, input.secret, {
      remember: input.remember !== false,
    });
    return { ok: true, value: { stored: true }, version: 1, requestId: requestId(event, input) };
  });
  ipcMain.handle('account.connect', async (event, input) => {
    assertSender(event);
    const { persistence, secrets, xmpp } = getRuntime();
    const connectionRequest = requestId(event, input);
    const connectionToken = historySecurity.beginConnection(event.sender.id, connectionRequest);
    const expectedCredentialRef =
      typeof input?.accountId === 'string' ? `account:${input.accountId}` : '';
    const credentialRef = expectedCredentialRef;
    try {
      const validatedInput = validateAccountInput(input);
      if (
        !expectedCredentialRef ||
        (input.credentialRef && input.credentialRef !== expectedCredentialRef)
      )
        throw new Error('INVALID_INPUT');
      const profile = input.profileId ? persistence.getConnectionProfile(input.profileId) : null;
      if (input.profileId && (!profile || profile.accountId !== input.accountId))
        throw new Error('INVALID_INPUT');
      let endpoints;
      let domain = input.profileDomain || input.endpoint?.domain;
      if (profile) {
        domain = normalizeXmppDomain(domain || profile.domain);
        if (profile.mode === 'manual')
          endpoints = [{ ...profile.manualEndpoint, priority: 0, weight: 0 }];
        else endpoints = (await resolveXmppEndpoints(domain)).candidates;
      } else if (validatedInput || input.endpoint) {
        const legacyEndpoint = validatedInput || input.endpoint;
        endpoints = [
          {
            host: legacyEndpoint.host,
            port: legacyEndpoint.port,
            transport:
              legacyEndpoint.transport ||
              (legacyEndpoint.tls && legacyEndpoint.port === 5223 ? 'direct-tls' : 'starttls'),
            priority: 0,
            weight: 0,
          },
        ];
      } else throw new Error('INVALID_ENDPOINT');
      const password = secrets.get(credentialRef);
      if (!password) throw new Error('secret_unavailable');
      let state;
      let lastError;
      for (const candidate of endpoints.slice(0, 3)) {
        const endpoint = {
          host: candidate.host,
          port: candidate.port,
          transport: candidate.transport,
          tls: true,
          ...(domain ? { domain } : {}),
        };
        const transport = validateXmppTransport(endpoint, false) || endpoint;
        persistence.upsertAccount({
          accountId: input.accountId,
          host: endpoint.host,
          port: endpoint.port,
          tls: 1,
          transport: transport.transport,
          credentialRef,
          createdAt: new Date().toISOString(),
        });
        try {
          state = await xmpp.connect(
            { ...input, endpoint: transport, profileId: undefined },
            password,
            event.sender.id,
          );
          break;
        } catch (error) {
          lastError = error;
          if (
            !['SERVER_UNREACHABLE', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH'].includes(error?.code)
          )
            throw error;
        }
      }
      if (!state) throw lastError || new Error('SERVER_UNREACHABLE');
      secrets.clearSession?.(credentialRef);
      historySecurity.completeConnection(event.sender.id, connectionToken, input.accountId);
      return { ok: true, value: state, version: 1, requestId: connectionRequest };
    } catch (error) {
      console.error('[XMPP-CONNECT-FAILED]', {
        transport: input?.endpoint?.transport,
        port: input?.endpoint?.port,
        phase: error?.phase || 'connect',
        code: error?.code || error?.message || 'TRANSPORT_FAILED',
      });
      return connectionError(error, connectionRequest);
    } finally {
      secrets.clearSession?.(credentialRef);
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
