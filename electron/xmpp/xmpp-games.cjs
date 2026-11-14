const crypto = require('node:crypto');
const xmppClient = require('@xmpp/client');
const { CARBONS_NS, FORWARD_NS } = require('./xmpp-carbons.cjs');
const { DEFAULT_GAME_LIMITS, normalizeGameLimits } = require('../games/game-limits.cjs');

/** @typedef {Error & {code: string, details?: unknown}} CodedError */
/** @typedef {{[key: string]: string | undefined}} XmlAttributes */
/** @typedef {{name?: string, attrs?: XmlAttributes, children?: Array<XmlNode | string>, getChild: (name: string, namespace?: string) => XmlNode | undefined, getChildren?: (name: string, namespace?: string) => XmlNode[], getText?: () => string | undefined, is?: (name: string) => boolean}} XmlNode */
/** @typedef {{send: (stanza: XmlNode) => Promise<unknown>}} XmppSession */
/** @typedef {{accountId: string, sessionId: string, conversationId: string, peerBareJid: string, gameId: string, gameVersion: string, localRole: 'initiator' | 'responder', state: string, revision: number, stateHash: string, sessionGeneration: number}} GameSession */
/** @typedef {{sessionId: string, state: unknown, revision: number, stateHash: string}} GameSnapshot */
/** @typedef {{eventId: string, sessionId: string, actor: 'initiator' | 'responder', actorSeq: number, expectedRevision: number, previousStateHash: string, move: unknown}} GameProposal */
/** @typedef {GameProposal & {sequencer: 'initiator', revision: number, resultingStateHash: string}} GameSequencedEvent */
/** @typedef {{kind: string, eventId: string, sessionId: string, apiVersion: number, connectionGeneration: number, from: string, fromBare: string, to: string, conversationId: string, gameId: string, gameVersion: string, actor: 'initiator' | 'responder', actorSeq: number, revision: number, expectedRevision: number, previousStateHash: string, resultingStateHash: string, stateHash: string, correlationId: string, errorCode: string, move: unknown, state: unknown}} GameEvent */
/** @typedef {{kind: string, proposal: GameProposal, event: GameSequencedEvent, session: GameSession, snapshot: GameSnapshot}} GameApplication */
/** @typedef {{accountId: string, sessionId: string, expectedGeneration: number}} SessionInput */
/** @typedef {{accountId: string, conversationId: string, peerBareJid: string, gameId: string, gameVersion: string, localRole: 'initiator' | 'responder', sessionId?: string}} CreateSessionInput */
/** @typedef {{initialState: () => unknown, hashState: (state: unknown) => string}} GameRules */
/** @typedef {{getDescriptor: (gameId?: string, gameVersion?: string) => object | undefined, getRules: (gameId: string, gameVersion: string) => GameRules | undefined}} GameRegistry */
/** @typedef {{create: (input: CreateSessionInput) => GameSession, getSession: (accountId: string, sessionId: string) => GameSession | undefined, listSessions: (accountId: string) => GameSession[], recover: (accountId: string) => Array<{session: GameSession, snapshot: GameSnapshot}>, accept: (input: SessionInput) => GameSession, reject: (input: SessionInput) => GameSession, cancel: (input: SessionInput) => GameSession, start: (input: SessionInput) => GameSession, finish: (input: SessionInput) => GameSession, abandon: (input: SessionInput) => GameSession, close: (input: SessionInput) => GameSession, pause: (input: SessionInput) => GameSession, requireResync: (input: SessionInput) => GameSession, submitProposal: (input: SessionInput & {actor: 'initiator' | 'responder', move: unknown, eventId: string, actorSeq?: number}) => GameApplication, acceptProposal: (input: SessionInput & {proposal: GameProposal}) => GameApplication, acceptSequencedEvent: (input: SessionInput & {event: GameSequencedEvent}) => GameApplication}} GameManager */
/** @typedef {{sessionGenerations: Map<string, number>, requireConnected: (accountId: string) => XmppSession, bareJid: (jid: string) => string, emit: (event: unknown) => void}} GamesAdapter */
/** @typedef {{manager?: GameManager, registry?: GameRegistry, idFactory?: () => string, limits?: object}} GamesOptions */

const GAME_NAMESPACE = 'urn:atomic-chat:games:1';
const GAME_API_VERSION = 1;
const GAME_FEATURE = GAME_NAMESPACE;
const MAX_GAME_PAYLOAD_BYTES = 65536;
const MAX_GAME_FIELD_LENGTH = 512;
const MAX_GAME_STATE_BYTES = 262144;
const GAME_EVENT_KINDS = Object.freeze([
  'invite',
  'accept',
  'reject',
  'cancel',
  'start',
  'move',
  'move-ack',
  'finish',
  'resign',
  'close',
  'rematch',
  'state.request',
  'state.response',
  'error',
]);
const GAME_EVENT_SET = new Set(GAME_EVENT_KINDS);
const xml =
  /** @type {(name: string, ...children: Array<Record<string, string> | XmlNode | string | undefined>) => XmlNode} */ (
    xmppClient.xml
  );

