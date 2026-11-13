const xmppClient = require('@xmpp/client');
const crypto = require('node:crypto');
const { loadDisplayName } = require('./xmpp-display-name.cjs');
const { validateXmppTransport } = require('../security/security-policy.cjs');
const { createXmppSessionCleanup } = require('./xmpp-session-cleanup.cjs');

/**
 * @typedef {{[key: string]: string | undefined}} XmlAttributes
 * @typedef {{attrs?: XmlAttributes, getChildren?: (name: string) => XmlStanza[], getChild: (name: string, namespace?: string) => XmlStanza | undefined, getChildText: (name: string, namespace?: string) => string | undefined}} XmlStanza
 * @typedef {{request: (stanza: unknown, timeoutMs?: number) => Promise<XmlStanza>}} IqCaller
 * @typedef {{iqCaller: IqCaller, transports: unknown[], on: (event: string, listener: (value?: unknown) => void) => void, start: () => Promise<void>, stop: () => Promise<void>, jid?: string}} XmppSession
 * @typedef {{accountId: string, requestId: string, endpoint: {host: string, port: number, tls: boolean, domain?: string, transport?: 'starttls' | 'direct-tls', allowInsecureTls?: boolean}}} ConnectionInput
 * @typedef {{accountId: string, status: string, retryable: boolean, since: string, reason?: string, displayName?: string}} SessionState
 * @typedef {{packaged: boolean, connecting: Map<string, Promise<SessionState>>, sessions: Map<string, XmppSession>, states: Map<string, SessionState>, rosters: Map<string, unknown>, filePending: Map<string, {record: {offer: {transferId: string}}}>, resolveTlsOptions: (input: ConnectionInput, senderId: number, transport: {transport: 'starttls' | 'direct-tls'}) => Promise<Record<string, unknown>>, installTlsTransport: (session: XmppSession, service: string, tlsOptions: Record<string, unknown>, domain: string) => void, installStartTlsTransport: (session: XmppSession, service: string, tlsOptions: Record<string, unknown>, domain: string) => void, installFileIqHandlers: (accountId: string, session: XmppSession) => void, handleSessionEvent: (accountId: string, session: XmppSession, event: string, reason?: string) => boolean, setState: (accountId: string, status: string, retryable: boolean, reason?: string) => void, fileOwners: Map<string, number>, fileIqHandled: WeakSet<object>, isFileIq: (stanza: XmlStanza) => boolean, handleStanza: (accountId: string, stanza: XmlStanza) => void, remoteResources: Map<string, Map<string, unknown>>, pendingPresences: Map<string, Map<string, unknown>>, initialPresencePublished: Set<string>, publishedPresences: Map<string, unknown>, sessionJids: Map<string, string>, sessionDomains: Map<string, string>, sessionEndpoints: Map<string, unknown>, sessionGenerations: Map<string, number>, fileTransfers?: {cancelAccount: (accountId: string) => Promise<unknown>}, outgoingTransfers?: {cancelAccount: (accountId: string) => Promise<unknown>}, clearMucRooms: (accountId: string) => void, cancelPendingDecision: (accountId: string) => void, disconnect: (accountId: string) => Promise<void>, connectInternal: (input: ConnectionInput, password: string, senderId: number) => Promise<SessionState>, carbons: {clear: (accountId: string) => void, negotiate: (accountId: string, session: XmppSession, domain: string, generation: number | undefined) => Promise<unknown>}, discoverMessageCapabilities: (accountId: string, session: XmppSession, domain: string, generation: number | undefined) => Promise<unknown>, emit: (event: unknown) => void}} SessionAdapter */

const client = /** @type {(options: Record<string, unknown>) => XmppSession} */ (xmppClient.client);

