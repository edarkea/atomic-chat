const { createXmppTransport, negotiateStartTls } = require('./xmpp-transport.cjs');
const { createXmppSession } = require('./xmpp-session.cjs');
const { createRosterMessaging } = require('./xmpp-roster-messaging.cjs');
const { createXmppCarbons } = require('./xmpp-carbons.cjs');
const { createMucService } = require('./xmpp-muc.cjs');
const { createFileService } = require('./xmpp-file.cjs');
const { createXmppStickerService } = require('./xmpp-stickers.cjs');
const xmppClient = require('@xmpp/client');
const { REACTIONS_NS, REPLY_NS, FALLBACK_NS, SID_NS } = require('./xmpp-message-features.cjs');

/**
 * @typedef {{[key: string]: string | undefined}} XmlAttributes
 * @typedef {{attrs?: XmlAttributes, getChild: (name: string, namespace?: string) => XmlNode | undefined, getChildren: (name?: string, namespace?: string) => XmlNode[], getChildText: (name: string, namespace?: string) => string | undefined, is: (name: string) => boolean, getText: () => string | undefined}} XmlNode
 * @typedef {{iqCaller: {request: (stanza: unknown, timeoutMs?: number) => Promise<XmlNode>}, iqCallee?: {get: (...args: unknown[]) => unknown, set: (...args: unknown[]) => unknown}, send: (stanza: {attrs?: XmlAttributes} | XmlNode) => Promise<unknown>, on: (event: string, listener: (value?: XmlNode) => void) => void, start: () => Promise<void>, stop: () => Promise<void>, transports: Array<new (...args: never[]) => object>, jid?: string}} XmppSession
 * @typedef {{iqCaller: {request: (stanza: XmlNode, timeoutMs?: number) => Promise<XmlNode>}, send: (stanza: XmlNode) => Promise<unknown>}} MucServiceSession
 * @typedef {{iqCaller: {request: (stanza: XmlNode, timeoutMs?: number) => Promise<XmlNode>}, send: (stanza: {attrs?: XmlAttributes} | XmlNode) => Promise<unknown>}} StickerSession
 * @typedef {{attrs?: XmlAttributes, getChild: (name: string, namespace?: string) => FileXmlNode | undefined, getChildren: (name?: string, namespace?: string) => FileXmlNode[], getChildText?: (name: string, namespace?: string) => string | undefined, is: (name: string) => boolean, getText?: () => string | undefined}} FileXmlNode
 * @typedef {{iqCaller: {request: (stanza: FileXmlNode, timeoutMs?: number) => Promise<FileXmlNode>}, send: (stanza: {attrs?: XmlAttributes} | FileXmlNode) => Promise<unknown>, on: (event: string, listener: (value?: FileXmlNode) => void) => void}} FileServiceSession
 * @typedef {{host: string, port: number, domain?: string, tls?: boolean, transport?: 'starttls' | 'direct-tls', allowInsecureTls?: boolean}} XmppEndpoint
 * @typedef {{accountId: string, endpoint: XmppEndpoint & {tls: boolean}, requestId: string}} ConnectionInput
 * @typedef {{transport: 'starttls' | 'direct-tls'}} TransportSelection
 * @typedef {{accountId: string, host: string, port: number, transport: 'starttls' | 'direct-tls', fingerprintSha256: string, certificatePem: string, approvedAt: string, identityMismatchAuthorized?: boolean}} TrustedCertificate
 * @typedef {{getTrustedCertificate: (accountId: string, host: string, port: number, transport: string) => TrustedCertificate | null, upsertTrustedCertificate: (value: TrustedCertificate) => void}} TrustStore
 * @typedef {{fingerprintSha256: string, subject: string, issuer: string, validFrom: string, validTo: string, subjectAltNames: string[], chain: Array<{fingerprintSha256: string, subject: string, issuer: string}>, publicKeyBits?: number, signatureAlgorithm?: string, pem: string}} CertificateInfo
 * @typedef {{accountId: string, requestId: string, endpoint: XmppEndpoint}} TlsRequest
 * @typedef {{type: string, payload: {state: string, offer: {transferId: string}, endReason?: string}}} TransferEvent
 * @typedef {{onEvent: (listener: (event: TransferEvent) => void) => void, start: (input: unknown) => Promise<unknown>, cancelBySender: (transferId: string) => Promise<unknown>, fail: (transferId: string, reason: string) => Promise<unknown>, open: (transferId: string) => Promise<unknown>, append: (transferId: string, bytes: Uint8Array) => Promise<unknown>, complete: (transferId: string) => Promise<unknown>, cancelAccount: (accountId: string) => Promise<unknown>, add: (input: unknown) => FileRecord}} FileTransferEvents
 * @typedef {{accountId: string, service: string, endpoint?: unknown}} MucPolicy
 * @typedef {{providerId: string, ownsReference?: (value: unknown) => boolean, getCapabilities: (input: {accountId: string}) => Promise<{providerId: string, storageOrigins: string[], maxFileSize?: number}>, uploadSticker: (input: unknown) => Promise<{assetId: string, remoteUrl: string}>, resolveSticker: (input: unknown) => Promise<{availability: string, remoteUrl: string, providerId: string, storageOrigin: string}>}} StickerStorageProvider
 * @typedef {{accountId: string, conversationId: string, stickerId: string, clientMessageId: string}} StickerSendInput
 * @typedef {{name: string, altText: string, mimeType: string, sizeBytes: number | string, width: number | string, height: number | string, hashValue: string, assetId?: string, bytes?: Uint8Array, path?: string}} StickerSource
 * @typedef {(accountId: string, stickerId: string) => Promise<StickerSource>} StickerSourceResolver
 * @typedef {{mode?: string, status?: string, availability?: string}} PresenceInput
 * @typedef {{messageId?: string, originId?: string, stanzaIds: Array<{id: string, by: string}>, authorJid: string, quote?: string}} MessageReference
 * @typedef {{body: {kind: 'text', text: string}, to: string, clientMessageId: string, replyTo?: MessageReference, broadcast?: boolean, mode?: string}} MessageInput
 * @typedef {{target: ReactionTarget, to: string, clientMessageId: string, targetMessageId?: string, emojis: string[]}} ReactionSendInput
 * @typedef {{to: string, state: 'active' | 'composing' | 'paused' | 'inactive' | 'gone'}} ChatStateInput
 * @typedef {{conversationId: string, fileName: string, filePath: string, ownerSenderId?: number}} FileSendInput
 * @typedef {{signal?: AbortSignal}} CloseOptions
 * @typedef {{send?: (child: unknown) => Promise<unknown>}} FileIqOptions
 * @typedef {{transferId: string, accountId: string, conversationId: string, senderJid: string, recipientJid: string, name: string, sizeBytes: string, siSessionId?: string, state?: string, bytes?: bigint, description?: string}} FileOffer
 * @typedef {{offer: FileOffer, siSessionId: string, abortController?: AbortController, terminalRequested?: boolean, ibbOpened?: boolean, timeoutSeconds?: number, cancellationNoticeSent?: boolean, state: string, bytes: bigint}} FileRecord
 * @typedef {{accountId: string, roomJid?: string, nickname?: string, requestId?: string, clientMessageId?: string, body?: {kind?: string, text?: string}, replyTo?: MessageReference, target?: {originId?: string, stanzaIds?: Array<{id: string, by: string}>, messageId?: string}, targetMessageId?: string, emojis?: string[]}} MucInput
 * @typedef {{accountId?: string, service: string, room: string, jid: string, discoveryGeneration?: number, discoveryDomain?: string, discoveryEndpoint?: unknown}} DiscoveredRoom
 * @typedef {{occupantJid: string, nick: string, realJid?: string, identityVerified?: boolean, role: string, affiliation: string, availability: string}} MucParticipant
 * @typedef {{accountId: string, service: string, room: string, jid: string, discoveryGeneration?: number, discoveryDomain?: string, discoveryEndpoint?: unknown}} MucDiscoveredRoom
 * @typedef {{accountId: string, room: MucDiscoveredRoom, status: string, participants: MucParticipant[], selfOccupantJid?: string, errorCode?: string, sessionGeneration: number}} MucState
 * @typedef {{accountId: string, generation: number, room: MucDiscoveredRoom, nickname: string, requestId?: string, active: boolean, participants: Map<string, MucParticipant>, seenMessageIds: Set<string>, joinPromise: Promise<unknown>, leavePromise: Promise<unknown>, state: MucState}} MucRoomRecord
 * @typedef {{id: string, by?: string}} StanzaId
 * @typedef {{originId?: string, stanzaIds?: Array<{id?: string}>, messageId?: string, authorJid?: string}} ReactionTarget
 * @typedef {{accountId: string, conversationId: string, target?: ReactionTarget, emojis: string[], actorJid?: string, source: 'direct' | 'muc', sessionGeneration?: number, eventId?: string}} ReactionContext
 * @typedef {{accountId: string, conversationId: string, target?: ReactionTarget, emojis: string[], actorJid?: string, source: 'direct' | 'muc', sessionGeneration?: number, eventId?: string}} ReactionInput
 */

