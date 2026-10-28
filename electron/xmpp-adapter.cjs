const { client, xml } = require('@xmpp/client');
const crypto = require('node:crypto');
const net = require('node:net');
const tls = require('node:tls');
const { EventEmitter } = require('node:events');
const { validateXmppTransport } = require('./security-policy.cjs');
const { CertificateVerificationFailure, assessCertificate } = require('./certificate-trust.cjs');
const STARTTLS_NS = 'urn:ietf:params:xml:ns:xmpp-tls';

function taggedError(code, message, phase, cause) {
  const error = new Error(message);
  error.code = code;
  error.phase = phase;
  if (cause) error.cause = cause;
  return error;
}

function tlsIdentityCheck(tlsOptions) {
  return (host, certificate) => {
    const identityError = tls.checkServerIdentity(host, certificate);
    if (identityError) return identityError;
    if (tlsOptions.expectedFingerprint && certificate.fingerprint256 !== tlsOptions.expectedFingerprint) return taggedError('CERTIFICATE_PIN_MISMATCH', 'The certificate fingerprint changed during TLS negotiation.', 'tls.verify');
    return undefined;
  };
}

function negotiateStartTls(host, port, domain) {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ host, port });
    let buffer = '';
    let stage = 'connect';
    let settled = false;
    const timer = setTimeout(() => finish(taggedError('SERVER_UNREACHABLE', 'STARTTLS connection timed out.', 'starttls.connect')), 10000);
    const cleanup = () => { clearTimeout(timer); socket.removeListener('connect', onConnect); socket.removeListener('data', onData); socket.removeListener('error', onError); socket.removeListener('close', onClose); };
    const finish = (error) => { if (settled) return; settled = true; cleanup(); if (error) { socket.destroy(); reject(error); } else resolve(socket); };
    const onConnect = () => { stage = 'features'; socket.write(`<?xml version='1.0'?><stream:stream to='${domain.replaceAll('&', '&amp;').replaceAll("'", '&apos;')}' xmlns='jabber:client' xmlns:stream='http://etherx.jabber.org/streams' version='1.0'>`); };
    const onData = (data) => {
      buffer += data.toString('utf8');
      if (stage === 'features') {
        const start = buffer.indexOf('<stream:features');
        const close = start >= 0 ? buffer.indexOf('</stream:features>', start) : -1;
        if (start < 0 || close < 0) return;
        const features = buffer.slice(start, close + '</stream:features>'.length);
        if (!features.includes(`xmlns='${STARTTLS_NS}'`) && !features.includes(`xmlns="${STARTTLS_NS}"`)) return finish(taggedError('STARTTLS_UNAVAILABLE', 'The server did not advertise STARTTLS.', 'starttls.features'));
        stage = 'proceed';
        socket.write(`<starttls xmlns='${STARTTLS_NS}'/>`);
      } else if (stage === 'proceed') {
        if (buffer.includes(`<proceed xmlns='${STARTTLS_NS}'`) || buffer.includes(`<proceed xmlns="${STARTTLS_NS}"`)) finish();
        else if (buffer.includes('<failure')) finish(taggedError('TLS_NEGOTIATION_FAILED', 'The server rejected STARTTLS negotiation.', 'starttls.proceed'));
      }
    };
    const onError = (error) => finish(taggedError(['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET'].includes(error.code) ? 'SERVER_UNREACHABLE' : 'TLS_NEGOTIATION_FAILED', error.message, `starttls.${stage}`, error));
    const onClose = () => { if (!settled) finish(taggedError('TLS_NEGOTIATION_FAILED', 'The server closed the STARTTLS negotiation.', `starttls.${stage}`)); };
    socket.on('connect', onConnect); socket.on('data', onData); socket.once('error', onError); socket.once('close', onClose);
  });
}

function upgradeStartTls(rawSocket, host, tlsOptions) {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({ socket: rawSocket, host, servername: host, ...tlsOptions, rejectUnauthorized: tlsOptions.rejectUnauthorized !== false, checkServerIdentity: tlsOptions.checkServerIdentity || tlsIdentityCheck(tlsOptions) });
    const timer = setTimeout(() => { secureSocket.destroy(); reject(taggedError('TLS_NEGOTIATION_FAILED', 'STARTTLS TLS handshake timed out.', 'tls.handshake')); }, 10000);
    secureSocket.once('secureConnect', () => { clearTimeout(timer); resolve(secureSocket); });
    secureSocket.once('error', (error) => { clearTimeout(timer); reject(taggedError(error.code === 'CERTIFICATE_PIN_MISMATCH' ? 'CERTIFICATE_PIN_MISMATCH' : 'TLS_NEGOTIATION_FAILED', error.message, 'tls.handshake', error)); });
  });
}