/** @param {string} code @param {string} [message] @param {unknown} [details] @returns {CodedError} */
function transportError(code, message = code, details) {
  const error = /** @type {CodedError} */ (new Error(message));
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

/** @param {unknown} value @param {string} name @param {boolean} [required] @returns {string | undefined} */
function textAttribute(value, name, required = true) {
  if (value === undefined || value === null || value === '') {
    if (required) throw transportError('GAME_TRANSPORT_INVALID_EVENT', `${name} is required`);
    return undefined;
  }
  if (typeof value !== 'string' || value.length > MAX_GAME_FIELD_LENGTH)
    throw transportError('GAME_TRANSPORT_FIELD_TOO_LARGE', `${name} is too long`);
  return value;
}

/** @param {unknown} value @param {string} name @param {boolean} [required] @returns {number | undefined} */
function positiveInteger(value, name, required = true) {
  if (value === undefined || value === null || value === '') {
    if (required) throw transportError('GAME_TRANSPORT_INVALID_EVENT', `${name} is required`);
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw transportError('GAME_TRANSPORT_INVALID_EVENT', `${name} is invalid`);
  return parsed;
}

/** @param {unknown} value @param {string} name @param {boolean} [required] @returns {number | undefined} */
function nonNegativeInteger(value, name, required = true) {
  if (value === undefined || value === null || value === '') {
    if (required) throw transportError('GAME_TRANSPORT_INVALID_EVENT', `${name} is required`);
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw transportError('GAME_TRANSPORT_INVALID_EVENT', `${name} is invalid`);
  return parsed;
}

/** @param {unknown} value @param {string} name @param {number} maxBytes @returns {string} */
function jsonText(value, name, maxBytes) {
  let text;
  try {
    text = JSON.stringify(value);
  } catch {
    throw transportError('GAME_TRANSPORT_INVALID_PAYLOAD', `${name} is not serializable`);
  }
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > maxBytes)
    throw transportError('GAME_TRANSPORT_PAYLOAD_TOO_LARGE', `${name} exceeds its size limit`);
  return text;
}

/** @param {string | undefined} text @param {string} name @param {number} maxBytes @returns {unknown} */
function parseJson(text, name, maxBytes) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > maxBytes)
    throw transportError('GAME_TRANSPORT_PAYLOAD_TOO_LARGE', `${name} exceeds its size limit`);
  try {
    return JSON.parse(text);
  } catch {
    throw transportError('GAME_TRANSPORT_INVALID_PAYLOAD', `${name} is malformed`);
  }
}

/** @param {unknown} error @param {string} fallback @returns {string} */
function errorCodeOf(error, fallback) {
  return error && typeof error === 'object' && 'code' in error && typeof error.code === 'string'
    ? error.code
    : fallback;
}

/** @param {GameEvent} event @returns {string} */
function eventFingerprint(event) {
  return JSON.stringify({
    kind: event.kind,
    sessionId: event.sessionId,
    actor: event.actor,
    actorSeq: event.actorSeq,
    revision: event.revision,
    expectedRevision: event.expectedRevision,
    previousStateHash: event.previousStateHash,
    resultingStateHash: event.resultingStateHash,
    gameId: event.gameId,
    gameVersion: event.gameVersion,
    correlationId: event.correlationId,
    move: event.move,
  });
}

/** @param {XmlNode} stanza @returns {XmlNode | null | undefined} */
function gameChildFromStanza(stanza) {
  const namespaced = stanza.getChild('game', GAME_NAMESPACE);
  if (namespaced) return namespaced;
  const candidate = stanza.getChild('game');
  if (candidate)
    throw transportError('GAME_TRANSPORT_NAMESPACE_UNSUPPORTED', 'Game namespace is unsupported');
  const received = stanza.getChild('received', CARBONS_NS);
  const sent = stanza.getChild('sent', CARBONS_NS);
  const wrapper = received || sent;
  const forwarded = wrapper?.getChild('forwarded', FORWARD_NS);
  const original = forwarded?.getChild('message', 'jabber:client');
  if (original?.getChild('game', GAME_NAMESPACE) || original?.getChild('game')) return null;
  return undefined;
}

/** @param {XmlNode} game @param {string} kind @returns {void} */
function validateGameChildren(game, kind) {
  const allowed =
    kind === 'move'
      ? new Set(['move'])
      : kind === 'state.response'
        ? new Set(['state'])
        : new Set();
  for (const child of game.children || []) {
    if (typeof child === 'string') {
      if (child.trim())
        throw transportError('GAME_TRANSPORT_UNKNOWN_CHILD', 'Game payload contains unknown text');
      continue;
    }
    if (!child.name || !allowed.has(child.name))
      throw transportError(
        'GAME_TRANSPORT_UNKNOWN_CHILD',
        'Game payload contains an unknown child',
      );
  }
}