const xml =
  /** @type {(name: string, ...children: Array<XmlAttributes | XmlNode | string | undefined>) => XmlNode} */ (
    xmppClient.xml
  );

class XmppAdapter {
  /**
   * @param {boolean} [packaged]
   * @param {TrustStore | null} [trustStore]
   * @param {MucPolicy[]} [mucPolicies]
   * @param {FileTransferEvents | null} [fileTransfers]
   * @param {{start: (input: unknown) => Promise<unknown>, cancelAccount: (accountId: string) => Promise<unknown>} | null} [outgoingTransfers]
   * @param {StickerStorageProvider | null} [stickerStorageProvider]
   * @param {{alternativeAvailable?: boolean} | null} [stickerStorageConfiguration]
   * @param {boolean} [requireMucPolicy]
   */
  constructor(
    packaged = false,
    trustStore = null,
    mucPolicies = [],
    fileTransfers = null,
    outgoingTransfers = null,
    stickerStorageProvider = null,
    stickerStorageConfiguration = null,
    requireMucPolicy = false,
  ) {
    this.packaged = packaged;
    this.requireMucPolicy = requireMucPolicy;
    this.trustStore = trustStore || undefined;
    this.fileTransfers = fileTransfers || undefined;
    this.outgoingTransfers = outgoingTransfers || undefined;
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
    this.publishedPresences = new Map();
    this.sessionGenerations = new Map();
    this.sessionDomains = new Map();
    this.sessionEndpoints = new Map();
    this.sessionJids = new Map();
    this.mucDiscoveries = new Map();
    this.mucRooms = new Map();
    this.filePending = new Map();
    this.fileOwners = new Map();
    this.fileIqHandled = new WeakSet();
    this.fileTraceAttempts = new WeakMap();
    this.mucPolicies = new Map();
    this.reactionStates = new Map();
    this.pendingReactions = new Map();
    this.latestReactionOperation = new Map();
    this.reactionEventKeys = new Set();
    this.messageCapabilities = new Map();

    this.transport = createXmppTransport(this);
    this.sessionService = createXmppSession(this);
    this.rosterMessaging = createRosterMessaging(this);
    this.carbons = createXmppCarbons(this);
    this.mucService = createMucService(this);
    this.fileService = createFileService(this);
    this.stickerService = createXmppStickerService(this, {
      storageProvider: stickerStorageProvider || undefined,
      storageConfiguration: stickerStorageConfiguration || undefined,
    });
    if (this.fileTransfers)
      this.fileTransfers.onEvent((event) => {
        if (!event.type.endsWith('stateChanged')) return;
        const transferId = event.payload?.offer?.transferId;
        if (
          !transferId ||
          !['completed', 'failed', 'cancelled'].includes(event.payload?.state || '')
        )
          return;
        for (const [key, pending] of this.filePending)
          if (pending.record.offer.transferId === transferId) this.filePending.delete(key);
      });
    mucPolicies.forEach((policy) => this.setMucPolicy(policy));
  }

