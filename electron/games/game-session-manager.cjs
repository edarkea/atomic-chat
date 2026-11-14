const crypto = require('node:crypto');
const { applySequencedEvent, createGameReplica, sequenceProposal } = require('../generated/games');
const { DEFAULT_GAME_LIMITS, normalizeGameLimits } = require('./game-limits.cjs');

const TRANSITIONS = Object.freeze({
  invited: ['accepted', 'rejected', 'cancelled', 'expired'],
  accepted: ['active', 'rejected', 'cancelled', 'expired'],
  active: ['paused', 'resync-required', 'finished', 'abandoned', 'cancelled'],
  paused: ['active', 'resync-required', 'abandoned', 'cancelled'],
  'resync-required': ['active', 'paused', 'abandoned', 'cancelled'],
  rejected: ['closed'],
  cancelled: ['closed'],
  expired: ['closed'],
  finished: ['closed'],
  abandoned: ['closed'],
  closed: [],
});

function managerError(code, message = code, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function ensureText(value, name) {
  if (typeof value !== 'string' || value.length === 0)
    throw managerError('GAME_SESSION_INVALID_INPUT', `${name} is required`);
  return value;
}

function freezeProposal(proposal) {
  return Object.freeze({ ...proposal, move: proposal.move });
}

class GameSessionManager {
  constructor({
    registry,
    storage,
    idFactory = () => crypto.randomUUID(),
    now = () => new Date().toISOString(),
    limits = DEFAULT_GAME_LIMITS,
  }) {
    if (
      !registry ||
      typeof registry.getDescriptor !== 'function' ||
      typeof registry.getRules !== 'function'
    )
      throw managerError('GAME_SESSION_INVALID_REGISTRY', 'A game registry is required');
    if (!storage || typeof storage.createSession !== 'function')
      throw managerError('GAME_SESSION_INVALID_STORAGE', 'A game storage is required');
    this.registry = registry;
    this.storage = storage;
    this.idFactory = idFactory;
    this.now = now;
    this.limits = normalizeGameLimits(limits);
    this.disposed = false;
  }

  assertReady() {
    if (this.disposed)
      throw managerError('GAME_SESSION_MANAGER_DISPOSED', 'Game session manager is disposed');
  }

  create({
    accountId,
    conversationId,
    peerBareJid,
    gameId,
    gameVersion,
    localRole,
    sessionId = this.idFactory(),
  }) {
    this.assertReady();
    ensureText(accountId, 'accountId');
    ensureText(conversationId, 'conversationId');
    ensureText(peerBareJid, 'peerBareJid');
    if (!['initiator', 'responder'].includes(localRole))
      throw managerError('GAME_SESSION_INVALID_ROLE', 'Local role is invalid');
    const descriptor = this.registry.getDescriptor(gameId, gameVersion);
    const rules = this.registry.getRules(gameId, gameVersion);
    if (!descriptor || !rules)
      throw managerError('GAME_SESSION_GAME_NOT_FOUND', 'Game is not registered');
    const sessions = this.storage.listSessions(accountId);
    const liveSessions = sessions.filter((entry) =>
      ['invited', 'accepted', 'active', 'paused', 'resync-required'].includes(entry.state),
    );
    if (liveSessions.length >= this.limits.maxSessionsPerAccount)
      throw managerError(
        'GAME_SESSION_LIMIT_ACCOUNT',
        'The account has reached its live game session limit',
        { limit: this.limits.maxSessionsPerAccount },
      );
    const peerKey = peerBareJid.toLowerCase();
    if (
      liveSessions.filter((entry) => entry.peerBareJid.toLowerCase() === peerKey).length >=
      this.limits.maxSessionsPerPeer
    )
      throw managerError(
        'GAME_SESSION_LIMIT_PEER',
        'The peer has reached its live game session limit',
        { limit: this.limits.maxSessionsPerPeer },
      );
    if (
      liveSessions.filter((entry) => ['invited', 'accepted'].includes(entry.state)).length >=
      this.limits.maxPendingSessionsPerAccount
    )
      throw managerError(
        'GAME_SESSION_LIMIT_PENDING',
        'The account has reached its pending game session limit',
        { limit: this.limits.maxPendingSessionsPerAccount },
      );
    const replica = createGameReplica(rules, sessionId);
    const timestamp = this.now();
    const session = {
      accountId,
      conversationId,
      peerBareJid,
      sessionId,
      gameId: descriptor.gameId,
      gameVersion: descriptor.version,
      apiVersion: descriptor.apiVersion,
      localRole,
      state: 'invited',
      revision: 0,
      stateHash: replica.stateHash,
      sessionGeneration: 1,
      lastEventId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.storage.createSession(session, {
      sessionId,
      state: replica.state,
      revision: replica.revision,
      stateHash: replica.stateHash,
      createdAt: timestamp,
    });
    return session;
  }

  getSession(accountId, sessionId) {
    this.assertReady();
    return this.storage.getSession(accountId, sessionId);
  }

  listSessions(accountId, conversationId) {
    this.assertReady();
    return this.storage.listSessions(accountId, conversationId);
  }

  recover(accountId) {
    this.assertReady();
    return this.storage.listSessions(accountId).map((session) => ({
      session,
      snapshot: this.storage.getSnapshot(accountId, session.sessionId),
      result: this.storage.getResult(accountId, session.sessionId),
    }));
  }

  transition(accountId, sessionId, expectedGeneration, target) {
    const session = this.getSession(accountId, sessionId);
    if (!session) throw managerError('GAME_SESSION_NOT_FOUND', 'Session does not exist');
    if (session.sessionGeneration !== expectedGeneration)
      throw managerError('GAME_SESSION_GENERATION_CONFLICT', 'Session generation is stale');
    if (!TRANSITIONS[session.state]?.includes(target))
      throw managerError(
        'GAME_SESSION_INVALID_TRANSITION',
        `Cannot transition ${session.state} to ${target}`,
      );
    return this.storage.transitionSession({
      accountId,
      sessionId,
      fromStates: [session.state],
      toState: target,
      sessionGeneration: expectedGeneration,
      updatedAt: this.now(),
    });
  }

  accept(input) {
    return this.transition(input.accountId, input.sessionId, input.expectedGeneration, 'accepted');
  }
  reject(input) {
    return this.transition(input.accountId, input.sessionId, input.expectedGeneration, 'rejected');
  }
  cancel(input) {
    return this.transition(input.accountId, input.sessionId, input.expectedGeneration, 'cancelled');
  }
  expire(input) {
    return this.transition(input.accountId, input.sessionId, input.expectedGeneration, 'expired');
  }
  start(input) {
    return this.transition(input.accountId, input.sessionId, input.expectedGeneration, 'active');
  }
  pause(input) {
    return this.transition(input.accountId, input.sessionId, input.expectedGeneration, 'paused');
  }
  requireResync(input) {
    return this.transition(
      input.accountId,
      input.sessionId,
      input.expectedGeneration,
      'resync-required',
    );
  }
  resume(input) {
    return this.transition(input.accountId, input.sessionId, input.expectedGeneration, 'active');
  }
  abandon(input) {
    return this.transition(input.accountId, input.sessionId, input.expectedGeneration, 'abandoned');
  }
  finish(input) {
    return this.transition(input.accountId, input.sessionId, input.expectedGeneration, 'finished');
  }
  close(input) {
    return this.transition(input.accountId, input.sessionId, input.expectedGeneration, 'closed');
  }

  context(accountId, sessionId, expectedGeneration) {
    const session = this.getSession(accountId, sessionId);
    if (!session) throw managerError('GAME_SESSION_NOT_FOUND', 'Session does not exist');
    if (session.sessionGeneration !== expectedGeneration)
      throw managerError('GAME_SESSION_GENERATION_CONFLICT', 'Session generation is stale');
    const rules = this.registry.getRules(session.gameId, session.gameVersion);
    if (!rules) throw managerError('GAME_SESSION_GAME_NOT_FOUND', 'Game rules are not registered');
    const stored = this.storage.getSnapshot(accountId, sessionId);
    if (!stored)
      throw managerError('GAME_SESSION_SNAPSHOT_NOT_FOUND', 'Session snapshot does not exist');
    return {
      session,
      rules,
      snapshot: Object.freeze({
        sessionId,
        state: stored.state,
        revision: stored.revision,
        stateHash: stored.stateHash,
        appliedEventIds: Object.freeze(this.storage.getAppliedEventIds(accountId, sessionId)),
      }),
    };
  }

  submitProposal({
    accountId,
    sessionId,
    expectedGeneration,
    actor,
    actorSeq,
    move,
    eventId = this.idFactory(),
  }) {
    const { session, rules, snapshot } = this.context(accountId, sessionId, expectedGeneration);
    if (session.state !== 'active')
      throw managerError('GAME_SESSION_NOT_ACTIVE', 'Moves require an active session');
    if (actor !== session.localRole)
      throw managerError('GAME_SESSION_ACTOR_CONFLICT', 'Actor is not the local role');
    const proposal = freezeProposal({
      eventId,
      sessionId,
      actor,
      actorSeq: actorSeq ?? this.storage.nextActorSeq(accountId, sessionId, actor),
      expectedRevision: snapshot.revision,
      previousStateHash: snapshot.stateHash,
      move,
    });
    if (session.localRole === 'responder') return { kind: 'proposal-pending', proposal };
    const validation = rules.validateMove(snapshot.state, move);
    if (!validation.ok)
      throw managerError(
        `GAME_RULE_${validation.error.code}`,
        validation.error.message,
        validation.error,
      );
    const sequenced = sequenceProposal(rules, snapshot, proposal);
    if (!sequenced.ok)
      throw managerError(
        `GAME_RULE_${sequenced.error.code}`,
        sequenced.error.message,
        sequenced.error,
      );
    return this.acceptSequencedEvent({
      accountId,
      sessionId,
      expectedGeneration,
      event: sequenced.value,
    });
  }

  acceptProposal({ accountId, sessionId, expectedGeneration, proposal }) {
    const { session, rules, snapshot } = this.context(accountId, sessionId, expectedGeneration);
    if (session.state !== 'active')
      throw managerError('GAME_SESSION_NOT_ACTIVE', 'Moves require an active session');
    if (session.localRole !== 'initiator' || proposal?.actor !== 'responder')
      throw managerError(
        'GAME_SESSION_SEQUENCER_REQUIRED',
        'Only the initiator can sequence a responder proposal',
      );
    const sequenced = sequenceProposal(rules, snapshot, proposal);
    if (!sequenced.ok)
      throw managerError(
        `GAME_RULE_${sequenced.error.code}`,
        sequenced.error.message,
        sequenced.error,
      );
    return this.acceptSequencedEvent({
      accountId,
      sessionId,
      expectedGeneration,
      event: sequenced.value,
    });
  }

  acceptSequencedEvent({ accountId, sessionId, expectedGeneration, event }) {
    const { session, rules, snapshot } = this.context(accountId, sessionId, expectedGeneration);
    if (session.state !== 'active')
      throw managerError('GAME_SESSION_NOT_ACTIVE', 'Events require an active session');
    if (!event || event.sessionId !== sessionId || event.sequencer !== 'initiator')
      throw managerError(
        'GAME_SESSION_INVALID_EVENT',
        'Only initiator-sequenced events are accepted',
      );
    const applied = applySequencedEvent(rules, snapshot, event);
    if (applied.kind === 'duplicate' || applied.kind === 'ignored-late') return applied;
    if (applied.kind === 'rejected')
      throw managerError(`GAME_RULE_${applied.error.code}`, applied.error.message, applied.error);
    const outcome = rules.outcome(applied.snapshot.state);
    const nextState = outcome.status === 'active' ? 'active' : 'finished';
    const persisted = this.storage.persistAcceptedEvent({
      accountId,
      sessionId,
      event,
      snapshot: applied.snapshot,
      result: nextState === 'finished' ? outcome : undefined,
      nextState,
      updatedAt: this.now(),
    });
    return { ...persisted, event };
  }

  dispose() {
    this.disposed = true;
  }
}

module.exports = { GameSessionManager, TRANSITIONS };