function startTlsSocket(tlsOptions, domain) {
  return class StartTlsSocket extends EventEmitter {
    constructor() { super(); this.socket = null; this.secure = true; }
    connect(parameters) { void negotiateStartTls(parameters.host, parameters.port, domain).then((rawSocket) => upgradeStartTls(rawSocket, parameters.host, tlsOptions)).then((secureSocket) => { this.socket = secureSocket; secureSocket.on('data', (data) => this.emit('data', data)); secureSocket.on('close', () => this.emit('close')); secureSocket.on('error', (error) => this.emit('error', error)); this.emit('connect'); }).catch((error) => this.emit('error', error)); }
    end() { this.socket?.end(); }
    write(data, callback) { return this.socket.write(data, callback); }
  };
}

function certificateSocket(tlsOptions) {
  return class CertificateSocket extends EventEmitter {
    constructor() { super(); this.socket = null; this.secure = true; }
    connect(parameters) {
      this.socket = tls.connect({ ...parameters, ...tlsOptions, rejectUnauthorized: true, servername: parameters.host, checkServerIdentity: tlsIdentityCheck(tlsOptions) });
      this.socket.on('data', (data) => this.emit('data', data));
      this.socket.on('close', () => this.emit('close'));
      this.socket.on('error', (error) => this.emit('error', error));
      this.socket.on('secureConnect', () => this.emit('connect'));
    }
    end() { this.socket?.end(); }
    write(data, callback) { return this.socket.write(data, callback); }
  };
}