  /** @param {(event: unknown) => void} listener @returns {() => boolean} */
  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  /** @param {unknown} event */
  emit(event) {
    this.listeners.forEach((listener) => listener(event));
  }

  /** @param {ConnectionInput} input @param {string} password @param {number} senderId */
  connect(input, password, senderId) {
    return this.sessionService.connect(input, password, senderId);
  }
  /** @param {ConnectionInput} input @param {string} password @param {number} senderId */
  connectInternal(input, password, senderId) {
    return this.sessionService.connectInternal(input, password, senderId);
  }
  /** @param {string} accountId */
  disconnect(accountId) {
    return this.sessionService.disconnect(accountId);
  }
  /** @param {string} accountId @param {string} status @param {boolean} retryable @param {string} [reason] */
  setState(accountId, status, retryable, reason) {
    return this.sessionService.setState(accountId, status, retryable, reason);
  }
  /** @param {string} accountId @param {unknown} session @param {string} event @param {string} [reason] */
  handleSessionEvent(accountId, session, event, reason) {
    return this.sessionService.handleSessionEvent(
      accountId,
      /** @type {XmppSession} */ (session),
      /** @type {'error' | 'offline' | 'online'} */ (event),
      reason,
    );
  }
  /** @param {string} accountId @returns {XmppSession} */
  require(accountId) {
    return /** @type {XmppSession} */ (
      /** @type {unknown} */ (this.sessionService.require(accountId))
    );
  }
  /** @param {string} accountId @returns {XmppSession} */
  requireConnected(accountId) {
    return /** @type {XmppSession} */ (
      /** @type {unknown} */ (this.sessionService.requireConnected(accountId))
    );
  }
  /** @param {string} accountId @param {unknown} session @param {string} domain @param {number | undefined} generation */
  async discoverMessageCapabilities(accountId, session, domain, generation) {
    const typedSession = /** @type {XmppSession} */ (session);
    const local = [REACTIONS_NS, REPLY_NS, FALLBACK_NS, SID_NS];
    try {
      const response = await typedSession.iqCaller.request(
        xml(
          'iq',
          { type: 'get', to: domain },
          xml('query', { xmlns: 'http://jabber.org/protocol/disco#info' }),
        ),
      );
      const remote =
        response
          .getChild('query', 'http://jabber.org/protocol/disco#info')
          ?.getChildren('feature')
          .map((feature) => feature.attrs?.['var'])
          .filter(Boolean) || [];
      const capabilities = { accountId, generation, local, server: remote, remote: 'unknown' };
      if (this.sessionGenerations.get(accountId) === generation)
        this.messageCapabilities.set(accountId, capabilities);
      return capabilities;
    } catch {
      const capabilities = { accountId, generation, local, server: [], remote: 'unknown' };
      if (this.sessionGenerations.get(accountId) === generation)
        this.messageCapabilities.set(accountId, capabilities);
      return capabilities;
    }
  }
  /** @param {string} jid @returns {string} */
  bareJid(jid) {
    return this.sessionService.bareJid(jid);
  }

