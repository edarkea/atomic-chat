const { client, xml } = require('@xmpp/client');
const crypto = require('node:crypto');
const net = require('node:net');
const tls = require('node:tls');
const { EventEmitter } = require('node:events');
const { validateXmppTransport } = require('./security-policy.cjs');
const { CertificateVerificationFailure, assessCertificate } = require('./certificate-trust.cjs');
const { parseOffer, IBB_NS, SI_NS, SI_FILE_NS, FEATURE_NEG_NS, DATAFORM_NS, validateOpen, validateData } = require('./file-protocol.cjs');
const STARTTLS_NS = 'urn:ietf:params:xml:ns:xmpp-tls';
const DISCO_ITEMS_NS = 'http://jabber.org/protocol/disco#items';
const DISCO_INFO_NS = 'http://jabber.org/protocol/disco#info';
const MUC_NS = 'http://jabber.org/protocol/muc';
const MUC_USER_NS = 'http://jabber.org/protocol/muc#user';
const DELAY_NS = 'urn:xmpp:delay';
const LEGACY_DELAY_NS = 'jabber:x:delay';
const MUC_TEXT_LIMIT_BYTES = 4096;
const MUC_MESSAGE_BUFFER_LIMIT = 200;
const MUC_ROOM_LIMIT = 5;

