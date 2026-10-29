const { createXmppTransport, negotiateStartTls } = require('./xmpp-transport.cjs');
const { createXmppSession } = require('./xmpp-session.cjs');
const { createRosterMessaging } = require('./xmpp-roster-messaging.cjs');
const { createMucService } = require('./xmpp-muc.cjs');
const { createFileService } = require('./xmpp-file.cjs');

class XmppAdapter {
  constructor(
    packaged = false,
    trustStore = null,
    mucPolicies = [],
    fileTransfers = null,
    outgoingTransfers = null,
  ) {
    this.packaged = packaged;
    this.trustStore = trustStore;
    this.fileTransfers = fileTransfers;
    this.outgoingTransfers = outgoingTransfers;
    this.sessions = new Map();
    this.states = new Map();
    this.listeners = new Set();
    this.connecting = new Map();
    this.pendingDecisions = new Map();
    this.activeDecisionBySender = new Map();
    this.rosters = new Map();
    this.remoteResources = new Map();
    this.pendingPresences = new Map();
    this.initialPresencePublished = new Set();
    this.sessionGenerations = new Map();
    this.sessionDomains = new Map();
    this.sessionEndpoints = new Map();
    this.mucDiscoveries = new Map();
    this.mucRooms = new Map();
    this.filePending = new Map();
    this.fileOwners = new Map();
    this.fileIqHandled = new WeakSet();
    this.fileTraceAttempts = new WeakMap();
    this.mucPolicies = new Map();

    this.transport = createXmppTransport(this);
    this.sessionService = createXmppSession(this);
    this.rosterMessaging = createRosterMessaging(this);
    this.mucService = createMucService(this);
    this.fileService = createFileService(this);
    if (this.fileTransfers)
      this.fileTransfers.onEvent((event) => {
        if (!event.type.endsWith('stateChanged')) return;
        const transferId = event.payload?.offer?.transferId;
        if (!transferId || !['completed', 'failed', 'cancelled'].includes(event.payload?.state))
          return;
        for (const [key, pending] of this.filePending)
          if (pending.record.offer.transferId === transferId) this.filePending.delete(key);
      });
    mucPolicies.forEach((policy) => this.setMucPolicy(policy));
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(event) {
    this.listeners.forEach((listener) => listener(event));
  }

  connect(input, password, senderId) {
    return this.sessionService.connect(input, password, senderId);
  }
  connectInternal(input, password, senderId) {
    return this.sessionService.connectInternal(input, password, senderId);
  }
  disconnect(accountId) {
    return this.sessionService.disconnect(accountId);
  }
  setState(accountId, status, retryable, reason) {
    return this.sessionService.setState(accountId, status, retryable, reason);
  }
  handleSessionEvent(accountId, session, event, reason) {
    return this.sessionService.handleSessionEvent(accountId, session, event, reason);
  }
  require(accountId) {
    return this.sessionService.require(accountId);
  }
  requireConnected(accountId) {
    return this.sessionService.requireConnected(accountId);
  }
  bareJid(jid) {
    return this.sessionService.bareJid(jid);
  }

  installTlsTransport(session, service, tlsOptions, domain) {
    return this.transport.installTlsTransport(session, service, tlsOptions, domain);
  }
  installStartTlsTransport(session, service, tlsOptions, domain) {
    return this.transport.installStartTlsTransport(session, service, tlsOptions, domain);
  }
  probeDirectCertificate(endpoint, domain) {
    return this.transport.probeDirectCertificate(endpoint, domain);
  }
  probeStartTlsCertificate(endpoint, domain) {
    return this.transport.probeStartTlsCertificate(endpoint, domain);
  }
  resolveTlsOptions(input, senderId, transport) {
    return this.transport.resolveTlsOptions(input, senderId, transport);
  }
  awaitTrustDecision(input, transport, certificate, verificationError, previous, senderId) {
    return this.transport.awaitTrustDecision(
      input,
      transport,
      certificate,
      verificationError,
      previous,
      senderId,
    );
  }
  decideCertificateTrust(senderId, input) {
    return this.transport.decideCertificateTrust(senderId, input);
  }
  cancelPendingDecision(accountId) {
    return this.transport.cancelPendingDecision(accountId);
  }

  setPresence(accountId, presence) {
    return this.rosterMessaging.setPresence(accountId, presence);
  }
  listRoster(accountId) {
    return this.rosterMessaging.listRoster(accountId);
  }
  sendMessage(accountId, input) {
    return this.rosterMessaging.sendMessage(accountId, input);
  }
  sendChatState(accountId, input) {
    return this.rosterMessaging.sendChatState(accountId, input);
  }

  sendFile(accountId, input) {
    return this.fileService.sendFile(accountId, input);
  }
  resolveFileRecipient(accountId, conversationId, session, generation) {
    return this.fileService.resolveFileRecipient(accountId, conversationId, session, generation);
  }
  requestOutgoingIq(accountId, session, generation, record, child, phase) {
    return this.fileService.requestOutgoingIq(accountId, session, generation, record, child, phase);
  }
  sendOutgoingOffer(accountId, session, generation, record) {
    return this.fileService.sendOutgoingOffer(accountId, session, generation, record);
  }
  sendOutgoingOpen(accountId, session, generation, record, blockSize) {
    return this.fileService.sendOutgoingOpen(accountId, session, generation, record, blockSize);
  }
  sendOutgoingData(accountId, session, generation, record, block, sequence) {
    return this.fileService.sendOutgoingData(
      accountId,
      session,
      generation,
      record,
      block,
      sequence,
    );
  }
  sendOutgoingClose(accountId, session, generation, record) {
    return this.fileService.sendOutgoingClose(accountId, session, generation, record);
  }
  isFileIq(stanza) {
    return this.fileService.isFileIq(stanza);
  }
  installFileIqHandlers(accountId, session) {
    return this.fileService.installFileIqHandlers(accountId, session);
  }
  observeFileIqReply(session, request, response) {
    return this.fileService.observeFileIqReply(session, request, response);
  }
  handleFileIq(accountId, stanza, options = {}) {
    return this.fileService.handleFileIq(accountId, stanza, options);
  }
  handleFileStanza(accountId, stanza) {
    return this.fileService.handleFileStanza(accountId, stanza);
  }

  setMucPolicy(policy) {
    return this.mucService.setMucPolicy(policy);
  }
  discoverMuc(input) {
    return this.mucService.discoverMuc(input);
  }
  discoverServices(session, accountId, guard) {
    return this.mucService.discoverServices(session, accountId, guard);
  }
  discoItems(session, to) {
    return this.mucService.discoItems(session, to);
  }
  discoInfo(session, to) {
    return this.mucService.discoInfo(session, to);
  }
  joinMuc(input) {
    return this.mucService.joinMuc(input);
  }
  leaveMuc(input) {
    return this.mucService.leaveMuc(input);
  }
  sendMucMessage(input) {
    return this.mucService.sendMucMessage(input);
  }
  createMucRoom(accountId, room, generation, nickname, requestId) {
    return this.mucService.createMucRoom(accountId, room, generation, nickname, requestId);
  }
  emitMucState(record, correlationId) {
    return this.mucService.emitMucState(record, correlationId);
  }
  emitMucParticipant(record, participant, correlationId) {
    return this.mucService.emitMucParticipant(record, participant, correlationId);
  }
  mucPolicyKey(accountId, service, endpoint) {
    return this.mucService.mucPolicyKey(accountId, service, endpoint);
  }
  assertSessionCurrent(accountId, session, generation, domain) {
    return this.mucService.assertSessionCurrent(accountId, session, generation, domain);
  }
  assertMucRequest(input) {
    return this.mucService.assertMucRequest(input);
  }
  validateRoomJid(value) {
    return this.mucService.validateRoomJid(value);
  }
  validateNickname(value) {
    return this.mucService.validateNickname(value);
  }
  withTimeout(promise, milliseconds, code, message) {
    return this.mucService.withTimeout(promise, milliseconds, code, message);
  }
  clearMucRooms(accountId) {
    return this.mucService.clearMucRooms(accountId);
  }
  failMucRoom(record, error) {
    return this.mucService.failMucRoom(record, error);
  }
  handleMucStanza(accountId, stanza) {
    return this.mucService.handleMucStanza(accountId, stanza);
  }
  handleMucPresence(accountId, stanza) {
    return this.mucService.handleMucPresence(accountId, stanza);
  }
  handleMucMessage(accountId, stanza) {
    return this.mucService.handleMucMessage(accountId, stanza);
  }
  mucRole(value) {
    return this.mucService.mucRole(value);
  }
  mucAffiliation(value) {
    return this.mucService.mucAffiliation(value);
  }
  mucConditionCode(condition) {
    return this.mucService.mucConditionCode(condition);
  }

  handleStanza(accountId, stanza) {
    this.fileService.traceStanza(accountId, stanza);
    if (
      this.fileIqHandled.has(stanza) ||
      (this.sessions.get(accountId)?.iqCallee && this.isFileIq(stanza))
    )
      return;
    if (this.handleMucStanza(accountId, stanza)) return;
    if (this.handleFileStanza(accountId, stanza)) return;
    if (stanza.is('presence')) {
      this.rosterMessaging.handlePresence(accountId, stanza);
      return;
    }
    if (stanza.is('message')) this.rosterMessaging.handleMessage(accountId, stanza);
  }
}

module.exports = { XmppAdapter, negotiateStartTls };