  /** @param {unknown} session @param {string} service @param {Record<string, unknown>} tlsOptions @param {string} domain */
  installTlsTransport(session, service, tlsOptions, domain) {
    return this.transport.installTlsTransport(
      /** @type {XmppSession} */ (session),
      service,
      tlsOptions,
      domain,
    );
  }
  /** @param {unknown} session @param {string} service @param {Record<string, unknown>} tlsOptions @param {string} domain */
  installStartTlsTransport(session, service, tlsOptions, domain) {
    return this.transport.installStartTlsTransport(
      /** @type {XmppSession} */ (session),
      service,
      tlsOptions,
      domain,
    );
  }
  /** @param {XmppEndpoint} endpoint @param {string} domain */
  probeDirectCertificate(endpoint, domain) {
    return this.transport.probeDirectCertificate(endpoint, domain);
  }
  /** @param {XmppEndpoint} endpoint @param {string} domain */
  probeStartTlsCertificate(endpoint, domain) {
    return this.transport.probeStartTlsCertificate(endpoint, domain);
  }
  /** @param {TlsRequest} input @param {number} senderId @param {TransportSelection} transport */
  resolveTlsOptions(input, senderId, transport) {
    return this.transport.resolveTlsOptions(input, senderId, transport);
  }
  /** @param {TlsRequest} input @param {string} transport @param {CertificateInfo} certificate @param {{code: string, message: string} | undefined} verificationError @param {TrustedCertificate | null} previous @param {number} senderId */
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
  /** @param {number} senderId @param {{requestId: string, accountId: string, fingerprintSha256: string, decision: 'cancel' | 'trust_once' | 'trust_and_remember'}} input */
  decideCertificateTrust(senderId, input) {
    return this.transport.decideCertificateTrust(senderId, input);
  }
  /** @param {string} accountId */
  cancelPendingDecision(accountId) {
    return this.transport.cancelPendingDecision(accountId);
  }