class XmppAdapter {
  constructor(packaged = false, trustStore = null) { this.packaged = packaged; this.trustStore = trustStore; this.sessions = new Map(); this.states = new Map(); this.listeners = new Set(); this.connecting = new Map(); this.pendingDecisions = new Map(); this.activeDecisionBySender = new Map(); this.rosters = new Map(); this.remoteResources = new Map(); this.initialPresencePublished = new Set(); }
  onEvent(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  async connect(input, password, senderId) {
    const current = this.connecting.get(input.accountId);
    if (current) return current;
    if (this.sessions.has(input.accountId)) await this.disconnect(input.accountId);
    const operation = this.connectInternal(input, password, senderId);
    this.connecting.set(input.accountId, operation);
    try { return await operation; } finally { if (this.connecting.get(input.accountId) === operation) this.connecting.delete(input.accountId); }
  }

  async connectInternal(input, password, senderId) {
    if (!password) throw new Error('secret_unavailable');
    const transport = validateXmppTransport(input.endpoint, this.packaged);
    this.states.set(input.accountId, { accountId: input.accountId, status: 'connecting', retryable: true, since: new Date().toISOString() });
    const tlsOptions = await this.resolveTlsOptions(input, senderId, transport);
    const service = `${transport.transport === 'direct-tls' ? 'xmpps' : 'xmpp'}://${transport.host}:${transport.port}`;
    const session = client({
      service,
      domain: input.endpoint.domain || process.env.ATOMIC_XMPP_DOMAIN || transport.host,
      username: input.accountId.split('@')[0],
      password,
    });
    if (transport.transport === 'direct-tls') this.installTlsTransport(session, service, tlsOptions);
    else this.installStartTlsTransport(session, service, tlsOptions, input.endpoint.domain || process.env.ATOMIC_XMPP_DOMAIN || transport.host);
    this.states.set(input.accountId, { accountId: input.accountId, status: 'authenticating', retryable: true, since: new Date().toISOString() });
    session.on('error', (error) => { this.handleSessionEvent(input.accountId, session, 'error', error.code || 'TRANSPORT_FAILED'); });
    session.on('offline', () => { this.handleSessionEvent(input.accountId, session, 'offline'); });
    session.on('online', () => { this.handleSessionEvent(input.accountId, session, 'online'); });
    session.on('stanza', (stanza) => this.handleStanza(input.accountId, stanza));
    try { await session.start(); } catch (error) { this.setState(input.accountId, 'failed', true, error.code || 'TRANSPORT_FAILED'); throw error; }
    this.remoteResources.set(input.accountId, new Map()); this.initialPresencePublished.delete(input.accountId); this.sessions.set(input.accountId, session);
    const state = { accountId: input.accountId, status: 'connected', retryable: false, since: new Date().toISOString() }; this.states.set(input.accountId, state); return state;
  }

  async disconnect(accountId) {
    this.cancelPendingDecision(accountId);
    const session = this.sessions.get(accountId);
    this.states.set(accountId, { accountId, status: 'disconnecting', retryable: false, since: new Date().toISOString() });
    if (session) await session.stop();
    this.sessions.delete(accountId);
    this.rosters.delete(accountId); this.remoteResources.delete(accountId); this.initialPresencePublished.delete(accountId);
    this.states.set(accountId, { accountId, status: 'idle', retryable: false, since: new Date().toISOString() });
  }

  installTlsTransport(session, service, tlsOptions) {
    session.transports = session.transports.map((Transport) => {
      let directTls = false;
      try { directTls = service.startsWith('xmpps:') && Transport.prototype.socketParameters(service) !== undefined; } catch { directTls = false; }
      if (!directTls) return Transport;
      class SessionTlsTransport extends Transport {}
      SessionTlsTransport.prototype.Socket = certificateSocket(tlsOptions);
      return SessionTlsTransport;
    });
  }

  installStartTlsTransport(session, service, tlsOptions, domain) {
    session.transports = session.transports.map((Transport) => {
      let tcp = false;
      try { tcp = service.startsWith('xmpp:') && Transport.prototype.socketParameters(service) !== undefined; } catch { tcp = false; }
      if (!tcp) return Transport;
      class SessionStartTlsTransport extends Transport {}
      SessionStartTlsTransport.prototype.Socket = startTlsSocket(tlsOptions, domain);
      return SessionStartTlsTransport;
    });
  }

  async probeDirectCertificate(endpoint) {
    return new Promise((resolve, reject) => {
      const socket = tls.connect({ host: endpoint.host, port: endpoint.port, servername: endpoint.host, rejectUnauthorized: false });
      const timer = setTimeout(() => { socket.destroy(); reject(new Error('CERTIFICATE_PROBE_TIMEOUT')); }, 10000);
      const finish = (callback) => { clearTimeout(timer); socket.removeListener('secureConnect', onSecureConnect); socket.removeListener('error', onError); callback(); };
      const onSecureConnect = () => {
        try {
          const certificate = socket.getPeerCertificate(true);
          const authorizationError = socket.authorizationError;
          finish(() => { socket.destroy(); resolve({ certificate, authorizationError, authorized: socket.authorized }); });
        } catch (error) { finish(() => { socket.destroy(); reject(error); }); }
      };
      const onError = (error) => finish(() => { socket.destroy(); reject(error); });
      socket.once('secureConnect', onSecureConnect);
      socket.once('error', onError);
    });
  }

  async probeStartTlsCertificate(endpoint, domain) {
    const rawSocket = await negotiateStartTls(endpoint.host, endpoint.port, domain);
    const secureSocket = await upgradeStartTls(rawSocket, endpoint.host, { rejectUnauthorized: false, checkServerIdentity: tls.checkServerIdentity });
    try { return { certificate: secureSocket.getPeerCertificate(true), authorizationError: secureSocket.authorizationError, authorized: secureSocket.authorized }; } finally { secureSocket.destroy(); }
  }

  async resolveTlsOptions(input, senderId, transport) {
    const endpoint = input.endpoint;
    const transportName = transport.transport;
    let previous = null;
    try { previous = this.trustStore?.getTrustedCertificate(input.accountId, endpoint.host, endpoint.port, transportName) || null; } catch { throw new Error('certificate_storage_unavailable'); }
    const probe = transportName === 'direct-tls' ? await this.probeDirectCertificate(endpoint) : await this.probeStartTlsCertificate(endpoint, endpoint.domain || process.env.ATOMIC_XMPP_DOMAIN || endpoint.host);
    const assessment = assessCertificate(endpoint.host, probe.certificate, probe.authorized, probe.authorizationError);
    if (assessment.error && !assessment.trustable) throw new CertificateVerificationFailure('CERTIFICATE_INVALID', assessment.error.message, assessment.info, assessment.error);
    const changed = previous && previous.fingerprintSha256 !== assessment.info.fingerprintSha256;
    if (previous && !changed) return { ca: previous.certificatePem, expectedFingerprint: previous.fingerprintSha256 };
    if (changed || assessment.trustable) {
      const decision = await this.awaitTrustDecision(input, transportName, assessment.info, assessment.error, changed ? previous : null, senderId);
      if (decision === 'cancel') throw new CertificateVerificationFailure('CERTIFICATE_REJECTED', 'La conexión fue cancelada porque no se aceptó el certificado.', assessment.info);
      if (decision === 'trust_and_remember') {
        if (!this.trustStore) throw new Error('certificate_storage_unavailable');
        try { this.trustStore.upsertTrustedCertificate({ accountId: input.accountId, host: endpoint.host, port: endpoint.port, transport: transportName, fingerprintSha256: assessment.info.fingerprintSha256, certificatePem: assessment.info.pem, approvedAt: new Date().toISOString() }); } catch { throw new Error('certificate_storage_unavailable'); }
      }
      return { ca: assessment.error ? assessment.info.pem : undefined, expectedFingerprint: assessment.info.fingerprintSha256 };
    }
    return {};
  }

  awaitTrustDecision(input, transport, certificate, verificationError, previous, senderId) {
    return new Promise((resolve) => {
      const previousRequestId = this.activeDecisionBySender.get(senderId);
      if (previousRequestId) { const previousDecision = this.pendingDecisions.get(previousRequestId); this.pendingDecisions.delete(previousRequestId); previousDecision?.resolve('cancel'); }
      const timeout = setTimeout(() => { if (this.pendingDecisions.has(input.requestId)) { this.pendingDecisions.delete(input.requestId); if (this.activeDecisionBySender.get(senderId) === input.requestId) this.activeDecisionBySender.delete(senderId); resolve('cancel'); } }, 300000);
      this.pendingDecisions.set(input.requestId, { accountId: input.accountId, senderId, fingerprintSha256: certificate.fingerprintSha256, resolve: (decision) => { clearTimeout(timeout); resolve(decision); } });
      this.activeDecisionBySender.set(senderId, input.requestId);
      this.emit({ targetSenderId: senderId, type: 'certificate.trustRequired', payload: { requestId: input.requestId, accountId: input.accountId, host: input.endpoint.host, port: input.endpoint.port, transport, certificate, ...(verificationError ? { verificationError } : {}), ...(previous ? { previous } : {}) } });
    });
  }

  decideCertificateTrust(senderId, input) {
    const pending = this.pendingDecisions.get(input.requestId);
    if (!pending || pending.senderId !== senderId || pending.accountId !== input.accountId || pending.fingerprintSha256 !== input.fingerprintSha256) throw new Error('CERTIFICATE_DECISION_CONFLICT');
    if (!['cancel', 'trust_once', 'trust_and_remember'].includes(input.decision)) throw new Error('INVALID_INPUT');
    this.pendingDecisions.delete(input.requestId);
    if (this.activeDecisionBySender.get(senderId) === input.requestId) this.activeDecisionBySender.delete(senderId);
    pending.resolve(input.decision);
  }

  cancelPendingDecision(accountId) {
    for (const [requestId, pending] of this.pendingDecisions) if (pending.accountId === accountId) { this.pendingDecisions.delete(requestId); if (this.activeDecisionBySender.get(pending.senderId) === requestId) this.activeDecisionBySender.delete(pending.senderId); pending.resolve('cancel'); }
  }

  async setPresence(accountId, presence) {
    const session = this.require(accountId);
    const show = presence.mode ? xml('show', {}, presence.mode) : undefined;
    const status = presence.status ? xml('status', {}, presence.status) : undefined;
    await session.send(xml('presence', { type: presence.availability === 'unavailable' ? 'unavailable' : undefined }, show, status));
    return { jid: accountId, ...presence, updatedAt: new Date().toISOString() };
  }

  async listRoster(accountId) {
    const session = this.require(accountId);
    const result = await session.iqCaller.request(xml('iq', { type: 'get' }, xml('query', { xmlns: 'jabber:iq:roster' })));
    const contacts = result.getChild('query', 'jabber:iq:roster')?.getChildren('item').map((item) => ({ jid: this.bareJid(item.attrs.jid), name: item.attrs.name, groups: item.getChildren('group').map((group) => group.getText()), subscription: ['none', 'to', 'from', 'both'].includes(item.attrs.subscription) ? item.attrs.subscription : 'none', ...(item.attrs.ask === 'subscribe' ? { ask: 'subscribe' } : {}), source: 'roster' })) || [];
    const normalized = [...new Map(contacts.map((contact) => [contact.jid.toLowerCase(), contact])).values()]; this.rosters.set(accountId, new Map(normalized.map((contact) => [contact.jid, contact]))); const resources = this.remoteResources.get(accountId) || new Map(); for (const key of resources.keys()) if (!this.rosters.get(accountId).has(key.split('/')[0]) || !['to', 'both'].includes(this.rosters.get(accountId).get(key.split('/')[0]).subscription)) resources.delete(key); this.remoteResources.set(accountId, resources); if (!this.initialPresencePublished.has(accountId)) { await session.send(xml('presence')); this.initialPresencePublished.add(accountId); } return normalized;
  }

  async sendMessage(accountId, input) {
    if (this.states.get(accountId)?.status !== 'connected') throw new Error('not_connected');
    const session = this.require(accountId);
    await session.send(xml('message', { type: 'chat', to: input.to }, xml('body', {}, input.body.text)));
    return { ...input, status: 'sent', createdAt: new Date().toISOString() };
  }

  handleStanza(accountId, stanza) {
    if (process.env.ATOMIC_XMPP_DEBUG === 'true') console.debug('[XMPP_STANZA]', JSON.stringify({ accountId, from: stanza.attrs?.from || '', to: stanza.attrs?.to || '', type: stanza.name || stanza.attrs?.type || '', id: stanza.attrs?.id || '', hasBody: Boolean(stanza.getChildText?.('body')) }));
    if (stanza.is('presence')) {
      const type = stanza.attrs.type; if (['subscribe', 'subscribed', 'unsubscribe', 'unsubscribed', 'error', 'probe'].includes(type)) return;
      const jid = this.bareJid(stanza.attrs.from || accountId); const contact = this.rosters.get(accountId)?.get(jid); if (!contact || !['to', 'both'].includes(contact.subscription)) return;
      const resource = String(stanza.attrs.from || '').split('/')[1] || '_bare'; const resources = this.remoteResources.get(accountId) || new Map(); if (type === 'unavailable') resources.delete(jid + '/' + resource); else resources.set(jid + '/' + resource, { mode: stanza.getChildText('show') || undefined, status: stanza.getChildText('status') || undefined }); this.remoteResources.set(accountId, resources);
      const active = [...resources.entries()].filter(([key]) => key.startsWith(`${jid}/`)); const latest = active[active.length - 1]?.[1]; this.emit({ type: 'presence.changed', payload: { accountId, jid, availability: active.length ? 'available' : 'unavailable', mode: latest?.mode, status: latest?.status, updatedAt: new Date().toISOString() } });
    }
    if (stanza.is('message') && stanza.getChildText('body')) {
      const senderJid = this.bareJid(stanza.attrs.from || accountId);
      const bodyText = stanza.getChildText('body');
      const explicitId = stanza.attrs.id || stanza.getChild('origin-id')?.attrs?.id;
      const identity = `${accountId}|${senderJid}|${explicitId || crypto.randomUUID()}`;
      const stanzaId = explicitId ? `received_${crypto.createHash('sha256').update(identity).digest('hex')}` : `received_${crypto.randomUUID()}`;
      this.emit({ type: 'message.received', payload: { id: `msg_${stanzaId}`, accountId, conversationId: senderJid, clientMessageId: `received_${stanzaId}`, senderJid, body: { kind: 'text', text: bodyText }, status: 'sent', createdAt: new Date().toISOString() } });
      if (process.env.ATOMIC_XMPP_DEBUG === 'true') console.debug('[XMPP_MESSAGE_RECEIVED]', JSON.stringify({ accountId, from: senderJid, id: stanzaId, hasBody: true }));
    }
  }

  bareJid(jid) { return String(jid).split('/')[0]; }

  emit(event) { this.listeners.forEach((listener) => listener(event)); }

  require(accountId) { const session = this.sessions.get(accountId); if (!session) throw new Error('not_connected'); return session; }
  setState(accountId, status, retryable, reason) { const state = { accountId, status, retryable, since: new Date().toISOString(), ...(reason ? { reason } : {}) }; this.states.set(accountId, state); this.emit({ type: 'connection.stateChanged', payload: state }); }
  handleSessionEvent(accountId, session, event, reason) { if (this.sessions.get(accountId) !== session) return false; if (event === 'offline') { this.sessions.delete(accountId); this.setState(accountId, 'failed', true, 'offline'); } else if (event === 'error') this.setState(accountId, 'failed', true, reason || 'TRANSPORT_FAILED'); else if (event === 'online') this.setState(accountId, 'connected', false); return true; }
}

module.exports = { XmppAdapter, negotiateStartTls };
