const crypto = require('node:crypto');
const { normalizeXmppDomain, resolveXmppEndpoints } = require('./xmpp-discovery.cjs');

function registerAccountHandlers({
  ipcMain,
  assertSender,
  getRuntime,
  historySecurity,
  previewGrants,
  stickerGrants,
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

  const reactionError = (error, event, input) => {
    const raw = error?.code || error?.message;
    const code = ['INVALID_INPUT', 'UNAUTHORIZED', 'NOT_CONNECTED', 'CONFLICT', 'UNSUPPORTED'].includes(raw)
      ? raw
      : 'TRANSPORT_FAILED';
    return {
      ok: false,
      version: 1,
      error: {
        code,
        retryable: code === 'NOT_CONNECTED' || code === 'TRANSPORT_FAILED',
        requestId: requestId(event, input),
        message: code === 'UNSUPPORTED'
          ? 'El mensaje no tiene un identificador XMPP estable para responder o reaccionar.'
          : code === 'CONFLICT'
            ? 'El servidor rechazó la actualización de reacciones.'
            : 'No fue posible actualizar las reacciones.',
      },
    };
  };

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
    try {
      getRuntime().secrets.put(input.credentialRef, input.secret, {
        remember: input.remember !== false,
      });
    } catch {
      return {
        ok: false,
        version: 1,
        error: {
          code: 'STORAGE_FAILED',
          retryable: false,
          requestId: requestId(event, input),
          message: 'No fue posible acceder al almacenamiento seguro.',
        },
      };
    }
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
        if (profile.accountId.includes('@')) {
          const persistedDomain = normalizeXmppDomain(profile.domain);
          if (domain && normalizeXmppDomain(domain) !== persistedDomain)
            throw new Error('INVALID_INPUT');
          domain = persistedDomain;
        } else {
          domain = normalizeXmppDomain(domain || profile.domain);
        }
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
      const diagnosticCodes = new Set([
        'CERTIFICATE_REJECTED',
        'CERTIFICATE_DECISION_TIMEOUT',
        'CERTIFICATE_INVALID',
        'TRANSPORT_INCOMPATIBLE',
        'STARTTLS_UNAVAILABLE',
        'TLS_NEGOTIATION_FAILED',
        'SERVER_UNREACHABLE',
        'AUTH_FAILED',
        'INVALID_ENDPOINT',
        'INVALID_DOMAIN',
        'INVALID_DNS_RESPONSE',
        'SERVICE_UNAVAILABLE',
        'DNS_TIMEOUT',
        'INVALID_INPUT',
        'TRANSPORT_FAILED',
      ]);
      const diagnosticCode = [error?.condition, error?.code, error?.message].find(
        (value) => typeof value === 'string' && diagnosticCodes.has(value),
      );
      console.error('[XMPP-CONNECT-FAILED]', {
        transport: input?.endpoint?.transport,
        port: input?.endpoint?.port,
        phase: 'connect',
        // Never log arbitrary error messages: a third-party error must not be
        // able to place credentials or SASL material in application logs.
        code: diagnosticCode || 'UNCLASSIFIED',
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
    previewGrants?.clearAccount(accountId);
    stickerGrants?.clearAccount(accountId);
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
    if (!historySecurity.authorize(event.sender.id, accountId)) throw new Error('UNAUTHORIZED');
    if (!xmpp.sessions.has(accountId) || xmpp.states.get(accountId)?.status !== 'connected')
      throw new Error('NOT_CONNECTED');
    const conversationId = requireText(input.conversationId, 'CONVERSATION');
    const clientMessageId = requireText(input.clientMessageId, 'MESSAGE_ID');
    let replyTo;
    if (input.replyToMessageId !== undefined) {
      const replyTargetId = requireText(input.replyToMessageId, 'MESSAGE_ID');
      const target = persistence.getMessage(accountId, conversationId, replyTargetId);
      if (!target) throw new Error('UNSUPPORTED');
      const stable = target.originId || target.messageId || target.stanzaIds?.[0]?.id;
      if (!stable) throw new Error('UNSUPPORTED');
      replyTo = {
        ...(target.messageId ? { messageId: target.messageId } : {}),
        ...(target.originId ? { originId: target.originId } : {}),
        stanzaIds: target.stanzaIds || [],
        authorJid: target.senderJid,
        quote: target.body.text,
      };
    }
    if (
      input.body?.kind !== 'text' ||
      typeof input.body.text !== 'string' ||
      !input.body.text.trim()
    )
      throw new Error('INVALID_BODY');
    const sent = await xmpp.sendMessage(accountId, { ...input, to: conversationId, replyTo });
    const value = {
      ...sent,
      id: `msg_${crypto.randomUUID()}`,
      accountId,
      conversationId,
      clientMessageId,
      senderJid: accountId,
      status: 'sent',
      messageId: clientMessageId,
      originId: clientMessageId,
      ...(replyTo ? { replyTo } : {}),
    };
    persistence.saveMessage(value);
    return { ok: true, value, version: 1, requestId: requestId(event, input) };
  });
  ipcMain.handle('message.react', async (event, input) => {
    assertSender(event);
    try {
      if (!validVersion(input) || typeof input.accountId !== 'string' || typeof input.conversationId !== 'string' ||
        typeof input.targetMessageId !== 'string' || !Array.isArray(input.emojis) || input.emojis.length > 64 ||
        input.emojis.some((emoji) => typeof emoji !== 'string' || !emoji || emoji.length > 64 || !/\p{Extended_Pictographic}|\p{Regional_Indicator}|\uFE0F|\u20E3/u.test(emoji) || /[\u0000-\u001f\u007f]/u.test(emoji)))
        throw new Error('INVALID_INPUT');
      if (!historySecurity.authorize(event.sender.id, input.accountId)) throw new Error('UNAUTHORIZED');
      const { persistence, xmpp } = getRuntime();
      if (!xmpp.sessions.has(input.accountId) || xmpp.states.get(input.accountId)?.status !== 'connected') throw new Error('NOT_CONNECTED');
      const target = persistence.getMessage(input.accountId, input.conversationId, input.targetMessageId);
      if (!target) throw new Error('UNSUPPORTED');
      const reference = {
        ...(target.messageId ? { messageId: target.messageId } : {}),
        ...(target.originId ? { originId: target.originId } : {}),
        stanzaIds: target.stanzaIds || [],
        authorJid: target.senderJid,
      };
      if (!(reference.originId || reference.messageId || reference.stanzaIds.length)) throw new Error('UNSUPPORTED');
      await xmpp.sendReaction(input.accountId, {
        to: input.conversationId,
        targetMessageId: input.targetMessageId,
        target: reference,
        emojis: [...new Set(input.emojis)],
        clientMessageId: `reaction_${crypto.randomUUID()}`,
      });
      xmpp.applyReaction({
        accountId: input.accountId,
        conversationId: input.conversationId,
        target: { ...reference, messageId: reference.originId || reference.messageId },
        emojis: [...new Set(input.emojis)],
        actorJid: input.accountId,
        source: 'direct',
      });
      return { ok: true, value: undefined, version: 1, requestId: requestId(event, input) };
    } catch (error) {
      return reactionError(error, event, input);
    }
  });
  ipcMain.handle('chatState.send', async (event, input) => {
    assertSender(event);
    if (
      !validVersion(input) ||
      typeof input.accountId !== 'string' ||
      !input.accountId.trim() ||
      typeof input.conversationId !== 'string' ||
      !input.conversationId.trim() ||
      !['active', 'composing', 'paused', 'inactive', 'gone'].includes(input.state)
    )
      throw new Error('INVALID_INPUT');
    const { xmpp } = getRuntime();
    if (!historySecurity.authorize(event.sender.id, input.accountId)) throw new Error('UNAUTHORIZED');
    if (!xmpp.sessions.has(input.accountId) || xmpp.states.get(input.accountId)?.status !== 'connected')
      throw new Error('NOT_CONNECTED');
    await xmpp.sendChatState(input.accountId, {
      to: input.conversationId,
      state: input.state,
    });
    return { ok: true, value: undefined, version: 1, requestId: requestId(event, input) };
  });
}

module.exports = { registerAccountHandlers };