  /** @param {string} accountId @param {PresenceInput} presence */
  setPresence(accountId, presence) {
    return this.rosterMessaging.setPresence(accountId, presence);
  }
  /** @param {string} accountId */
  listRoster(accountId) {
    return this.rosterMessaging.listRoster(accountId);
  }
  /** @param {string} accountId @param {MessageInput} input */
  sendMessage(accountId, input) {
    return this.rosterMessaging.sendMessage(accountId, input);
  }
  /** @param {string} accountId @param {ReactionSendInput} input */
  sendReaction(accountId, input) {
    return this.rosterMessaging.sendReaction(accountId, input);
  }
  /** @param {string} accountId @param {ChatStateInput} input */
  sendChatState(accountId, input) {
    return this.rosterMessaging.sendChatState(accountId, input);
  }

  /** @param {{accountId: string}} input */
  discoverStickers(input) {
    return this.stickerService.discover(input);
  }
  /** @param {StickerSendInput} input @param {StickerSourceResolver} resolveSource @param {(state: Record<string, unknown>) => void | Promise<void>} [onState] */
  sendSticker(input, resolveSource, onState) {
    return this.stickerService.send(input, resolveSource, onState);
  }
  /** @param {string} accountId @param {unknown} stanza @param {unknown} direction */
  parseStickerMessage(accountId, stanza, direction) {
    const normalizedDirection =
      direction === 'sent' || direction === 'outgoing' ? 'outgoing' : 'incoming';
    return this.stickerService.parseMessage(
      accountId,
      /** @type {XmlNode} */ (stanza),
      normalizedDirection,
    );
  }

  /** @param {string} accountId @param {string | undefined} senderJid */
  isStickerSourceAuthorized(accountId, senderJid) {
    const bareSender = this.bareJid(senderJid || '').toLowerCase();
    const contact = this.rosters.get(accountId)?.get(bareSender);
    return Boolean(contact && ['to', 'both'].includes(contact.subscription));
  }