/** @returns {string} */
function createXmppResource() {
  return `atomic-${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * @param {string} code
 * @param {string} message
 * @param {string} phase
 * @returns {Error & {code: string, phase: string}}
 */
function taggedError(code, message, phase) {
  const error = new Error(message);
  return Object.assign(error, { code, phase });
}

/** @param {SessionAdapter} adapter */
function createXmppSession(adapter) {
  const sessionCleanup = createXmppSessionCleanup(adapter);
  return {
    /** @param {ConnectionInput} input @param {string} password @param {number} senderId */
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
    /** @param {ConnectionInput} input @param {string} password @param {number} senderId */
    async connectInternal(input, password, senderId) {
      if (!password) throw new Error('secret_unavailable');
      const transport =
        /** @type {{host: string, port: number, transport: 'starttls' | 'direct-tls'}} */ (
          validateXmppTransport(input.endpoint, adapter.packaged)
        );
      adapter.states.set(input.accountId, {
        accountId: input.accountId,
        status: 'connecting',
        retryable: true,
        since: new Date().toISOString(),
      });
      const tlsOptions = await adapter.resolveTlsOptions(input, senderId, transport);
      const service = `${transport.transport === 'direct-tls' ? 'xmpps' : 'xmpp'}://${transport.host}:${transport.port}`;
      const domain = String(
        input.endpoint.domain || process.env['ATOMIC_XMPP_DOMAIN'] || transport.host,
      );
      const session = client({
        service,
        domain,
        username: input.accountId.split('@')[0],
        password,
        // A new resource is generated for every binding/reconnect, so a server-side
        // conflict does not reuse Spark's resource or create an infinite retry loop here.
        resource: createXmppResource,
      });
      if (transport.transport === 'direct-tls')
        adapter.installTlsTransport(session, service, tlsOptions, domain);
      else adapter.installStartTlsTransport(session, service, tlsOptions, domain);
      adapter.installFileIqHandlers(input.accountId, session);
      adapter.states.set(input.accountId, {
        accountId: input.accountId,
        status: 'authenticating',
        retryable: true,
        since: new Date().toISOString(),
      });
      session.on('error', (error) => {
        const code =
          error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
            ? error.code
            : 'TRANSPORT_FAILED';
        adapter.handleSessionEvent(input.accountId, session, 'error', code);
      });
      session.on('offline', () => {
        adapter.handleSessionEvent(input.accountId, session, 'offline');
      });
      session.on('online', (address) => {
        if (address) adapter.sessionJids.set(input.accountId, String(address));
        adapter.handleSessionEvent(input.accountId, session, 'online');
      });
      adapter.fileOwners.set(input.accountId, senderId);
      session.on('element', (stanza) => {
        const typedStanza = /** @type {XmlStanza} */ (stanza);
        if (adapter.isFileIq(typedStanza)) adapter.fileIqHandled.add(typedStanza);
      });
      session.on('stanza', (stanza) => {
        if (adapter.sessions.get(input.accountId) !== session) return;
        adapter.handleStanza(input.accountId, /** @type {XmlStanza} */ (stanza));
      });
      try {
        await session.start();
      } catch (error) {
        const code =
          error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
            ? error.code
            : 'TRANSPORT_FAILED';
        adapter.setState(input.accountId, 'failed', true, code);
        throw error;
      }
      adapter.remoteResources.set(input.accountId, new Map());
      adapter.pendingPresences.set(input.accountId, new Map());
      adapter.initialPresencePublished.delete(input.accountId);
      adapter.publishedPresences.delete(input.accountId);
      adapter.sessions.set(input.accountId, session);
      adapter.sessionDomains.set(input.accountId, domain);
      if (session.jid) adapter.sessionJids.set(input.accountId, String(session.jid));
      adapter.sessionEndpoints.set(input.accountId, {
        host: transport.host,
        port: transport.port,
        transport: transport.transport,
      });
      adapter.sessionGenerations.set(
        input.accountId,
        (adapter.sessionGenerations.get(input.accountId) || 0) + 1,
      );
      const state = {
        accountId: input.accountId,
        status: 'connected',
        retryable: false,
        since: new Date().toISOString(),
      };
      adapter.states.set(input.accountId, state);
      void loadDisplayName(adapter, input.accountId, session);
      void adapter.carbons
        .negotiate(
          input.accountId,
          session,
          domain,
          adapter.sessionGenerations.get(input.accountId),
        )
        .catch(() => undefined);
      void adapter
        .discoverMessageCapabilities(
          input.accountId,
          session,
          domain,
          adapter.sessionGenerations.get(input.accountId),
        )
        .catch(() => undefined);
      return state;
    },
    /** @param {string} accountId */
    async disconnect(accountId) {
      adapter.cancelPendingDecision(accountId);
      const session = adapter.sessions.get(accountId);
      adapter.states.set(accountId, {
        accountId,
        status: 'disconnecting',
        retryable: false,
        since: new Date().toISOString(),
      });
      await Promise.all([
        adapter.fileTransfers?.cancelAccount(accountId).catch(() => undefined),
        adapter.outgoingTransfers?.cancelAccount(accountId).catch(() => undefined),
      ]);
      for (const [key] of adapter.filePending)
        if (key.startsWith(`${accountId}|`)) adapter.filePending.delete(key);
      adapter.clearMucRooms(accountId);
      if (session) await session.stop();
      sessionCleanup.clear(accountId);
      adapter.states.set(accountId, {
        accountId,
        status: 'idle',
        retryable: false,
        since: new Date().toISOString(),
      });
    },
    /** @param {string} accountId @returns {XmppSession} */
    require(accountId) {
      const session = adapter.sessions.get(accountId);
      if (!session) throw new Error('not_connected');
      return session;
    },
    /** @param {string} accountId @returns {XmppSession} */
    requireConnected(accountId) {
      if (!adapter.sessions.has(accountId) || adapter.states.get(accountId)?.status !== 'connected')
        throw taggedError('NOT_CONNECTED', 'La cuenta no está conectada.', 'muc.session');
      const session = adapter.sessions.get(accountId);
      if (!session)
        throw taggedError('NOT_CONNECTED', 'La cuenta no está conectada.', 'muc.session');
      return session;
    },
    /** @param {string} jid @returns {string} */
    bareJid(jid) {
      return String(jid).split('/')[0];
    },
    /** @param {string} accountId @param {string} status @param {boolean} retryable @param {string | undefined} reason */
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
    /** @param {string} accountId @param {XmppSession} session @param {'offline' | 'error' | 'online'} event @param {string | undefined} reason */
    handleSessionEvent(accountId, session, event, reason) {
      if (adapter.sessions.get(accountId) !== session) return false;
      if (event === 'offline') {
        adapter.clearMucRooms(accountId);
        void adapter.fileTransfers?.cancelAccount(accountId).catch(() => undefined);
        void adapter.outgoingTransfers?.cancelAccount(accountId).catch(() => undefined);
        for (const [key] of adapter.filePending)
          if (key.startsWith(`${accountId}|`)) adapter.filePending.delete(key);
        sessionCleanup.clear(accountId);
        adapter.setState(accountId, 'failed', true, 'offline');
      } else if (event === 'error')
        adapter.setState(accountId, 'failed', true, reason || 'TRANSPORT_FAILED');
      else if (event === 'online') adapter.setState(accountId, 'connected', false);
      return true;
    },
  };
}

module.exports = { createXmppResource, createXmppSession };