/** @param {XmlNode} stanza @param {string} accountId @param {number} currentGeneration @param {(jid: string) => string} bareJid @returns {GameEvent | undefined} */
function parseGameEvent(stanza, accountId, currentGeneration, bareJid) {
  if (!stanza?.is?.('message')) return undefined;
  const game = gameChildFromStanza(stanza);
  if (game === undefined) return undefined;
  if (game === null)
    throw transportError(
      'GAME_TRANSPORT_CARBON_IGNORED',
      'Carbon game events are not applied twice',
    );
  if (stanza.attrs?.['type'] === 'groupchat')
    throw transportError('GAME_TRANSPORT_MUC_REJECTED', 'Game events require direct chat');
  const from = textAttribute(stanza.attrs?.['from'], 'from');
  const to = textAttribute(stanza.attrs?.['to'], 'to');
  if (!from || !to)
    throw transportError('GAME_TRANSPORT_INVALID_EVENT', 'Stanza identity is incomplete');
  const fromBare = bareJid(from).toLowerCase();
  const localBare = bareJid(accountId).toLowerCase();
  if (fromBare === localBare || bareJid(to).toLowerCase() !== localBare)
    throw transportError(
      'GAME_TRANSPORT_PEER_REJECTED',
      'Stanza identity does not match the local account',
    );
  const attrs = game.attrs || {};
  if (attrs['xmlns'] !== GAME_NAMESPACE)
    throw transportError('GAME_TRANSPORT_NAMESPACE_UNSUPPORTED', 'Game namespace is unsupported');
  const kind = textAttribute(attrs['kind'], 'kind');
  if (!kind) throw transportError('GAME_TRANSPORT_INVALID_EVENT', 'Event kind is missing');
  if (!GAME_EVENT_SET.has(kind))
    throw transportError('GAME_TRANSPORT_EVENT_UNSUPPORTED', 'Game event kind is unsupported');
  validateGameChildren(game, kind);
  const eventId = textAttribute(attrs['event-id'], 'eventId');
  const sessionId = textAttribute(attrs['session-id'], 'sessionId');
  const apiVersion = Number(attrs['api-version']);
  if (apiVersion !== GAME_API_VERSION)
    throw transportError('GAME_TRANSPORT_VERSION_UNSUPPORTED', 'Game API version is unsupported');
  const connectionGeneration = positiveInteger(
    attrs['connection-generation'],
    'connectionGeneration',
  );
  // This is the sender's local generation. The receiver has an independent
  // counter, so comparing it with currentGeneration would reject valid peers.
  // Local freshness is enforced by XmppAdapter's current-session stanza guard;
  // session identity, peer identity, revision and hash checks remain required.
  if (!Number.isSafeInteger(currentGeneration) || currentGeneration < 1)
    throw transportError('GAME_TRANSPORT_GENERATION_STALE', 'Local connection is not current');
  const conversationId = textAttribute(attrs['conversation-id'], 'conversationId');
  if (!conversationId)
    throw transportError('GAME_TRANSPORT_INVALID_EVENT', 'Conversation is missing');
  if (bareJid(conversationId).toLowerCase() !== localBare)
    throw transportError(
      'GAME_TRANSPORT_CONVERSATION_REJECTED',
      'Conversation does not match the sender',
    );
  const event = /** @type {GameEvent} */ ({
    kind,
    eventId,
    sessionId,
    apiVersion,
    connectionGeneration,
    from,
    fromBare,
    to,
    conversationId: bareJid(conversationId),
    gameId: textAttribute(attrs['game-id'], 'gameId', kind === 'invite' || kind === 'rematch'),
    gameVersion: textAttribute(
      attrs['game-version'],
      'gameVersion',
      kind === 'invite' || kind === 'rematch',
    ),
    actor: textAttribute(attrs['actor'], 'actor', false),
    actorSeq: positiveInteger(attrs['actor-seq'], 'actorSeq', false),
    revision: ['state.request', 'state.response'].includes(kind)
      ? nonNegativeInteger(attrs['revision'], 'revision', false)
      : positiveInteger(attrs['revision'], 'revision', false),
    expectedRevision: nonNegativeInteger(attrs['expected-revision'], 'expectedRevision', false),
    previousStateHash: textAttribute(attrs['previous-state-hash'], 'previousStateHash', false),
    resultingStateHash: textAttribute(attrs['resulting-state-hash'], 'resultingStateHash', false),
    stateHash: textAttribute(attrs['state-hash'], 'stateHash', false),
    correlationId: textAttribute(attrs['correlation-id'], 'correlationId', false),
    errorCode: textAttribute(attrs['error-code'], 'errorCode', false),
  });
  if (event.actor && !['initiator', 'responder'].includes(event.actor))
    throw transportError('GAME_TRANSPORT_INVALID_ACTOR', 'Actor is invalid');
  if (kind === 'move') {
    const moveNode = game.getChild('move');
    const moveText = moveNode?.getText?.();
    if (!moveNode || moveNode.attrs?.['format'] !== 'json')
      throw transportError('GAME_TRANSPORT_INVALID_PAYLOAD', 'Move payload format is unsupported');
    event.move = parseJson(moveText, 'move', MAX_GAME_PAYLOAD_BYTES);
    if (
      !event.actor ||
      !event.actorSeq ||
      event.expectedRevision === undefined ||
      !event.previousStateHash
    )
      throw transportError('GAME_TRANSPORT_INVALID_EVENT', 'Move proposal fields are incomplete');
    const hasRevision = event.revision !== undefined;
    if (hasRevision && !event.resultingStateHash)
      throw transportError('GAME_TRANSPORT_INVALID_EVENT', 'Sequenced move hash is missing');
  } else if (kind === 'move-ack') {
    if (!event.actorSeq || event.revision === undefined || !event.resultingStateHash)
      throw transportError(
        'GAME_TRANSPORT_INVALID_EVENT',
        'Move acknowledgement fields are incomplete',
      );
  } else if (kind === 'state.request') {
    if (event.revision === undefined || !event.stateHash)
      throw transportError('GAME_TRANSPORT_INVALID_EVENT', 'State request fields are incomplete');
  } else if (kind === 'state.response') {
    const stateNode = game.getChild('state');
    if (
      !stateNode ||
      stateNode.attrs?.['format'] !== 'json' ||
      event.revision === undefined ||
      !event.stateHash
    )
      throw transportError('GAME_TRANSPORT_INVALID_EVENT', 'State response fields are incomplete');
    event.state = parseJson(stateNode.getText?.(), 'state', MAX_GAME_STATE_BYTES);
  } else if (kind === 'error' && !event.errorCode) {
    throw transportError('GAME_TRANSPORT_INVALID_EVENT', 'Error code is missing');
  }
  return event;
}

/** @param {GameEvent} event @returns {XmlNode} */
function createGameElement(event) {
  const attrs = {
    xmlns: GAME_NAMESPACE,
    kind: event.kind,
    'event-id': event.eventId,
    'session-id': event.sessionId,
    'api-version': String(GAME_API_VERSION),
    'connection-generation': String(event.connectionGeneration),
    'conversation-id': event.conversationId,
    ...(event.gameId ? { 'game-id': event.gameId } : {}),
    ...(event.gameVersion ? { 'game-version': event.gameVersion } : {}),
    ...(event.actor ? { actor: event.actor } : {}),
    ...(event.actorSeq !== undefined ? { 'actor-seq': String(event.actorSeq) } : {}),
    ...(event.revision !== undefined ? { revision: String(event.revision) } : {}),
    ...(event.expectedRevision !== undefined
      ? { 'expected-revision': String(event.expectedRevision) }
      : {}),
    ...(event.previousStateHash ? { 'previous-state-hash': event.previousStateHash } : {}),
    ...(event.resultingStateHash ? { 'resulting-state-hash': event.resultingStateHash } : {}),
    ...(event.stateHash ? { 'state-hash': event.stateHash } : {}),
    ...(event.correlationId ? { 'correlation-id': event.correlationId } : {}),
    ...(event.errorCode ? { 'error-code': event.errorCode } : {}),
  };
  const children = [];
  if (event.move !== undefined)
    children.push(
      xml('move', { format: 'json' }, jsonText(event.move, 'move', MAX_GAME_PAYLOAD_BYTES)),
    );
  if (event.state !== undefined)
    children.push(
      xml('state', { format: 'json' }, jsonText(event.state, 'state', MAX_GAME_STATE_BYTES)),
    );
  return xml('game', attrs, ...children);
}