  /** @param {string} accountId @param {FileSendInput} input */
  sendFile(accountId, input) {
    return this.fileService.sendFile(accountId, input);
  }
  /** @param {string} accountId @param {string} conversationId @param {FileServiceSession} session @param {number} generation */
  resolveFileRecipient(accountId, conversationId, session, generation) {
    return this.fileService.resolveFileRecipient(accountId, conversationId, session, generation);
  }
  /** @param {string} accountId @param {FileServiceSession} session @param {number} generation @param {FileRecord} record @param {FileXmlNode} child @param {string} phase @param {AbortSignal | undefined} signalOverride */
  requestOutgoingIq(accountId, session, generation, record, child, phase, signalOverride) {
    return this.fileService.requestOutgoingIq(
      accountId,
      session,
      generation,
      record,
      child,
      phase,
      signalOverride,
    );
  }
  /** @param {string} accountId @param {FileServiceSession} session @param {number} generation @param {FileRecord} record */
  sendOutgoingOffer(accountId, session, generation, record) {
    return this.fileService.sendOutgoingOffer(accountId, session, generation, record);
  }
  /** @param {string} accountId @param {FileServiceSession} session @param {number} generation @param {FileRecord} record @param {string} reason */
  sendOutgoingCancellationNotice(accountId, session, generation, record, reason) {
    return this.fileService.sendOutgoingCancellationNotice(
      accountId,
      session,
      generation,
      record,
      reason,
    );
  }
  /** @param {string} accountId @param {XmlNode} stanza */
  handleFileCancellationMessage(accountId, stanza) {
    return this.fileService.handleFileCancellationMessage(accountId, stanza);
  }
  /** @param {string} accountId @param {FileServiceSession} session @param {number} generation @param {FileRecord} record @param {number} blockSize */
  sendOutgoingOpen(accountId, session, generation, record, blockSize) {
    return this.fileService.sendOutgoingOpen(accountId, session, generation, record, blockSize);
  }
  /** @param {string} accountId @param {FileServiceSession} session @param {number} generation @param {FileRecord} record @param {Buffer} block @param {number} sequence */
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
  /** @param {string} accountId @param {FileServiceSession} session @param {number} generation @param {FileRecord} record @param {CloseOptions} [options] */
  sendOutgoingClose(accountId, session, generation, record, options) {
    return this.fileService.sendOutgoingClose(accountId, session, generation, record, options);
  }
  /** @param {unknown} stanza */
  isFileIq(stanza) {
    return this.fileService.isFileIq(/** @type {XmlNode} */ (stanza));
  }
  /** @param {string} accountId @param {unknown} session */
  installFileIqHandlers(accountId, session) {
    return this.fileService.installFileIqHandlers(accountId, /** @type {XmppSession} */ (session));
  }
  /** @param {FileServiceSession} session @param {FileXmlNode} request @param {FileXmlNode} response */
  observeFileIqReply(session, request, response) {
    return this.fileService.observeFileIqReply(session, request, response);
  }
  /** @param {string} accountId @param {unknown} stanza @param {unknown} [options] @returns {XmlNode | Promise<XmlNode> | undefined} */
  handleFileIq(accountId, stanza, options = {}) {
    const result = this.fileService.handleFileIq(
      accountId,
      /** @type {XmlNode} */ (stanza),
      /** @type {FileIqOptions} */ (options),
    );
    return /** @type {XmlNode | Promise<XmlNode> | undefined} */ (/** @type {unknown} */ (result));
  }
  /** @param {string} accountId @param {XmlNode} stanza */
  handleFileStanza(accountId, stanza) {
    return this.fileService.handleFileStanza(accountId, stanza);
  }