function fileTrace(phase, direction, details = {}) {
  if (process.env.ATOMIC_XMPP_FILE_TRACE !== 'true') return;
  const allowed = new Set(['phase', 'direction', 'at', 'iqType', 'condition', 'result', 'errorCode', 'blockSize', 'seq', 'bytes', 'correlation']);
  const safe = { phase, direction, at: new Date().toISOString() };
  for (const [key, value] of Object.entries(details)) if (allowed.has(key)) safe[key] = value;
  console.info('[XMPP_FILE_TRACE]', JSON.stringify(safe));
}

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
  constructor(packaged = false, trustStore = null, mucPolicies = [], fileTransfers = null) { this.packaged = packaged; this.trustStore = trustStore; this.fileTransfers = fileTransfers; this.sessions = new Map(); this.states = new Map(); this.listeners = new Set(); this.connecting = new Map(); this.pendingDecisions = new Map(); this.activeDecisionBySender = new Map(); this.rosters = new Map(); this.remoteResources = new Map(); this.initialPresencePublished = new Set(); this.sessionGenerations = new Map(); this.sessionDomains = new Map(); this.sessionEndpoints = new Map(); this.mucDiscoveries = new Map(); this.mucRooms = new Map(); this.filePending = new Map(); this.fileOwners = new Map(); this.fileTraceAttempts = new WeakMap(); this.mucPolicies = new Map(); if (this.fileTransfers) this.fileTransfers.onEvent((event) => { if (!event.type.endsWith('stateChanged')) return; const transferId = event.payload?.offer?.transferId; if (!transferId || !['completed', 'failed', 'cancelled'].includes(event.payload?.state)) return; for (const [key, pending] of this.filePending) if (pending.record.offer.transferId === transferId) this.filePending.delete(key); }); mucPolicies.forEach((policy) => this.setMucPolicy(policy)); }
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
    this.fileOwners.set(input.accountId, senderId);
    session.on('stanza', (stanza) => { if (this.sessions.get(input.accountId) !== session) return; this.handleStanza(input.accountId, stanza); });
    try { await session.start(); } catch (error) { this.setState(input.accountId, 'failed', true, error.code || 'TRANSPORT_FAILED'); throw error; }
    this.remoteResources.set(input.accountId, new Map()); this.initialPresencePublished.delete(input.accountId); this.sessions.set(input.accountId, session); this.sessionDomains.set(input.accountId, input.endpoint.domain || process.env.ATOMIC_XMPP_DOMAIN || transport.host); this.sessionEndpoints.set(input.accountId, { host: transport.host, port: transport.port, transport: transport.transport }); this.sessionGenerations.set(input.accountId, (this.sessionGenerations.get(input.accountId) || 0) + 1); await session.send(xml('presence')); this.initialPresencePublished.add(input.accountId);
    const state = { accountId: input.accountId, status: 'connected', retryable: false, since: new Date().toISOString() }; this.states.set(input.accountId, state); return state;
  }

  async disconnect(accountId) {
    this.cancelPendingDecision(accountId);
    await this.fileTransfers?.cancelAccount(accountId).catch(() => undefined);
    for (const [key, pending] of this.filePending) if (key.startsWith(`${accountId}|`)) this.filePending.delete(key);
    this.clearMucRooms(accountId);
    const session = this.sessions.get(accountId);
    this.states.set(accountId, { accountId, status: 'disconnecting', retryable: false, since: new Date().toISOString() });
    if (session) await session.stop();
    this.sessions.delete(accountId);
    this.rosters.delete(accountId); this.remoteResources.delete(accountId); this.initialPresencePublished.delete(accountId); this.sessionDomains.delete(accountId); this.sessionEndpoints.delete(accountId); this.sessionGenerations.set(accountId, (this.sessionGenerations.get(accountId) || 0) + 1);
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

  setMucPolicy(policy) {
    if (!policy || typeof policy.accountId !== 'string' || typeof policy.service !== 'string' || policy.canCreate !== false || policy.source !== 'operator' || typeof policy.evidence !== 'string' || !policy.evidence.trim() || !policy.endpoint || typeof policy.endpoint.host !== 'string' || !policy.endpoint.host.trim() || !Number.isInteger(policy.endpoint.port) || !['starttls', 'direct-tls'].includes(policy.endpoint.transport)) return false;
    this.mucPolicies.set(this.mucPolicyKey(policy.accountId, policy.service, policy.endpoint), { ...policy, endpoint: { ...policy.endpoint } }); return true;
  }

  async discoverMuc(input) {
    this.assertMucRequest(input); const session = this.requireConnected(input.accountId); const generation = this.sessionGenerations.get(input.accountId) || 0; const domain = this.sessionDomains.get(input.accountId) || ''; const request = this.withTimeout(this.discoverServices(session, input.accountId, () => this.assertSessionCurrent(input.accountId, session, generation, domain)), 10000, 'TIMEOUT', 'El descubrimiento MUC excedió el tiempo límite.');
    const rooms = await request; this.assertSessionCurrent(input.accountId, session, generation, domain); const accreditedRooms = rooms.map((room) => ({ ...room, discoveryGeneration: generation, discoveryDomain: domain, discoveryEndpoint: this.sessionEndpoints.get(input.accountId) })); this.mucDiscoveries.set(input.accountId, new Map(accreditedRooms.map((room) => [room.jid.toLowerCase(), room]))); return accreditedRooms;
  }

  async discoverServices(session, accountId, guard = () => undefined) {
    const domain = this.sessionDomains.get(accountId) || process.env.ATOMIC_XMPP_DOMAIN || accountId.split('@')[1];
    const items = await this.discoItems(session, domain); guard(); const services = [];
    for (const item of items) {
      const jid = this.bareJid(item.attrs.jid || ''); if (!jid) continue;
      const info = await this.discoInfo(session, jid); guard(); const identities = info.getChild('query', DISCO_INFO_NS)?.getChildren('identity') || []; const features = info.getChild('query', DISCO_INFO_NS)?.getChildren('feature') || [];
      if (!identities.some((identity) => identity.attrs.category === 'conference' && identity.attrs.type === 'text') || !features.some((feature) => feature.attrs.var === 'http://jabber.org/protocol/muc')) continue;
      services.push(jid);
    }
    const rooms = []; for (const service of services) { const visible = await this.discoItems(session, service); guard(); for (const item of visible) { const jid = this.bareJid(item.attrs.jid || ''); if (!jid || !jid.endsWith(`@${service}`) || jid.includes('/')) continue; rooms.push({ service, room: jid.slice(0, -service.length - 1), jid }); } }
    return [...new Map(rooms.map((room) => [room.jid.toLowerCase(), room])).values()];
  }

  async discoItems(session, to) { const result = await session.iqCaller.request(xml('iq', { type: 'get', to }, xml('query', { xmlns: DISCO_ITEMS_NS }))); const query = result.getChild('query', DISCO_ITEMS_NS); if (!query) throw taggedError('TRANSPORT_FAILED', 'La respuesta de descubrimiento está incompleta.', 'muc.discovery'); return query.getChildren('item'); }
  async discoInfo(session, to) { const result = await session.iqCaller.request(xml('iq', { type: 'get', to }, xml('query', { xmlns: DISCO_INFO_NS }))); if (!result.getChild('query', DISCO_INFO_NS)) throw taggedError('TRANSPORT_FAILED', 'La respuesta de identidad MUC está incompleta.', 'muc.discovery'); return result; }

  async joinMuc(input) {
    this.assertMucRequest(input); const roomJid = this.validateRoomJid(input.roomJid); const nickname = this.validateNickname(input.nickname); const session = this.requireConnected(input.accountId); const discovered = this.mucDiscoveries.get(input.accountId)?.get(roomJid.toLowerCase());
    if (!discovered || discovered.service !== this.bareJid(roomJid).split('@')[1]) throw taggedError('UNAUTHORIZED', 'La sala no fue descubierta en el servicio seleccionado.', 'muc.join');
    const generation = this.sessionGenerations.get(input.accountId) || 0; const currentDomain = this.sessionDomains.get(input.accountId) || ''; const endpoint = this.sessionEndpoints.get(input.accountId); const policy = this.mucPolicies.get(this.mucPolicyKey(input.accountId, discovered.service, endpoint)); if (!policy) throw taggedError('UNAUTHORIZED', 'La entrada requiere acreditación administrativa de que la cuenta no puede crear salas.', 'muc.policy');
    if (discovered.discoveryGeneration !== generation || discovered.discoveryDomain !== currentDomain || JSON.stringify(discovered.discoveryEndpoint) !== JSON.stringify(endpoint) || discovered.service !== this.bareJid(roomJid).split('@')[1]) throw taggedError('UNAUTHORIZED', 'La evidencia de la sala está obsoleta.', 'muc.join');
    const roomInfo = await this.discoInfo(session, roomJid); this.assertSessionCurrent(input.accountId, session, generation, currentDomain); const roomQuery = roomInfo.getChild('query', DISCO_INFO_NS); if (!roomQuery || !roomQuery.getChildren('identity').length) throw taggedError('UNAUTHORIZED', 'La sala ya no está disponible.', 'muc.join');
    const rooms = this.mucRooms.get(input.accountId) || new Map(); const active = [...rooms.values()].filter((room) => ['joining', 'joined', 'leaving'].includes(room.state.status)).length; if (active >= MUC_ROOM_LIMIT) throw taggedError('CONFLICT', 'Se alcanzó el máximo de salas simultáneas.', 'muc.join');
    if (rooms.get(roomJid.toLowerCase())?.state.status === 'joining' || rooms.get(roomJid.toLowerCase())?.state.status === 'joined') throw taggedError('CONFLICT', 'La cuenta ya está en esta sala.', 'muc.join');
    const record = this.createMucRoom(input.accountId, discovered, generation, nickname, input.requestId); rooms.set(roomJid.toLowerCase(), record); this.mucRooms.set(input.accountId, rooms); this.emitMucState(record, input.requestId);
    const presence = xml('presence', { to: `${roomJid}/${nickname}` }, xml('x', { xmlns: MUC_NS }, xml('history', { maxstanzas: '0' })));
    try { this.assertSessionCurrent(input.accountId, session, generation, currentDomain); await session.send(presence); return await this.withTimeout(record.joinPromise, 15000, 'TIMEOUT', 'La entrada a la sala excedió el tiempo límite.'); } catch (error) { this.failMucRoom(record, error); throw error; }
  }

  async leaveMuc(input) {
    this.assertMucRequest(input); const roomJid = this.validateRoomJid(input.roomJid); const record = this.mucRooms.get(input.accountId)?.get(roomJid.toLowerCase()); if (!record || record.state.status !== 'joined') throw taggedError('CONFLICT', 'La cuenta no está dentro de esta sala.', 'muc.leave');
    record.state = { ...record.state, status: 'leaving' }; record.leaveRequestId = input.requestId; this.emitMucState(record, input.requestId); const session = this.requireConnected(input.accountId); try { await session.send(xml('presence', { to: record.state.selfOccupantJid || `${roomJid}/${record.nickname}`, type: 'unavailable' })); return await this.withTimeout(record.leavePromise, 15000, 'TIMEOUT', 'La salida de la sala no fue confirmada.'); } catch (error) { if (record.state.status === 'leaving') { record.state = { ...record.state, status: 'leaving', errorCode: error.code || 'TRANSPORT_FAILED' }; this.emitMucState(record, input.requestId); } throw error; }
  }

  async sendMucMessage(input) {
    this.assertMucRequest(input); const roomJid = this.validateRoomJid(input.roomJid); if (!input.clientMessageId || typeof input.clientMessageId !== 'string' || input.clientMessageId.length > 512 || input.body?.kind !== 'text' || typeof input.body.text !== 'string' || !input.body.text.trim()) throw taggedError('INVALID_INPUT', 'El mensaje MUC no es válido.', 'muc.send'); if (Buffer.byteLength(input.body.text, 'utf8') > MUC_TEXT_LIMIT_BYTES) throw taggedError('INVALID_INPUT', 'El mensaje supera el límite de 4096 bytes UTF-8.', 'muc.send');
    const record = this.mucRooms.get(input.accountId)?.get(roomJid.toLowerCase()); if (!record || record.state.status !== 'joined') throw taggedError('NOT_CONNECTED', 'La sala no está confirmada como ingresada.', 'muc.send'); const self = record.state.selfOccupantJid && record.participants.get(record.state.selfOccupantJid); if (!self || !['participant', 'moderator'].includes(self.role)) throw taggedError('UNAUTHORIZED', 'El usuario no tiene voz en la sala.', 'muc.send');
    await this.requireConnected(input.accountId).send(xml('message', { type: 'groupchat', to: roomJid, id: input.clientMessageId }, xml('body', {}, input.body.text), xml('origin-id', { xmlns: 'urn:xmpp:sid:0', id: input.clientMessageId }))); return { accountId: input.accountId, roomJid, clientMessageId: input.clientMessageId, status: 'sent' };
  }

  createMucRoom(accountId, room, generation, nickname, requestId) { let resolveJoin; let rejectJoin; let resolveLeave; const joinPromise = new Promise((resolve, reject) => { resolveJoin = resolve; rejectJoin = reject; }); const leavePromise = new Promise((resolve) => { resolveLeave = resolve; }); joinPromise.catch(() => undefined); return { accountId, generation, room, nickname, requestId, active: true, participants: new Map(), seenMessageIds: new Set(), joinPromise, resolveJoin, rejectJoin, leavePromise, resolveLeave, state: { accountId, room, status: 'joining', participants: [], sessionGeneration: generation } }; }
  emitMucState(record, correlationId) { this.emit({ type: 'muc.stateChanged', correlationId: correlationId || record.requestId, payload: { ...record.state, participants: [...record.participants.values()] } }); }
  emitMucParticipant(record, participant, correlationId) { this.emit({ type: 'muc.participantChanged', correlationId: correlationId || record.requestId, payload: { accountId: record.accountId, room: record.room, participant, sessionGeneration: record.generation } }); }
  mucPolicyKey(accountId, service, endpoint) { return `${accountId.toLowerCase()}|${service.toLowerCase()}|${endpoint?.host?.toLowerCase() || ''}:${endpoint?.port || ''}|${endpoint?.transport || ''}`; }
  assertSessionCurrent(accountId, session, generation, domain) { if (this.sessions.get(accountId) !== session || this.sessionGenerations.get(accountId) !== generation || this.sessionDomains.get(accountId) !== domain || this.states.get(accountId)?.status !== 'connected') throw taggedError('NOT_CONNECTED', 'La sesión XMPP ya no es vigente.', 'muc.session'); }
  assertMucRequest(input) { if (!input || input.version !== 1 || typeof input.requestId !== 'string' || !input.requestId.trim() || typeof input.accountId !== 'string' || !input.accountId.trim()) throw taggedError('INVALID_INPUT', 'La solicitud MUC no es válida.', 'muc.input'); }
  validateRoomJid(value) { if (typeof value !== 'string' || value.length > 512 || value.includes('/') || !/^[^@\s]+@[^@\s]+$/.test(value.trim())) throw taggedError('INVALID_INPUT', 'El JID de sala no es válido.', 'muc.input'); return value.trim().toLowerCase(); }
  validateNickname(value) { if (typeof value !== 'string' || !value.trim() || value.length > 128 || /[\s/@<>:&"']/.test(value)) throw taggedError('INVALID_INPUT', 'El nickname no es válido.', 'muc.input'); return value.trim(); }
  requireConnected(accountId) { if (!this.sessions.has(accountId) || this.states.get(accountId)?.status !== 'connected') throw taggedError('NOT_CONNECTED', 'La cuenta no está conectada.', 'muc.session'); return this.sessions.get(accountId); }
  withTimeout(promise, milliseconds, code, message) { let timer; return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(taggedError(code, message, 'muc.timeout')), milliseconds); })]).finally(() => clearTimeout(timer)); }
  clearMucRooms(accountId) { const rooms = this.mucRooms.get(accountId); if (!rooms) return; for (const record of rooms.values()) { record.rejectJoin?.(taggedError('NOT_CONNECTED', 'La sesión XMPP terminó.', 'muc.session')); record.participants.clear(); } rooms.clear(); this.mucRooms.delete(accountId); this.mucDiscoveries.delete(accountId); }
  failMucRoom(record, error) { if (!record || record.state.status === 'failed' || record.state.status === 'idle') return; const code = error?.code || 'TRANSPORT_FAILED'; record.state = { ...record.state, status: 'failed', errorCode: ['INVALID_INPUT', 'UNAUTHORIZED', 'NOT_CONNECTED', 'TIMEOUT', 'TRANSPORT_FAILED', 'CONFLICT', 'UNSUPPORTED', 'INTERNAL'].includes(code) ? code : 'TRANSPORT_FAILED', participants: [] }; record.active = false; record.participants.clear(); this.emitMucState(record); record.rejectJoin?.(error); const rooms = this.mucRooms.get(record.accountId); if (rooms?.get(record.room.jid.toLowerCase()) === record) rooms.delete(record.room.jid.toLowerCase()); }

  handleMucStanza(accountId, stanza) {
    if (stanza.is('presence')) return this.handleMucPresence(accountId, stanza);
    if (stanza.is('message') && stanza.attrs.type === 'groupchat') { this.handleMucMessage(accountId, stanza); return true; }
    return false;
  }

  handleMucPresence(accountId, stanza) {
    const from = String(stanza.attrs.from || ''); const roomJid = this.bareJid(from); const record = this.mucRooms.get(accountId)?.get(roomJid.toLowerCase()); if (!record || !record.active || record.generation !== this.sessionGenerations.get(accountId) || !['joining', 'joined', 'leaving'].includes(record.state.status)) return false;
    const type = stanza.attrs.type; const errorCondition = stanza.getChild('error')?.getChildren()?.find((child) => child.name !== 'text')?.name; if (type === 'error' || errorCondition) { const error = taggedError(this.mucConditionCode(errorCondition), 'El servidor rechazó la entrada a la sala.', 'muc.join'); record.rejectJoin?.(error); this.failMucRoom(record, error); return true; }
    const x = stanza.getChild('x', MUC_USER_NS); const item = x?.getChild('item'); const statusCodes = new Set((x?.getChildren('status') || []).map((status) => String(status.attrs.code || ''))); const participant = { occupantJid: from, nick: from.split('/').slice(1).join('/') || '', role: this.mucRole(item?.attrs.role), affiliation: this.mucAffiliation(item?.attrs.affiliation), availability: type === 'unavailable' ? 'unavailable' : 'available' };
    if (type === 'unavailable') record.participants.delete(from); else record.participants.set(from, participant); if (record.state.status !== 'leaving') this.emitMucParticipant(record, participant);
    if (type === 'unavailable' && statusCodes.has('110') && record.state.status === 'leaving') { record.state = { ...record.state, status: 'idle', participants: [] }; record.active = false; record.resolveLeave?.(record.state); this.mucRooms.get(accountId)?.delete(roomJid.toLowerCase()); this.emitMucState(record, record.leaveRequestId); return true; }
    if (record.state.status === 'leaving') return true;
    if (statusCodes.has('100')) this.emit({ type: 'muc.notice', payload: { accountId, roomJid, code: 'IDENTITY_VISIBLE', sessionGeneration: record.generation } });
    if (statusCodes.has('170')) this.emit({ type: 'muc.notice', payload: { accountId, roomJid, code: 'PUBLIC_LOGGING', sessionGeneration: record.generation } });
    if (statusCodes.has('210')) this.emit({ type: 'muc.notice', payload: { accountId, roomJid, code: 'SERVER_NICKNAME', nickname: participant.nick, sessionGeneration: record.generation } });
    if (type === 'unavailable' && statusCodes.has('110')) { const error = taggedError('TRANSPORT_FAILED', 'La presencia propia fue retirada antes de confirmar la entrada.', 'muc.join'); this.failMucRoom(record, error); return true; }
    if (statusCodes.has('201')) { const error = taggedError('CONFLICT', 'El servidor indicó que la sala fue creada durante la entrada.', 'muc.join'); void Promise.resolve(this.requireConnected(accountId).send(xml('presence', { to: from, type: 'unavailable' }))).catch(() => undefined); this.failMucRoom(record, error); return true; }
    if (statusCodes.has('110')) { record.state = { ...record.state, status: 'joined', selfOccupantJid: from, participants: [...record.participants.values()] }; this.emitMucState(record); record.resolveJoin?.(record.state); }
    return true;
  }

  handleMucMessage(accountId, stanza) {
    const from = String(stanza.attrs.from || ''); const roomJid = this.bareJid(from); const record = this.mucRooms.get(accountId)?.get(roomJid.toLowerCase()); if (!record || record.generation !== this.sessionGenerations.get(accountId)) return;
    const body = stanza.getChildText('body'); if (typeof body !== 'string') return; const explicitId = stanza.attrs.id || stanza.getChild('origin-id')?.attrs?.id || ''; const identity = explicitId ? `${accountId}|${roomJid}|${from}|${explicitId}` : `muc_${crypto.randomUUID()}`; const id = explicitId ? `room_${crypto.createHash('sha256').update(identity).digest('hex')}` : identity; if (record.seenMessageIds.has(id)) return; record.seenMessageIds.add(id); if (record.seenMessageIds.size > MUC_MESSAGE_BUFFER_LIMIT * 2) record.seenMessageIds.delete(record.seenMessageIds.values().next().value);
    const source = stanza.getChild('delay', DELAY_NS) || stanza.getChild('x', LEGACY_DELAY_NS) ? 'server-history' : 'live'; const clientMessageId = stanza.getChild('origin-id')?.attrs?.id || (from === record.state.selfOccupantJid ? explicitId || undefined : undefined); const message = { id, accountId, roomJid, occupantJid: from, body: { kind: 'text', text: body }, receivedAt: new Date().toISOString(), ...(clientMessageId ? { clientMessageId } : {}), source, sessionGeneration: record.generation }; if (source === 'live') { record.messageBuffer = [...(record.messageBuffer || []), message].slice(-MUC_MESSAGE_BUFFER_LIMIT); } this.emit({ type: 'muc.messageReceived', correlationId: clientMessageId || id, payload: message });
  }

  mucRole(value) { return ['none', 'visitor', 'participant', 'moderator'].includes(value) ? value : 'none'; }
  mucAffiliation(value) { return ['none', 'member', 'admin', 'owner'].includes(value) ? value : 'none'; }
  mucConditionCode(condition) { return ['conflict', 'not-acceptable'].includes(condition) ? 'CONFLICT' : ['forbidden', 'not-authorized', 'registration-required', 'membership-required'].includes(condition) ? 'UNAUTHORIZED' : ['service-unavailable', 'item-not-found', 'remote-server-not-found', 'recipient-unavailable'].includes(condition) ? 'NOT_CONNECTED' : condition === 'resource-constraint' ? 'CONFLICT' : 'TRANSPORT_FAILED'; }

  handleStanza(accountId, stanza) {
    if (process.env.ATOMIC_XMPP_FILE_TRACE === 'true' && stanza?.is?.('iq') && stanza.attrs?.type === 'set' && stanza.getChild?.('si', SI_NS)) { const correlation = `attempt_${crypto.randomUUID()}`; this.fileTraceAttempts.set(stanza, correlation); fileTrace('FILE_IQ_CANDIDATE_RX', 'RX', { iqType: 'set', correlation }); }
    if (process.env.ATOMIC_XMPP_DEBUG === 'true') console.debug('[XMPP_STANZA]', JSON.stringify({ accountId, from: stanza.attrs?.from || '', to: stanza.attrs?.to || '', type: stanza.name || stanza.attrs?.type || '', id: stanza.attrs?.id || '', hasBody: Boolean(stanza.getChildText?.('body')) }));
    if (this.handleMucStanza(accountId, stanza)) return;
    if (this.handleFileStanza(accountId, stanza)) return;
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

  handleFileStanza(accountId, stanza) {
    if (!this.fileTransfers) return false;
    if (!stanza?.is?.('iq')) return false;
    const session = this.sessions.get(accountId); const generation = this.sessionGenerations.get(accountId) || 0; const si = stanza.getChild?.('si', SI_NS); const open = stanza.getChild?.('open', IBB_NS); const data = stanza.getChild?.('data', IBB_NS); const close = stanza.getChild?.('close', IBB_NS); const disco = stanza.getChild?.('query', DISCO_INFO_NS);
    if (stanza.attrs?.type === 'get' && disco) { fileTrace('DISCO_INFO', 'RX', { iqType: 'get' }); void session?.send(xml('iq', { type: 'result', id: stanza.attrs.id, to: stanza.attrs.from }, xml('query', { xmlns: DISCO_INFO_NS }, xml('feature', { var: SI_NS }), xml('feature', { var: SI_FILE_NS }), xml('feature', { var: IBB_NS })))).then(() => fileTrace('DISCO_INFO', 'TX', { iqType: 'result', result: 'supported' })).catch(() => undefined); return true; }
    if (stanza.attrs?.type !== 'set' || (!si && !open && !data && !close)) return false;
    if (si) { const attempt = this.fileTraceAttempts.get(stanza) || `attempt_${crypto.randomUUID()}`; fileTrace('SI_OFFER_RX', 'RX', { iqType: stanza.attrs.type, result: 'recognized', correlation: attempt }); try { const offer = parseOffer(stanza, accountId, generation); const publicOffer = { transferId: offer.transferId, accountId, conversationId: offer.conversationId, senderJid: offer.senderJid, name: offer.name, sizeBytes: offer.sizeBytes, ...(offer.description ? { description: offer.description } : {}), transport: 'ibb', offeredAt: new Date().toISOString() }; let replied = false; const replyError = async (reason) => { if (replied) return; replied = true; fileTrace('SI_ERROR', 'TX', { iqType: 'error', condition: reason === 'user_rejected' ? 'forbidden' : 'not-acceptable', correlation: attempt }); await session.send(xml('iq', { type: 'error', id: stanza.attrs.id, to: stanza.attrs.from }, xml('error', { type: 'cancel' }, xml(reason === 'user_rejected' ? 'forbidden' : 'not-acceptable', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })))); }; const record = this.fileTransfers.add({ offer: publicOffer, iqOfferId: offer.iqId, siSessionId: offer.siSid, ownerSenderId: this.fileOwners.get(accountId), iq: stanza, session, onRejected: replyError, onAccepted: async () => { if (replied) throw new Error('SI_ALREADY_REPLIED'); replied = true; fileTrace('SI_RESULT_TX_ATTEMPT', 'TX', { iqType: 'result', correlation: attempt }); try { await session.send(xml('iq', { type: 'result', id: stanza.attrs.id, to: stanza.attrs.from }, xml('si', { xmlns: SI_NS }, xml('feature', { xmlns: FEATURE_NEG_NS }, xml('x', { xmlns: DATAFORM_NS, type: 'submit' }, xml('field', { var: 'stream-method' }, xml('value', {}, IBB_NS))))))); fileTrace('SI_RESULT_TX_FULFILLED', 'TX', { iqType: 'result', correlation: attempt }); } catch (cause) { fileTrace('SI_RESULT_TX_FAILED', 'TX', { iqType: 'result', errorCode: 'TRANSPORT_FAILED', correlation: attempt }); throw cause; } } }); this.filePending.set(`${accountId}|${generation}|${offer.senderJid}|${offer.siSid}`, { record, session, generation, attempt, protocolQueue: Promise.resolve() }); fileTrace('SI_OFFER_REGISTERED', 'RX', { result: 'offered', correlation: attempt }); } catch (error) { const condition = error?.code === 'UNSUPPORTED_METHOD' ? 'not-acceptable' : error?.code === 'RESOURCE_CONSTRAINT' ? 'resource-constraint' : error?.code === 'BAD_REQUEST' ? 'bad-request' : 'undefined-condition'; fileTrace('SI_PARSE_REJECTED', 'RX', { iqType: 'set', condition, correlation: attempt }); void session?.send(xml('iq', { type: 'error', id: stanza.attrs.id, to: stanza.attrs.from }, xml('error', { type: 'cancel' }, xml(condition, { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })))).catch(() => undefined); } return true; }
    const sid = open?.attrs?.sid || data?.attrs?.sid || close?.attrs?.sid || '';
    const pending = this.filePending.get(`${accountId}|${generation}|${stanza.attrs.from}|${sid}`);
    if (open) fileTrace('IBB_OPEN_CANDIDATE_RX', 'RX', { iqType: 'set', correlation: pending?.attempt || `open_${crypto.randomUUID()}` });
    if (!pending) { if (open) fileTrace('IBB_OPEN_UNMATCHED', 'RX', { iqType: 'set', condition: 'item-not-found' }); void session.send(xml('iq', { type: 'error', id: stanza.attrs.id, to: stanza.attrs.from }, xml('error', { type: 'cancel' }, xml('item-not-found', { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' })))).catch(() => undefined); return true; }
    const sendFileError = (id, from, condition = 'undefined-condition') => session.send(xml('iq', { type: 'error', id, to: from }, xml('error', { type: 'cancel' }, xml(condition, { xmlns: 'urn:ietf:params:xml:ns:xmpp-stanzas' }))));
    try {
      const record = pending.record; if (stanza.attrs.from !== record.offer.senderJid) throw new Error('BAD_SENDER'); if (open) { pending.protocolQueue = pending.protocolQueue.then(async () => { if (record.state !== 'accepted') throw new Error('NOT_ACCEPTED'); const blockSize = validateOpen(open, record.siSessionId, record.offer.senderJid); pending.sid = open.attrs.sid; pending.blockSize = blockSize; pending.seq = 0; record.state = 'transferring'; fileTrace('IBB_OPEN_MATCHED', 'RX', { iqType: 'set', blockSize, result: 'accepted', correlation: pending.attempt }); try { await session.send(xml('iq', { type: 'result', id: stanza.attrs.id, to: stanza.attrs.from })); fileTrace('IBB_OPEN_RESULT_TX_FULFILLED', 'TX', { iqType: 'result', correlation: pending.attempt }); } catch (cause) { fileTrace('IBB_OPEN_RESULT_TX_FAILED', 'TX', { iqType: 'result', errorCode: 'TRANSPORT_FAILED', correlation: pending.attempt }); throw cause; } }); }
      if (data) { pending.protocolQueue = pending.protocolQueue.then(async () => { const expectedSeq = pending.seq; const bytes = validateData(data, pending.sid, record.offer.senderJid, pending.blockSize, expectedSeq); fileTrace('IBB_DATA', 'RX', { iqType: 'set', seq: expectedSeq, bytes: bytes.length }); await this.fileTransfers.append(record.offer.transferId, bytes); pending.seq = (expectedSeq + 1) % 65536; await session.send(xml('iq', { type: 'result', id: stanza.attrs.id, to: stanza.attrs.from })); fileTrace('IBB_DATA', 'TX', { iqType: 'result', seq: expectedSeq, bytes: bytes.length }); }); }
      if (close) { pending.protocolQueue = pending.protocolQueue.then(async () => { fileTrace('IBB_CLOSE', 'RX', { iqType: 'set' }); await this.fileTransfers.complete(record.offer.transferId); await session.send(xml('iq', { type: 'result', id: stanza.attrs.id, to: stanza.attrs.from })); fileTrace('IBB_CLOSE', 'TX', { iqType: 'result', result: 'completed' }); }); }
      pending.protocolQueue.catch(async (cause) => { await this.fileTransfers.fail(record.offer.transferId, 'storage_failed').catch(() => undefined); await sendFileError(stanza.attrs.id, stanza.attrs.from, cause?.message === 'NOT_ACCEPTED' ? 'not-acceptable' : 'resource-constraint').catch(() => undefined); fileTrace(open ? 'IBB_OPEN' : data ? 'IBB_DATA' : 'IBB_CLOSE', 'TX', { iqType: 'error', condition: 'resource-constraint' }); });
    } catch { void sendFileError(stanza.attrs.id, stanza.attrs.from, 'bad-request').catch(() => undefined); }
    return true;
  }

  bareJid(jid) { return String(jid).split('/')[0]; }

  emit(event) { this.listeners.forEach((listener) => listener(event)); }

  require(accountId) { const session = this.sessions.get(accountId); if (!session) throw new Error('not_connected'); return session; }
  setState(accountId, status, retryable, reason) { const state = { accountId, status, retryable, since: new Date().toISOString(), ...(reason ? { reason } : {}) }; this.states.set(accountId, state); this.emit({ type: 'connection.stateChanged', payload: state }); }
  handleSessionEvent(accountId, session, event, reason) { if (this.sessions.get(accountId) !== session) return false; if (event === 'offline') { this.clearMucRooms(accountId); void this.fileTransfers?.cancelAccount(accountId).catch(() => undefined); for (const [key] of this.filePending) if (key.startsWith(`${accountId}|`)) this.filePending.delete(key); this.sessions.delete(accountId); this.sessionGenerations.set(accountId, (this.sessionGenerations.get(accountId) || 0) + 1); this.setState(accountId, 'failed', true, 'offline'); } else if (event === 'error') this.setState(accountId, 'failed', true, reason || 'TRANSPORT_FAILED'); else if (event === 'online') this.setState(accountId, 'connected', false); return true; }
}

module.exports = { XmppAdapter, negotiateStartTls };