/** @param {GamesAdapter} adapter @param {GamesOptions} [options] */
function createXmppGames(adapter, options = {}) {
  const manager = /** @type {GameManager} */ (options.manager || null);
  const registry = /** @type {GameRegistry} */ (options.registry || null);
  const idFactory = options.idFactory || (() => crypto.randomUUID());
  const limits = normalizeGameLimits(options.limits || DEFAULT_GAME_LIMITS);
  const pendingAcks = /** @type {Map<string, ReturnType<typeof setTimeout>>} */ (new Map());
  const stateRequests = /** @type {Map<string, ReturnType<typeof setTimeout>>} */ (new Map());
  const seenEvents = new Map();
  const rateWindows = new Map();
  const timers = new Set();
  let disposed = false;

  /** @returns {void} */
  function assertReady() {
    if (disposed) throw transportError('GAME_TRANSPORT_DISPOSED', 'Game transport is disposed');
    if (!manager || !registry)
      throw transportError('GAME_TRANSPORT_UNAVAILABLE', 'Game transport is unavailable');
  }

  /** @param {string} accountId @returns {number} */
  function generationFor(accountId) {
    const generation = adapter.sessionGenerations.get(accountId);
    if (generation === undefined || !Number.isSafeInteger(generation) || generation < 1)
      throw transportError('GAME_TRANSPORT_NOT_CONNECTED', 'No active XMPP generation exists');
    return generation;
  }

  /** @param {string} accountId @param {string} sessionId @param {string} fromBare @returns {GameSession} */
  function sessionFor(accountId, sessionId, fromBare) {
    const session = manager.getSession(accountId, sessionId);
    if (!session)
      throw transportError('GAME_TRANSPORT_SESSION_UNKNOWN', 'Game session does not exist');
    if (session.peerBareJid.toLowerCase() !== fromBare.toLowerCase())
      throw transportError('GAME_TRANSPORT_PEER_REJECTED', 'Game peer does not match the session');
    return session;
  }

  /** @param {GameSession} session @returns {{gameId: string, gameVersion: string, conversationId: string}} */
  function gameDetails(session) {
    return /** @type {GameEvent} */ ({
      gameId: session.gameId,
      gameVersion: session.gameVersion,
      conversationId: session.conversationId,
    });
  }

  /** @param {string} type @param {unknown} payload @param {string | undefined} [correlationId] @returns {void} */
  function emit(type, payload, correlationId) {
    adapter.emit({ type, ...(correlationId ? { correlationId } : {}), payload });
  }

  /** @param {string} accountId @param {string} peerBareJid @param {string} sessionId @param {string} kind */
  function rateKey(accountId, peerBareJid, sessionId, kind) {
    return `${accountId}|${peerBareJid.toLowerCase()}|${sessionId}|${kind}`;
  }

  /** @param {string} accountId @param {string} peerBareJid @param {string} sessionId @param {string} kind */
  function consumeRate(accountId, peerBareJid, sessionId, kind) {
    const now = Date.now();
    const accountPrefix = `${accountId}|`;
    for (const [key, window] of rateWindows) {
      if (window.expiresAt <= now) rateWindows.delete(key);
    }
    const key = rateKey(accountId, peerBareJid, sessionId, kind);
    let window = rateWindows.get(key);
    if (!window || window.expiresAt <= now) {
      if (
        !window &&
        [...rateWindows.keys()].filter((entry) => entry.startsWith(accountPrefix)).length >=
          limits.maxRateScopesPerAccount
      )
        throw transportError('GAME_TRANSPORT_RATE_LIMITED', 'Too many game rate scopes are active');
      window = { startedAt: now, expiresAt: now + limits.eventWindowMs, count: 0 };
      rateWindows.set(key, window);
    }
    if (window.count >= limits.maxEventsPerWindow)
      throw transportError('GAME_TRANSPORT_RATE_LIMITED', 'Game event rate limit exceeded', {
        limit: limits.maxEventsPerWindow,
        windowMs: limits.eventWindowMs,
      });
    window.count += 1;
  }

  /** @param {Map<string, unknown>} map @param {string} accountId @param {string} sessionId @param {number} limit */
  function assertPendingCapacity(map, accountId, sessionId, limit) {
    const prefix = `${accountId}|${sessionId}|`;
    let count = 0;
    for (const key of map.keys()) if (key.startsWith(prefix)) count += 1;
    if (count >= limit)
      throw transportError('GAME_TRANSPORT_PENDING_LIMIT', 'Too many pending game requests', {
        limit,
      });
  }

  /** @param {GameEvent} event @param {string} accountId @returns {boolean} */
  function remember(event, accountId) {
    const scopeKey = `${accountId}|${event.sessionId}`;
    const key = `${event.kind}|${event.eventId}`;
    const fingerprint = eventFingerprint(event);
    let scope = seenEvents.get(scopeKey);
    if (!scope) {
      scope = new Map();
      seenEvents.set(scopeKey, scope);
    }
    const previous = scope.get(key);
    if (previous) {
      if (previous !== fingerprint)
        throw transportError(
          'GAME_TRANSPORT_EVENT_CONFLICT',
          'Event ID was reused with different content',
        );
      return false;
    }
    scope.set(key, fingerprint);
    while (scope.size > limits.maxSeenEventsPerSession) scope.delete(scope.keys().next().value);
    return true;
  }

  /** @param {Map<string, unknown>} map @param {string} key @param {string} code @param {object} payload */
  function schedule(map, key, code, payload) {
    const timer = setTimeout(() => {
      map.delete(key);
      timers.delete(timer);
      emit('game.transportError', { ...payload, code });
    }, 30000);
    timer.unref?.();
    timers.add(timer);
    map.set(key, timer);
  }

  /** @param {Map<string, ReturnType<typeof setTimeout>>} map @param {string} key */
  function clearPending(map, key) {
    const timer = map.get(key);
    if (!timer) return;
    clearTimeout(timer);
    timers.delete(timer);
    map.delete(key);
  }

  /** @param {string} accountId @param {GameEvent} event @param {string} to @returns {Promise<{kind: string, eventId: string | undefined, stanza: XmlNode}>} */
  async function sendEvent(accountId, event, to, rateAlreadyConsumed = false) {
    assertReady();
    if (!rateAlreadyConsumed) consumeRate(accountId, to, event.sessionId, `out:${event.kind}`);
    const session = adapter.requireConnected(accountId);
    const stanza = xml(
      'message',
      { type: 'chat', to },
      createGameElement({ ...event, connectionGeneration: generationFor(accountId) }),
    );
    await session.send(stanza);
    return { kind: 'sent', eventId: event.eventId, stanza };
  }

  /** @param {string} accountId @param {GameSession} session @param {string} kind @param {Partial<GameEvent>} [extra] @returns {GameEvent} */
  function baseEvent(accountId, session, kind, extra = {}) {
    return /** @type {GameEvent} */ ({
      kind,
      eventId: extra.eventId || idFactory(),
      sessionId: session.sessionId,
      ...gameDetails(session),
      ...extra,
      connectionGeneration: generationFor(accountId),
    });
  }

  /** @param {string} accountId @param {string} sessionId @param {string | undefined} correlationId */
  async function sendInvite(accountId, sessionId, correlationId) {
    assertReady();
    const session = manager.getSession(accountId, sessionId);
    if (!session)
      throw transportError('GAME_TRANSPORT_SESSION_UNKNOWN', 'Game session does not exist');
    if (session.localRole !== 'initiator')
      throw transportError(
        'GAME_TRANSPORT_ROLE_REJECTED',
        'Only the initiator sends an invitation',
      );
    return sendEvent(
      accountId,
      baseEvent(accountId, session, 'invite', { correlationId: correlationId || idFactory() }),
      session.peerBareJid,
    );
  }

  /** @param {string} accountId @param {string} sessionId @param {string} kind @param {'accept' | 'reject' | 'cancel' | 'start' | 'finish' | 'abandon' | 'close'} method @param {string | undefined} correlationId */
  async function sendControl(accountId, sessionId, kind, method, correlationId) {
    assertReady();
    const session = manager.getSession(accountId, sessionId);
    if (!session)
      throw transportError('GAME_TRANSPORT_SESSION_UNKNOWN', 'Game session does not exist');
    consumeRate(accountId, session.peerBareJid, session.sessionId, `out:${kind}`);
    const updated = manager[method]({
      accountId,
      sessionId,
      expectedGeneration: session.sessionGeneration,
    });
    return sendEvent(
      accountId,
      baseEvent(accountId, updated, kind, { correlationId: correlationId || idFactory() }),
      updated.peerBareJid,
    );
  }

  /** @param {string} accountId @param {{sessionId: string, actor: 'initiator' | 'responder', move: unknown, eventId?: string, actorSeq?: number, correlationId?: string}} input */
  async function sendMove(accountId, input) {
    assertReady();
    const session = manager.getSession(accountId, input.sessionId);
    if (!session)
      throw transportError('GAME_TRANSPORT_SESSION_UNKNOWN', 'Game session does not exist');
    assertPendingCapacity(
      pendingAcks,
      accountId,
      session.sessionId,
      limits.maxPendingAcksPerSession,
    );
    consumeRate(accountId, session.peerBareJid, session.sessionId, 'out:move');
    const application = manager.submitProposal({
      accountId,
      ...input,
      expectedGeneration: session.sessionGeneration,
      eventId: input.eventId || idFactory(),
    });
    const proposal = /** @type {GameProposal | GameSequencedEvent} */ (
      application.kind === 'proposal-pending' ? application.proposal : application.event
    );
    const event = baseEvent(accountId, session, 'move', {
      eventId: proposal.eventId,
      actor: proposal.actor,
      actorSeq: proposal.actorSeq,
      expectedRevision: proposal.expectedRevision,
      previousStateHash: proposal.previousStateHash,
      move: proposal.move,
      ...(application.kind === 'applied'
        ? {
            revision: application.event.revision,
            resultingStateHash: application.event.resultingStateHash,
          }
        : {}),
      correlationId: input.correlationId || proposal.eventId,
    });
    const key = `${accountId}|${session.sessionId}|${proposal.eventId}`;
    schedule(pendingAcks, key, 'GAME_MOVE_ACK_TIMEOUT', {
      accountId,
      sessionId: session.sessionId,
      eventId: proposal.eventId,
    });
    let result;
    try {
      result = await sendEvent(accountId, event, session.peerBareJid, true);
    } catch (error) {
      clearPending(pendingAcks, key);
      throw error;
    }
    if (application.kind === 'applied')
      emit(
        'game.moveAccepted',
        {
          accountId,
          sessionId: session.sessionId,
          revision: application.session.revision,
          eventId: proposal.eventId,
        },
        event.correlationId,
      );
    return { ...result, application };
  }

  /** @param {string} accountId @param {string} sessionId @param {string | undefined} correlationId */
  async function sendStateRequest(accountId, sessionId, correlationId) {
    assertReady();
    const session = manager.getSession(accountId, sessionId);
    if (!session)
      throw transportError('GAME_TRANSPORT_SESSION_UNKNOWN', 'Game session does not exist');
    const snapshot = manager
      .recover(accountId)
      .find((entry) => entry.session.sessionId === sessionId)?.snapshot;
    if (!snapshot)
      throw transportError('GAME_TRANSPORT_SNAPSHOT_UNKNOWN', 'Game snapshot does not exist');
    assertPendingCapacity(
      stateRequests,
      accountId,
      session.sessionId,
      limits.maxStateRequestsPerSession,
    );
    consumeRate(accountId, session.peerBareJid, session.sessionId, 'out:state.request');
    const event = baseEvent(accountId, session, 'state.request', {
      revision: snapshot.revision,
      stateHash: snapshot.stateHash,
      correlationId: correlationId || idFactory(),
    });
    const key = `${accountId}|${sessionId}|${event.correlationId}`;
    schedule(stateRequests, key, 'GAME_STATE_RESPONSE_TIMEOUT', {
      accountId,
      sessionId,
      correlationId: event.correlationId,
    });
    try {
      return await sendEvent(accountId, event, session.peerBareJid, true);
    } catch (error) {
      clearPending(stateRequests, key);
      throw error;
    }
  }

  /** @param {GameEvent} event @param {GameSession} session */
  function validateStateHash(event, session) {
    const rules = registry.getRules(session.gameId, session.gameVersion);
    if (!rules)
      throw transportError('GAME_TRANSPORT_GAME_UNAVAILABLE', 'Game rules are unavailable');
    let hash;
    try {
      hash = rules.hashState(event.state);
    } catch {
      throw transportError('GAME_TRANSPORT_INVALID_STATE', 'State cannot be reproduced');
    }
    if (hash !== event.stateHash)
      throw transportError('GAME_TRANSPORT_HASH_MISMATCH', 'State hash is not reproducible');
  }

  /** @param {string} accountId @param {GameEvent | undefined} event @param {unknown} error */
  function emitTransportError(accountId, event, error) {
    emit(
      'game.transportError',
      {
        accountId,
        sessionId: event?.sessionId,
        eventId: event?.eventId,
        from: event?.fromBare,
        code: errorCodeOf(error, 'GAME_TRANSPORT_INVALID_EVENT'),
      },
      event?.correlationId,
    );
  }

  /** @param {string} accountId @param {GameEvent} event @returns {Promise<void>} */
  async function dispatch(accountId, event) {
    assertReady();
    if (!remember(event, accountId)) {
      emit(
        'game.eventDuplicate',
        { accountId, sessionId: event.sessionId, eventId: event.eventId },
        event.correlationId,
      );
      return;
    }
    consumeRate(accountId, event.fromBare, event.sessionId, `in:${event.kind}`);
    if (event.kind === 'invite') {
      const existing = manager.getSession(accountId, event.sessionId);
      if (existing) {
        sessionFor(accountId, event.sessionId, event.fromBare);
        if (existing.gameId !== event.gameId || existing.gameVersion !== event.gameVersion)
          throw transportError(
            'GAME_TRANSPORT_GAME_CONFLICT',
            'Invitation game does not match the session',
          );
        emit(
          'game.invitationUpdated',
          { accountId, sessionId: event.sessionId, state: existing.state },
          event.correlationId,
        );
        return;
      }
      const descriptor = registry.getDescriptor(event.gameId, event.gameVersion);
      if (!descriptor)
        throw transportError('GAME_TRANSPORT_GAME_UNAVAILABLE', 'Game version is unavailable');
      const created = manager.create({
        accountId,
        conversationId: event.fromBare,
        peerBareJid: event.fromBare,
        gameId: event.gameId,
        gameVersion: event.gameVersion,
        localRole: 'responder',
        sessionId: event.sessionId,
      });
      emit('game.invitationReceived', { accountId, session: created }, event.correlationId);
      return;
    }
    if (event.kind === 'rematch') {
      const descriptor = registry.getDescriptor(event.gameId, event.gameVersion);
      if (!descriptor)
        throw transportError('GAME_TRANSPORT_GAME_UNAVAILABLE', 'Game version is unavailable');
      const rematch = manager.getSession(accountId, event.sessionId);
      if (rematch) {
        sessionFor(accountId, event.sessionId, event.fromBare);
        emit(
          'game.invitationUpdated',
          { accountId, sessionId: event.sessionId, state: rematch.state },
          event.correlationId,
        );
        return;
      }
      const created = manager.create({
        accountId,
        conversationId: event.fromBare,
        peerBareJid: event.fromBare,
        gameId: event.gameId,
        gameVersion: event.gameVersion,
        localRole: 'responder',
        sessionId: event.sessionId,
      });
      emit('game.invitationReceived', { accountId, session: created }, event.correlationId);
      return;
    }
    const session = sessionFor(accountId, event.sessionId, event.fromBare);
    if (
      event.gameId &&
      (event.gameId !== session.gameId || event.gameVersion !== session.gameVersion)
    )
      throw transportError(
        'GAME_TRANSPORT_GAME_CONFLICT',
        'Game identity does not match the session',
      );
    const expectedGeneration = session.sessionGeneration;
    if (event.kind === 'accept') {
      const updated = manager.accept({
        accountId,
        sessionId: session.sessionId,
        expectedGeneration,
      });
      emit('game.sessionChanged', { accountId, session: updated }, event.correlationId);
    } else if (event.kind === 'reject') {
      const updated = manager.reject({
        accountId,
        sessionId: session.sessionId,
        expectedGeneration,
      });
      emit('game.sessionChanged', { accountId, session: updated }, event.correlationId);
    } else if (event.kind === 'cancel') {
      const updated = manager.cancel({
        accountId,
        sessionId: session.sessionId,
        expectedGeneration,
      });
      emit('game.sessionChanged', { accountId, session: updated }, event.correlationId);
    } else if (event.kind === 'start') {
      const updated = manager.start({
        accountId,
        sessionId: session.sessionId,
        expectedGeneration,
      });
      emit('game.sessionChanged', { accountId, session: updated }, event.correlationId);
    } else if (event.kind === 'finish') {
      const updated = manager.finish({
        accountId,
        sessionId: session.sessionId,
        expectedGeneration,
      });
      emit('game.sessionChanged', { accountId, session: updated }, event.correlationId);
    } else if (event.kind === 'resign') {
      const updated = manager.abandon({
        accountId,
        sessionId: session.sessionId,
        expectedGeneration,
      });
      emit('game.sessionChanged', { accountId, session: updated }, event.correlationId);
    } else if (event.kind === 'close') {
      const updated = manager.close({
        accountId,
        sessionId: session.sessionId,
        expectedGeneration,
      });
      emit('game.sessionChanged', { accountId, session: updated }, event.correlationId);
    } else if (event.kind === 'move') {
      const application =
        event.revision === undefined
          ? manager.acceptProposal({
              accountId,
              sessionId: session.sessionId,
              expectedGeneration,
              proposal: {
                eventId: event.eventId,
                sessionId: event.sessionId,
                actor: event.actor,
                actorSeq: event.actorSeq,
                expectedRevision: event.expectedRevision,
                previousStateHash: event.previousStateHash,
                move: event.move,
              },
            })
          : manager.acceptSequencedEvent({
              accountId,
              sessionId: session.sessionId,
              expectedGeneration,
              event: {
                eventId: event.eventId,
                sessionId: event.sessionId,
                actor: event.actor,
                actorSeq: event.actorSeq,
                expectedRevision: event.expectedRevision,
                previousStateHash: event.previousStateHash,
                move: event.move,
                sequencer: 'initiator',
                revision: event.revision,
                resultingStateHash: event.resultingStateHash,
              },
            });
      if (application.kind === 'applied') {
        emit(
          'game.moveAccepted',
          { accountId, session: application.session, eventId: event.eventId },
          event.correlationId,
        );
        if (event.revision === undefined)
          await sendEvent(
            accountId,
            baseEvent(accountId, application.session, 'move', {
              eventId: application.event.eventId,
              actor: application.event.actor,
              actorSeq: application.event.actorSeq,
              expectedRevision: application.event.expectedRevision,
              previousStateHash: application.event.previousStateHash,
              revision: application.event.revision,
              resultingStateHash: application.event.resultingStateHash,
              move: application.event.move,
              correlationId: event.correlationId || event.eventId,
            }),
            session.peerBareJid,
            true,
          );
      }
      await sendEvent(
        accountId,
        baseEvent(accountId, application.session, 'move-ack', {
          eventId: event.eventId,
          actor: event.actor,
          actorSeq: event.actorSeq,
          revision: event.revision ?? application.event?.revision ?? application.snapshot?.revision,
          resultingStateHash: event.resultingStateHash || application.snapshot?.stateHash,
          correlationId: event.correlationId || event.eventId,
        }),
        session.peerBareJid,
      );
    } else if (event.kind === 'move-ack') {
      const key = `${accountId}|${session.sessionId}|${event.eventId}`;
      clearPending(pendingAcks, key);
      emit(
        'game.moveConfirmed',
        {
          accountId,
          sessionId: session.sessionId,
          eventId: event.eventId,
          actorSeq: event.actorSeq,
          revision: event.revision,
          stateHash: event.resultingStateHash,
        },
        event.correlationId,
      );
    } else if (event.kind === 'state.request') {
      const snapshot = manager
        .recover(accountId)
        .find((entry) => entry.session.sessionId === session.sessionId)?.snapshot;
      if (!snapshot)
        throw transportError('GAME_TRANSPORT_SNAPSHOT_UNKNOWN', 'Game snapshot does not exist');
      await sendEvent(
        accountId,
        baseEvent(accountId, session, 'state.response', {
          revision: snapshot.revision,
          stateHash: snapshot.stateHash,
          state: snapshot.state,
          correlationId: event.correlationId || event.eventId,
        }),
        session.peerBareJid,
      );
    } else if (event.kind === 'state.response') {
      validateStateHash(event, session);
      clearPending(
        stateRequests,
        `${accountId}|${session.sessionId}|${event.correlationId || event.eventId}`,
      );
      const local = /** @type {GameSession} */ (manager.getSession(accountId, session.sessionId));
      if (local.revision === event.revision && local.stateHash === event.stateHash)
        emit(
          'game.stateSynchronized',
          { accountId, sessionId: session.sessionId, revision: event.revision },
          event.correlationId,
        );
      else {
        if (['active', 'paused'].includes(local.state))
          manager.requireResync({
            accountId,
            sessionId: session.sessionId,
            expectedGeneration: local.sessionGeneration,
          });
        emit(
          'game.syncRequired',
          {
            accountId,
            sessionId: session.sessionId,
            localRevision: local.revision,
            remoteRevision: event.revision,
            localStateHash: local.stateHash,
            remoteStateHash: event.stateHash,
          },
          event.correlationId,
        );
      }
    } else if (event.kind === 'error') {
      emit(
        'game.remoteError',
        { accountId, sessionId: session.sessionId, code: event.errorCode },
        event.correlationId,
      );
    }
  }

  /** @param {string} accountId @param {string} sessionId @param {string | undefined} correlationId */
  const sendAccept = (accountId, sessionId, correlationId) =>
    sendControl(accountId, sessionId, 'accept', 'accept', correlationId);
  /** @param {string} accountId @param {string} sessionId @param {string | undefined} correlationId */
  const sendReject = (accountId, sessionId, correlationId) =>
    sendControl(accountId, sessionId, 'reject', 'reject', correlationId);
  /** @param {string} accountId @param {string} sessionId @param {string | undefined} correlationId */
  const sendCancel = (accountId, sessionId, correlationId) =>
    sendControl(accountId, sessionId, 'cancel', 'cancel', correlationId);
  /** @param {string} accountId @param {string} sessionId @param {string | undefined} correlationId */
  const sendStart = (accountId, sessionId, correlationId) =>
    sendControl(accountId, sessionId, 'start', 'start', correlationId);
  /** @param {string} accountId @param {string} sessionId @param {string | undefined} correlationId */
  const sendFinish = (accountId, sessionId, correlationId) =>
    sendControl(accountId, sessionId, 'finish', 'finish', correlationId);
  /** @param {string} accountId @param {string} sessionId @param {string | undefined} correlationId */
  const sendResign = (accountId, sessionId, correlationId) =>
    sendControl(accountId, sessionId, 'resign', 'abandon', correlationId);
  /** @param {string} accountId @param {string} sessionId @param {string | undefined} [correlationId] */
  const sendClose = (accountId, sessionId, correlationId) =>
    sendControl(accountId, sessionId, 'close', 'close', correlationId);

  return {
    namespace: GAME_NAMESPACE,
    feature: GAME_FEATURE,
    eventKinds: GAME_EVENT_KINDS,
    sendInvite,
    sendMove,
    sendAccept,
    sendReject,
    sendCancel,
    sendStart,
    sendFinish,
    sendResign,
    sendClose,
    async sendRematch(
      /** @type {string} */ accountId,
      /** @type {string} */ sessionId,
      /** @type {string | undefined} */ correlationId,
    ) {
      assertReady();
      const previous = manager.getSession(accountId, sessionId);
      if (!previous)
        throw transportError('GAME_TRANSPORT_SESSION_UNKNOWN', 'Game session does not exist');
      if (!['finished', 'abandoned'].includes(previous.state))
        throw transportError(
          'GAME_TRANSPORT_INVALID_TRANSITION',
          'Rematch requires a finished or abandoned session',
        );
      consumeRate(accountId, previous.peerBareJid, previous.sessionId, 'out:rematch');
      const rematch = manager.create({
        accountId,
        conversationId: previous.conversationId,
        peerBareJid: previous.peerBareJid,
        gameId: previous.gameId,
        gameVersion: previous.gameVersion,
        localRole: 'initiator',
      });
      const result = await sendEvent(
        accountId,
        baseEvent(accountId, rematch, 'rematch', {
          correlationId: correlationId || rematch.sessionId,
        }),
        rematch.peerBareJid,
        true,
      );
      return { ...result, session: rematch };
    },
    sendStateRequest,
    handleMessage(/** @type {string} */ accountId, /** @type {XmlNode} */ stanza) {
      const currentGeneration = adapter.sessionGenerations.get(accountId);
      if (
        currentGeneration === undefined ||
        !Number.isSafeInteger(currentGeneration) ||
        currentGeneration < 1
      )
        return false;
      let event;
      try {
        event = parseGameEvent(stanza, accountId, currentGeneration, adapter.bareJid.bind(adapter));
      } catch (error) {
        if (errorCodeOf(error, '') === 'GAME_TRANSPORT_CARBON_IGNORED') return true;
        emitTransportError(accountId, undefined, error);
        return true;
      }
      if (!event) return false;
      try {
        void dispatch(accountId, event).catch((error) =>
          emitTransportError(accountId, event, error),
        );
      } catch (error) {
        emitTransportError(accountId, event, error);
      }
      return true;
    },
    handleConnectionEvent(
      /** @type {string} */ accountId,
      /** @type {'offline' | 'online' | 'error'} */ eventName,
    ) {
      if (!manager || disposed) return;
      for (const session of manager.listSessions(accountId)) {
        try {
          if (['offline', 'error'].includes(eventName) && session.state === 'active') {
            const updated = manager.pause({
              accountId,
              sessionId: session.sessionId,
              expectedGeneration: session.sessionGeneration,
            });
            emit('game.sessionChanged', { accountId, session: updated }, 'connection');
          } else if (
            eventName === 'online' &&
            ['paused', 'resync-required'].includes(session.state)
          ) {
            void sendStateRequest(accountId, session.sessionId, idFactory()).catch((error) =>
              emit('game.transportError', {
                accountId,
                sessionId: session.sessionId,
                code: errorCodeOf(error, 'GAME_STATE_REQUEST_FAILED'),
              }),
            );
          }
        } catch (error) {
          emit('game.transportError', {
            accountId,
            sessionId: session.sessionId,
            code: errorCodeOf(error, 'GAME_CONNECTION_STATE_FAILED'),
          });
        }
      }
    },
    clear(/** @type {string} */ accountId) {
      for (const [key] of pendingAcks)
        if (key.startsWith(`${accountId}|`)) clearPending(pendingAcks, key);
      for (const [key] of stateRequests)
        if (key.startsWith(`${accountId}|`)) clearPending(stateRequests, key);
      for (const [key] of seenEvents) if (key.startsWith(`${accountId}|`)) seenEvents.delete(key);
      for (const [key] of rateWindows) if (key.startsWith(`${accountId}|`)) rateWindows.delete(key);
    },
    diagnostics() {
      let seenEventCount = 0;
      for (const scope of seenEvents.values()) seenEventCount += scope.size;
      return Object.freeze({
        pendingAcks: pendingAcks.size,
        stateRequests: stateRequests.size,
        seenEvents: seenEventCount,
        seenScopes: seenEvents.size,
        rateScopes: rateWindows.size,
        limits,
      });
    },
    dispose() {
      disposed = true;
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      pendingAcks.clear();
      stateRequests.clear();
      seenEvents.clear();
      rateWindows.clear();
    },
  };
}

module.exports = {
  GAME_API_VERSION,
  GAME_EVENT_KINDS,
  GAME_FEATURE,
  GAME_NAMESPACE,
  MAX_GAME_PAYLOAD_BYTES,
  MAX_GAME_STATE_BYTES,
  createGameElement,
  createXmppGames,
  parseGameEvent,
};