  /** @param {MucPolicy} policy */
  setMucPolicy(policy) {
    return this.mucService.setMucPolicy(policy);
  }
  /** @param {MucInput} input */
  discoverMuc(input) {
    return this.mucService.discoverMuc(input);
  }
  /** @param {MucServiceSession} session @param {string} accountId @param {(() => void) | undefined} guard */
  discoverServices(session, accountId, guard) {
    return this.mucService.discoverServices(session, accountId, guard);
  }
  /** @param {MucServiceSession} session @param {string} to */
  discoItems(session, to) {
    return this.mucService.discoItems(session, to);
  }
  /** @param {MucServiceSession} session @param {string} to */
  discoInfo(session, to) {
    return this.mucService.discoInfo(session, to);
  }
  /** @param {MucInput} input */
  joinMuc(input) {
    return this.mucService.joinMuc(input);
  }
  /** @param {MucInput} input */
  leaveMuc(input) {
    return this.mucService.leaveMuc(input);
  }
  /** @param {MucInput} input */
  sendMucMessage(input) {
    return this.mucService.sendMucMessage(input);
  }
  /** @param {MucInput & {clientMessageId: string, target: {originId?: string, stanzaIds?: Array<{id: string, by: string}>, messageId?: string}, emojis: string[]}} input */
  sendMucReaction(input) {
    return this.mucService.sendMucReaction(input);
  }
  /** @param {string} accountId @param {string} roomJid @param {string} messageId */
  resolveMucMessage(accountId, roomJid, messageId) {
    return this.mucService.resolveMucMessage(accountId, roomJid, messageId);
  }
  /** @param {unknown} input */
  applyReaction(input) {
    const {
      accountId,
      conversationId,
      target,
      emojis,
      actorJid,
      source,
      sessionGeneration,
      eventId,
    } = /** @type {ReactionInput} */ (input);
    const targetId = target?.originId || target?.stanzaIds?.[0]?.id || target?.messageId;
    if (!targetId || !actorJid) return;
    const key = `${accountId}|${source}|${conversationId.toLowerCase()}|${targetId}`;
    const eventKey = eventId
      ? `${key}|event:${eventId}`
      : `${key}|${actorJid.toLowerCase()}|${[...new Set(emojis)].sort().join('\u001f')}`;
    if (this.reactionEventKeys.has(eventKey)) return;
    this.reactionEventKeys.add(eventKey);
    if (this.reactionEventKeys.size > 4096)
      this.reactionEventKeys.delete(this.reactionEventKeys.values().next().value);
    const current = this.reactionStates.get(key) || new Map();
    const participant =
      source === 'muc'
        ? this.mucRooms
            .get(accountId)
            ?.get(conversationId.toLowerCase())
            ?.participants.get(actorJid)
        : undefined;
    current.set(actorJid.toLowerCase(), {
      id: actorJid.toLowerCase(),
      label:
        source === 'muc'
          ? participant?.nick || actorJid.split('/').slice(1).join('/') || actorJid
          : actorJid,
      ...(source === 'muc' ? { occupantJid: actorJid } : {}),
      identifiable: source === 'direct' || participant?.identityVerified === true,
      emojis: [...new Set(emojis)],
    });
    const reactions = [];
    for (const emoji of [...new Set([...current.values()].flatMap((actor) => actor.emojis))]) {
      const actors = [...current.values()]
        .filter((actor) => actor.emojis.includes(emoji))
        .map(({ emojis: _emojis, ...actor }) => actor);
      reactions.push({ emoji, actors });
    }
    this.reactionStates.set(key, current);
    this.emit({
      type: 'reaction.changed',
      correlationId: targetId,
      payload: {
        accountId,
        conversationId,
        targetMessageId: targetId,
        target,
        reactions,
        updatedAt: new Date().toISOString(),
        source,
        actorId: actorJid.toLowerCase(),
        actorEmojis: [...new Set(emojis)],
        ...(sessionGeneration ? { sessionGeneration } : {}),
      },
    });
  }
  /** @param {string} clientMessageId @param {unknown} context */
  trackReaction(clientMessageId, context) {
    const typedContext = /** @type {ReactionContext} */ (context);
    const targetId =
      typedContext.target?.originId ||
      typedContext.target?.stanzaIds?.[0]?.id ||
      typedContext.target?.messageId;
    const key = targetId
      ? `${typedContext.accountId}|${typedContext.source}|${typedContext.conversationId.toLowerCase()}|${targetId}`
      : undefined;
    const previousEmojis = key
      ? [...(this.reactionStates.get(key)?.get(typedContext.actorJid?.toLowerCase())?.emojis || [])]
      : [];
    const pending = { ...typedContext, key, previousEmojis };
    this.pendingReactions.set(clientMessageId, pending);
    if (key) this.latestReactionOperation.set(key, clientMessageId);
    setTimeout(() => {
      if (this.pendingReactions.get(clientMessageId) === pending)
        this.pendingReactions.delete(clientMessageId);
    }, 30000).unref?.();
  }
  /** @param {string} clientMessageId @param {string} [reason] */
  rejectReaction(clientMessageId, reason = 'not-acceptable') {
    const pending = this.pendingReactions.get(clientMessageId);
    if (!pending) return;
    this.pendingReactions.delete(clientMessageId);
    if (pending.key && this.latestReactionOperation.get(pending.key) === clientMessageId) {
      this.latestReactionOperation.delete(pending.key);
      this.applyReaction({
        accountId: pending.accountId,
        conversationId: pending.conversationId,
        target: pending.target,
        emojis: pending.previousEmojis,
        actorJid: pending.actorJid,
        source: pending.source,
        sessionGeneration: pending.sessionGeneration,
        eventId: `rollback:${clientMessageId}`,
      });
    }
    this.emit({
      type: 'reaction.rejected',
      correlationId: clientMessageId,
      payload: {
        accountId: pending.accountId,
        conversationId: pending.conversationId,
        targetMessageId: pending.targetMessageId,
        reason,
        message:
          'El servidor rechazó la actualización de reacciones; se restauró el estado anterior.',
      },
    });
  }
  /** @param {string} accountId @param {DiscoveredRoom} room @param {number} generation @param {string} nickname @param {string | undefined} requestId */
  createMucRoom(accountId, room, generation, nickname, requestId) {
    return this.mucService.createMucRoom(accountId, room, generation, nickname, requestId);
  }
  /** @param {unknown} record @param {string | undefined} correlationId */
  emitMucState(record, correlationId) {
    return this.mucService.emitMucState(
      /** @type {MucRoomRecord} */ (/** @type {unknown} */ (record)),
      correlationId,
    );
  }
  /** @param {unknown} record @param {MucParticipant} participant @param {string | undefined} correlationId */
  emitMucParticipant(record, participant, correlationId) {
    return this.mucService.emitMucParticipant(
      /** @type {MucRoomRecord} */ (/** @type {unknown} */ (record)),
      participant,
      correlationId,
    );
  }
  /** @param {string} accountId @param {string} service @param {unknown} endpoint */
  mucPolicyKey(accountId, service, endpoint) {
    return this.mucService.mucPolicyKey(accountId, service, endpoint);
  }
  /** @param {string} accountId @param {unknown} session @param {number} generation @param {string} domain */
  assertSessionCurrent(accountId, session, generation, domain) {
    return this.mucService.assertSessionCurrent(
      accountId,
      /** @type {MucServiceSession} */ (session),
      generation,
      domain,
    );
  }
  /** @param {MucInput} input */
  assertMucRequest(input) {
    return this.mucService.assertMucRequest(input);
  }
  /** @param {unknown} value */
  validateRoomJid(value) {
    return this.mucService.validateRoomJid(value);
  }
  /** @param {unknown} value */
  validateNickname(value) {
    return this.mucService.validateNickname(value);
  }
  /** @template T @param {Promise<T>} promise @param {number} milliseconds @param {string} code @param {string} message @returns {Promise<T>} */
  withTimeout(promise, milliseconds, code, message) {
    return this.mucService.withTimeout(promise, milliseconds, code, message);
  }
  /** @param {string} accountId */
  clearMucRooms(accountId) {
    return this.mucService.clearMucRooms(accountId);
  }
  /** @param {unknown} record @param {unknown} error */
  failMucRoom(record, error) {
    return this.mucService.failMucRoom(
      /** @type {MucRoomRecord} */ (/** @type {unknown} */ (record)),
      error,
    );
  }
  /** @param {string} accountId @param {XmlNode} stanza */
  handleMucStanza(accountId, stanza) {
    return this.mucService.handleMucStanza(accountId, stanza);
  }
  /** @param {string} accountId @param {XmlNode} stanza */
  handleMucPresence(accountId, stanza) {
    return this.mucService.handleMucPresence(accountId, stanza);
  }
  /** @param {string} accountId @param {XmlNode} stanza */
  handleMucMessage(accountId, stanza) {
    return this.mucService.handleMucMessage(accountId, stanza);
  }
  /** @param {unknown} value */
  mucRole(value) {
    return this.mucService.mucRole(value);
  }
  /** @param {unknown} value */
  mucAffiliation(value) {
    return this.mucService.mucAffiliation(value);
  }
  /** @param {XmlNode | undefined} condition */
  mucConditionCode(condition) {
    return this.mucService.mucConditionCode(condition);
  }

  /** @param {string} accountId @param {unknown} stanza */
  handleStanza(accountId, stanza) {
    const typedStanza = /** @type {XmlNode} */ (stanza);
    this.fileService.traceStanza(accountId, typedStanza);
    if (
      this.fileIqHandled.has(typedStanza) ||
      (this.sessions.get(accountId)?.iqCallee && this.isFileIq(typedStanza))
    )
      return;
    if (this.handleMucStanza(accountId, typedStanza)) return;
    if (this.handleFileStanza(accountId, typedStanza)) return;
    if (typedStanza.is('message') && this.handleFileCancellationMessage(accountId, typedStanza))
      return;
    if (typedStanza.is('message') && this.carbons.handleMessage(accountId, typedStanza)) return;
    if (typedStanza.is('message') && this.stickerService.handleMessage(accountId, typedStanza))
      return;
    if (typedStanza.is('presence')) {
      this.rosterMessaging.handlePresence(accountId, typedStanza);
      return;
    }
    if (typedStanza.is('message')) this.rosterMessaging.handleMessage(accountId, typedStanza);
  }
}

module.exports = { XmppAdapter, negotiateStartTls };
