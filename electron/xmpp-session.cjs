const { client, xml } = require('@xmpp/client');
const { validateXmppTransport } = require('./security-policy.cjs');

function taggedError(code, message, phase) {
  const error = new Error(message);
  error.code = code;
  error.phase = phase;
  return error;
}

function createXmppSession(adapter) {
  return {
    async connect(input, password, senderId) {
      const current = adapter.connecting.get(input.accountId);
      if (current) return current;
      if (adapter.sessions.has(input.accountId)) await adapter.disconnect(input.accountId);
      const operation = adapter.connectInternal(input, password, senderId);
      adapter.connecting.set(input.accountId, operation);
      try {
        return await operation;
      } finally {
        if (adapter.connecting.get(input.accountId) === operation)
          adapter.connecting.delete(input.accountId);
      }
    },
    async connectInternal(input, password, senderId) {
      if (!password) throw new Error('secret_unavailable');
      const transport = validateXmppTransport(input.endpoint, adapter.packaged);
      adapter.states.set(input.accountId, {
        accountId: input.accountId,
        status: 'connecting',
        retryable: true,
        since: new Date().toISOString(),
      });
      const tlsOptions = await adapter.resolveTlsOptions(input, senderId, transport);
      const service = `${transport.transport === 'direct-tls' ? 'xmpps' : 'xmpp'}://${transport.host}:${transport.port}`;
      const session = client({
        service,
        domain: input.endpoint.domain || process.env.ATOMIC_XMPP_DOMAIN || transport.host,
        username: input.accountId.split('@')[0],
        password,
      });
      if (transport.transport === 'direct-tls')
        adapter.installTlsTransport(session, service, tlsOptions);
      else
        adapter.installStartTlsTransport(
          session,
          service,
          tlsOptions,
          input.endpoint.domain || process.env.ATOMIC_XMPP_DOMAIN || transport.host,
        );
      adapter.installFileIqHandlers(input.accountId, session);
      adapter.states.set(input.accountId, {
        accountId: input.accountId,
        status: 'authenticating',
        retryable: true,
        since: new Date().toISOString(),
      });
      session.on('error', (error) => {
        adapter.handleSessionEvent(
          input.accountId,
          session,
          'error',
          error.code || 'TRANSPORT_FAILED',
        );
      });
      session.on('offline', () => {
        adapter.handleSessionEvent(input.accountId, session, 'offline');
      });
      session.on('online', () => {
        adapter.handleSessionEvent(input.accountId, session, 'online');
      });
      adapter.fileOwners.set(input.accountId, senderId);
      session.on('element', (stanza) => {
        if (adapter.isFileIq(stanza)) adapter.fileIqHandled.add(stanza);
      });
      session.on('stanza', (stanza) => {
        if (adapter.sessions.get(input.accountId) !== session) return;
        adapter.handleStanza(input.accountId, stanza);
      });
      try {
        await session.start();
      } catch (error) {
        adapter.setState(input.accountId, 'failed', true, error.code || 'TRANSPORT_FAILED');
        throw error;
      }
      adapter.remoteResources.set(input.accountId, new Map());
      adapter.initialPresencePublished.delete(input.accountId);
      adapter.sessions.set(input.accountId, session);
      adapter.sessionDomains.set(
        input.accountId,
        input.endpoint.domain || process.env.ATOMIC_XMPP_DOMAIN || transport.host,
      );
      adapter.sessionEndpoints.set(input.accountId, {
        host: transport.host,
        port: transport.port,
        transport: transport.transport,
      });
      adapter.sessionGenerations.set(
        input.accountId,
        (adapter.sessionGenerations.get(input.accountId) || 0) + 1,
      );
      await session.send(xml('presence'));
      adapter.initialPresencePublished.add(input.accountId);
      const state = {
        accountId: input.accountId,
        status: 'connected',
        retryable: false,
        since: new Date().toISOString(),
      };
      adapter.states.set(input.accountId, state);
      return state;
    },
    async disconnect(accountId) {
      adapter.cancelPendingDecision(accountId);
      await adapter.fileTransfers?.cancelAccount(accountId).catch(() => undefined);
      await adapter.outgoingTransfers?.cancelAccount(accountId).catch(() => undefined);
      for (const [key] of adapter.filePending)
        if (key.startsWith(`${accountId}|`)) adapter.filePending.delete(key);
      adapter.clearMucRooms(accountId);
      const session = adapter.sessions.get(accountId);
      adapter.states.set(accountId, {
        accountId,
        status: 'disconnecting',
        retryable: false,
        since: new Date().toISOString(),
      });
      if (session) await session.stop();
      adapter.sessions.delete(accountId);
      adapter.rosters.delete(accountId);
      adapter.remoteResources.delete(accountId);
      adapter.initialPresencePublished.delete(accountId);
      adapter.sessionDomains.delete(accountId);
      adapter.sessionEndpoints.delete(accountId);
      adapter.sessionGenerations.set(
        accountId,
        (adapter.sessionGenerations.get(accountId) || 0) + 1,
      );
      adapter.states.set(accountId, {
        accountId,
        status: 'idle',
        retryable: false,
        since: new Date().toISOString(),
      });
    },
    require(accountId) {
      const session = adapter.sessions.get(accountId);
      if (!session) throw new Error('not_connected');
      return session;
    },
    requireConnected(accountId) {
      if (!adapter.sessions.has(accountId) || adapter.states.get(accountId)?.status !== 'connected')
        throw taggedError('NOT_CONNECTED', 'La cuenta no está conectada.', 'muc.session');
      return adapter.sessions.get(accountId);
    },
    bareJid(jid) {
      return String(jid).split('/')[0];
    },
    setState(accountId, status, retryable, reason) {
      const state = {
        accountId,
        status,
        retryable,
        since: new Date().toISOString(),
        ...(reason ? { reason } : {}),
      };
      adapter.states.set(accountId, state);
      adapter.emit({ type: 'connection.stateChanged', payload: state });
    },
    handleSessionEvent(accountId, session, event, reason) {
      if (adapter.sessions.get(accountId) !== session) return false;
      if (event === 'offline') {
        adapter.clearMucRooms(accountId);
        void adapter.fileTransfers?.cancelAccount(accountId).catch(() => undefined);
        void adapter.outgoingTransfers?.cancelAccount(accountId).catch(() => undefined);
        for (const [key] of adapter.filePending)
          if (key.startsWith(`${accountId}|`)) adapter.filePending.delete(key);
        adapter.sessions.delete(accountId);
        adapter.sessionGenerations.set(
          accountId,
          (adapter.sessionGenerations.get(accountId) || 0) + 1,
        );
        adapter.setState(accountId, 'failed', true, 'offline');
      } else if (event === 'error')
        adapter.setState(accountId, 'failed', true, reason || 'TRANSPORT_FAILED');
      else if (event === 'online') adapter.setState(accountId, 'connected', false);
      return true;
    },
  };
}

module.exports = { createXmppSession };
