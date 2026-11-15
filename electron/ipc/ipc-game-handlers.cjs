const crypto = require('node:crypto');

const GAME_EVENT_TYPES = new Set([
  'game.sessionChanged',
  'game.invitationReceived',
  'game.invitationUpdated',
  'game.moveAccepted',
  'game.moveConfirmed',
  'game.stateSynchronized',
  'game.syncRequired',
  'game.remoteError',
  'game.transportError',
  'game.eventDuplicate',
]);
const MAX_GAME_MOVE_BYTES = 65536;
const MAX_GAME_ID_LENGTH = 512;

/** @param {unknown} value @param {number} [depth] @returns {boolean} */
function isSafeGameValue(value, depth = 0) {
  if (depth > 8 || value === null) return value === null;
  if (typeof value === 'string' || typeof value === 'boolean') return value.length <= 65536;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value))
    return value.length <= 1024 && value.every((item) => isSafeGameValue(item, depth + 1));
  if (typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return false;
  const keys = Object.keys(value);
  return (
    keys.length <= 256 &&
    keys.every(
      (key) => key.length <= 128 && !['__proto__', 'constructor', 'prototype'].includes(key),
    ) &&
    keys.every((key) => isSafeGameValue(value[key], depth + 1))
  );
}

/** @param {unknown} value @returns {boolean} */
function isSafeMove(value) {
  if (!isSafeGameValue(value) || value === null || Array.isArray(value)) return false;
  try {
    return Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_GAME_MOVE_BYTES;
  } catch {
    return false;
  }
}

/** @param {unknown} value @param {string} name @returns {string} */
function requiredText(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_GAME_ID_LENGTH)
    throw new Error(`INVALID_${name}`);
  return value.trim();
}

/** @param {unknown} value @returns {boolean} */
function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** @param {unknown} error @returns {string} */
function rawErrorCode(error) {
  return typeof error?.code === 'string'
    ? error.code
    : typeof error?.message === 'string'
      ? error.message
      : 'INTERNAL';
}

/** @param {unknown} error @param {object | undefined} input @param {number} [senderId] */
function gameFailure(error, input, senderId) {
  const known = new Set([
    'INVALID_INPUT',
    'UNAUTHORIZED',
    'NOT_CONNECTED',
    'CONFLICT',
    'TIMEOUT',
    'UNSUPPORTED',
    'INTERNAL',
    'GAME_TRANSPORT_UNAVAILABLE',
    'GAME_TRANSPORT_DISPOSED',
    'GAME_TRANSPORT_NOT_CONNECTED',
    'GAME_TRANSPORT_SESSION_UNKNOWN',
    'GAME_TRANSPORT_SNAPSHOT_UNKNOWN',
    'GAME_TRANSPORT_ROLE_REJECTED',
    'GAME_TRANSPORT_GAME_UNAVAILABLE',
    'GAME_TRANSPORT_GENERATION_STALE',
    'GAME_TRANSPORT_INVALID_TRANSITION',
    'GAME_TRANSPORT_PEER_REJECTED',
    'GAME_TRANSPORT_CONVERSATION_REJECTED',
    'GAME_TRANSPORT_MUC_REJECTED',
    'GAME_TRANSPORT_RATE_LIMITED',
    'GAME_TRANSPORT_PENDING_LIMIT',
    'GAME_SESSION_NOT_FOUND',
    'GAME_SESSION_GENERATION_CONFLICT',
    'GAME_SESSION_NOT_ACTIVE',
    'GAME_SESSION_INVALID_TRANSITION',
    'GAME_SESSION_GAME_NOT_FOUND',
    'GAME_SESSION_SNAPSHOT_NOT_FOUND',
    'GAME_SESSION_ACTOR_CONFLICT',
    'GAME_SESSION_SEQUENCER_REQUIRED',
    'GAME_SESSION_LIMIT_ACCOUNT',
    'GAME_SESSION_LIMIT_PEER',
    'GAME_SESSION_LIMIT_PENDING',
    'GAME_RULE_INVALID_MOVE',
    'GAME_RULE_INVALID_ACTOR',
    'GAME_RULE_NOT_YOUR_TURN',
    'GAME_RULE_GAME_FINISHED',
    'GAME_RULE_OUT_OF_RANGE',
    'GAME_RULE_CELL_OCCUPIED',
    'GAME_RULE_NO_CAPTURE',
    'GAME_RULE_NO_LEGAL_MOVE',
    'GAME_RULE_PASS_NOT_ALLOWED',
    'GAME_RULE_PROPOSAL_CONFLICT',
    'GAME_RULE_HASH_MISMATCH',
  ]);
  const raw = rawErrorCode(error);
  const code = known.has(raw) ? raw : 'INTERNAL';
  const messages = {
    INVALID_INPUT: 'La solicitud de juego no es válida.',
    UNAUTHORIZED: 'La ventana o la cuenta no están autorizadas para esta partida.',
    NOT_CONNECTED: 'La cuenta no está conectada.',
    CONFLICT: 'La partida cambió mientras se procesaba la operación.',
    TIMEOUT: 'La operación de juego excedió el tiempo límite.',
    UNSUPPORTED: 'Esta operación de juego no está disponible.',
    GAME_TRANSPORT_NOT_CONNECTED: 'La cuenta no está conectada al transporte XMPP.',
    GAME_TRANSPORT_SESSION_UNKNOWN: 'La partida ya no existe.',
    GAME_TRANSPORT_SNAPSHOT_UNKNOWN: 'El estado confirmado de la partida no está disponible.',
    GAME_TRANSPORT_GENERATION_STALE: 'La conexión de la partida quedó obsoleta.',
    GAME_TRANSPORT_INVALID_TRANSITION: 'La partida no permite solicitar una revancha todavía.',
    GAME_TRANSPORT_MUC_REJECTED: 'Los juegos solo están disponibles en conversaciones directas.',
    GAME_TRANSPORT_RATE_LIMITED:
      'La actividad de juegos superó el límite temporal; inténtalo de nuevo.',
    GAME_TRANSPORT_PENDING_LIMIT: 'Hay demasiadas operaciones de juego pendientes.',
    GAME_SESSION_NOT_ACTIVE: 'La partida no está activa para esa operación.',
    GAME_SESSION_GENERATION_CONFLICT: 'La partida cambió de generación y debe recargarse.',
    GAME_SESSION_INVALID_TRANSITION: 'La partida no permite esa transición.',
    GAME_SESSION_GAME_NOT_FOUND: 'El juego oficial no está disponible.',
    GAME_SESSION_SNAPSHOT_NOT_FOUND: 'El estado confirmado de la partida no está disponible.',
    GAME_SESSION_ACTOR_CONFLICT: 'El movimiento no pertenece al turno local.',
    GAME_SESSION_SEQUENCER_REQUIRED: 'La secuencia de la partida no está disponible.',
    GAME_SESSION_LIMIT_ACCOUNT: 'La cuenta alcanzó el límite de partidas simultáneas.',
    GAME_SESSION_LIMIT_PEER: 'La conversación alcanzó el límite de partidas simultáneas.',
    GAME_SESSION_LIMIT_PENDING: 'La cuenta alcanzó el límite de invitaciones pendientes.',
    GAME_RULE_NOT_YOUR_TURN: 'No corresponde el turno local.',
    GAME_RULE_CELL_OCCUPIED: 'La casilla ya está ocupada.',
    GAME_RULE_OUT_OF_RANGE: 'La casilla seleccionada no es válida.',
    GAME_RULE_NO_CAPTURE: 'La jugada debe capturar al menos una ficha.',
    GAME_RULE_PASS_NOT_ALLOWED: 'No puedes pasar mientras exista una jugada válida.',
    GAME_RULE_GAME_FINISHED: 'La partida ya terminó.',
    INTERNAL: 'No fue posible completar la operación de juego.',
  };
  return {
    ok: false,
    version: 1,
    error: {
      code,
      retryable: ['TIMEOUT', 'NOT_CONNECTED'].includes(code),
      requestId:
        typeof input?.requestId === 'string' && input.requestId.trim()
          ? input.requestId
          : `games_${senderId || 'unknown'}_${Date.now()}`,
      message: messages[code] || messages.INTERNAL,
    },
  };
}

/** @param {object} session @param {object} runtime */
function publicSession(session, runtime) {
  return Object.freeze({
    accountId: session.accountId,
    conversationId: session.conversationId,
    peerBareJid: session.peerBareJid,
    sessionId: session.sessionId,
    gameId: session.gameId,
    gameVersion: session.gameVersion,
    apiVersion: session.apiVersion,
    localRole: session.localRole,
    state: session.state,
    revision: session.revision,
    stateHash: session.stateHash,
    sessionGeneration: session.sessionGeneration,
    connectionGeneration: runtime.xmpp.sessionGenerations.get(session.accountId) || 1,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  });
}

/** @param {object} snapshot @param {object | undefined} [session] @param {object | undefined} [runtime] */
function publicSnapshot(snapshot, session, runtime) {
  const state = snapshot.state;
  const isReversi = session?.gameId === 'com.atomicchat.reversi';
  const rules = isReversi
    ? runtime?.gameRegistry?.getRules(session.gameId, session.gameVersion)
    : undefined;
  const actor = isReversi && isObject(state) ? state.turn : undefined;
  const legalMoves =
    rules && (actor === 'initiator' || actor === 'responder')
      ? Array.from({ length: 64 }, (_, index) => index).filter((index) => {
          try {
            return rules.validateMove(state, { kind: 'place', actor, index }).ok;
          } catch {
            return false;
          }
        })
      : undefined;
  const passAllowed =
    rules && (actor === 'initiator' || actor === 'responder')
      ? (() => {
          try {
            return rules.validateMove(state, { kind: 'pass', actor }).ok;
          } catch {
            return false;
          }
        })()
      : undefined;
  return Object.freeze({
    sessionId: snapshot.sessionId,
    state,
    revision: snapshot.revision,
    stateHash: snapshot.stateHash,
    ...(legalMoves ? { legalMoves: Object.freeze(legalMoves) } : {}),
    ...(passAllowed !== undefined ? { passAllowed } : {}),
  });
}

/** @param {object} runtime @param {string} accountId @param {string} sessionId */
function snapshotFor(runtime, accountId, sessionId) {
  const recovered = runtime.gameSessions
    .recover(accountId)
    .find((entry) => entry.session.sessionId === sessionId);
  return recovered?.snapshot
    ? publicSnapshot(recovered.snapshot, recovered.session, runtime)
    : undefined;
}

/** @param {object} runtime @param {object} session @param {string} operation @param {string} status @param {object} [extra] */
function receipt(runtime, session, operation, status, extra = {}) {
  return {
    operation,
    status,
    session: publicSession(session, runtime),
    snapshot: snapshotFor(runtime, session.accountId, session.sessionId),
    ...extra,
  };
}

/** @param {object} runtime @param {string} accountId @param {string} value */
function directConversation(runtime, accountId, value) {
  const raw = requiredText(value, 'CONVERSATION');
  if (raw.includes('/')) throw new Error('INVALID_INPUT');
  const conversationId = runtime.xmpp.bareJid(raw).toLowerCase();
  if (!/^[^@\s/]+@[^@\s/]+$/.test(conversationId)) throw new Error('INVALID_INPUT');
  if (conversationId === runtime.xmpp.bareJid(accountId).toLowerCase())
    throw new Error('INVALID_INPUT');
  if (runtime.xmpp.mucRooms.get(accountId)?.has(conversationId))
    throw new Error('GAME_TRANSPORT_MUC_REJECTED');
  if (runtime.xmpp.mucDiscoveries?.get(accountId)?.has(conversationId))
    throw new Error('GAME_TRANSPORT_MUC_REJECTED');
  return conversationId;
}

/** @param {object} event @param {object} input @param {object} dependencies @param {boolean} [withConversation] */
function authorizeRequest(event, input, dependencies, withConversation = false) {
  dependencies.assertSender(event);
  if (
    !isObject(input) ||
    input.version !== 1 ||
    typeof input.requestId !== 'string' ||
    !input.requestId.trim() ||
    input.requestId.length > MAX_GAME_ID_LENGTH ||
    typeof input.accountId !== 'string' ||
    !input.accountId.trim()
  )
    throw new Error('INVALID_INPUT');
  if (!dependencies.historySecurity.authorize(event.sender.id, input.accountId))
    throw new Error('UNAUTHORIZED');
  const runtime = dependencies.getRuntime();
  if (!runtime?.gameSessions || !runtime.gameRegistry) throw new Error('UNSUPPORTED');
  return {
    runtime,
    conversationId: withConversation
      ? directConversation(runtime, input.accountId, input.conversationId)
      : undefined,
  };
}

/** @param {object} context @param {object} input */
function authorizedSession(context, input) {
  if (
    typeof input.sessionId !== 'string' ||
    !input.sessionId.trim() ||
    input.sessionId.length > MAX_GAME_ID_LENGTH
  )
    throw new Error('INVALID_INPUT');
  const session = context.runtime.gameSessions.getSession(input.accountId, input.sessionId);
  if (!session || session.conversationId.toLowerCase() !== context.conversationId)
    throw new Error('UNAUTHORIZED');
  if (
    input.sessionGeneration !== undefined &&
    input.sessionGeneration !== session.sessionGeneration
  )
    throw new Error('GAME_SESSION_GENERATION_CONFLICT');
  const connectionGeneration = context.runtime.xmpp.sessionGenerations.get(input.accountId) || 0;
  if (
    input.connectionGeneration !== undefined &&
    connectionGeneration > 0 &&
    input.connectionGeneration !== connectionGeneration
  )
    throw new Error('GAME_TRANSPORT_GENERATION_STALE');
  return { session, connectionGeneration };
}

/** @param {object} event @param {object} runtime @returns {object | undefined} */
function publicGameEvent(event, runtime) {
  if (!event || !GAME_EVENT_TYPES.has(event.type) || !isObject(event.payload)) return undefined;
  const raw = event.payload;
  const accountId =
    typeof raw.accountId === 'string'
      ? raw.accountId
      : typeof raw.session?.accountId === 'string'
        ? raw.session.accountId
        : undefined;
  const sessionId =
    typeof raw.sessionId === 'string'
      ? raw.sessionId
      : typeof raw.session?.sessionId === 'string'
        ? raw.session.sessionId
        : undefined;
  if (!accountId || !sessionId) return undefined;
  const session =
    raw.session && typeof raw.session === 'object'
      ? raw.session
      : runtime.gameSessions.getSession(accountId, sessionId);
  if (!session) return undefined;
  const conversationId = session.conversationId;
  const snapshot = snapshotFor(runtime, accountId, sessionId);
  const payload = {
    accountId,
    conversationId,
    sessionId,
    connectionGeneration: runtime.xmpp.sessionGenerations.get(accountId) || 1,
    session: publicSession(session, runtime),
    ...(snapshot ? { snapshot } : {}),
    ...(typeof raw.eventId === 'string' ? { eventId: raw.eventId } : {}),
    ...(Number.isInteger(raw.revision) ? { revision: raw.revision } : {}),
    ...(typeof raw.stateHash === 'string' ? { stateHash: raw.stateHash } : {}),
    ...(Number.isInteger(raw.localRevision) ? { localRevision: raw.localRevision } : {}),
    ...(Number.isInteger(raw.remoteRevision) ? { remoteRevision: raw.remoteRevision } : {}),
    ...(typeof raw.localStateHash === 'string' ? { localStateHash: raw.localStateHash } : {}),
    ...(typeof raw.remoteStateHash === 'string' ? { remoteStateHash: raw.remoteStateHash } : {}),
    ...(Number.isInteger(raw.actorSeq) ? { actorSeq: raw.actorSeq } : {}),
    ...(typeof raw.code === 'string' ? { code: raw.code } : {}),
  };
  return {
    version: 1,
    eventId:
      typeof raw.eventId === 'string' && raw.eventId ? raw.eventId : `game_${crypto.randomUUID()}`,
    ...(typeof event.correlationId === 'string' ? { correlationId: event.correlationId } : {}),
    type: event.type,
    payload,
  };
}

/** @param {{webContents: object, getRuntime: () => object, historySecurity: object}} dependencies */
function createGameEventPublisher(dependencies) {
  /** @type {Map<number, {accountId: string, conversationId?: string, sessionId?: string}>} */
  const subscriptions = new Map();

  return {
    subscribe(senderId, input) {
      subscriptions.set(senderId, {
        accountId: input.accountId,
        ...(input.conversationId ? { conversationId: input.conversationId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      });
    },
    unsubscribe(senderId) {
      subscriptions.delete(senderId);
    },
    clearSender(senderId) {
      subscriptions.delete(senderId);
    },
    publish(event) {
      const runtime = dependencies.getRuntime();
      if (!runtime?.gameSessions) return;
      const publicEvent = publicGameEvent(event, runtime);
      if (!publicEvent) return;
      for (const [senderId, subscription] of subscriptions) {
        if (subscription.accountId !== publicEvent.payload.accountId) continue;
        if (!dependencies.historySecurity.authorize(senderId, subscription.accountId)) {
          subscriptions.delete(senderId);
          continue;
        }
        if (
          (subscription.conversationId &&
            subscription.conversationId !== publicEvent.payload.conversationId) ||
          (subscription.sessionId && subscription.sessionId !== publicEvent.payload.sessionId)
        )
          continue;
        const target = dependencies.webContents.fromId(senderId);
        if (!target || target.isDestroyed()) {
          subscriptions.delete(senderId);
          continue;
        }
        target.send('game.event', publicEvent);
      }
    },
  };
}

/** @param {object} dependencies */
function registerGameHandlers(dependencies) {
  const { ipcMain, assertSender, getRuntime, historySecurity, gameEventPublisher } = dependencies;
  /** @param {object} event @param {object} input @param {boolean} [withConversation] */
  function authorize(event, input, withConversation = false) {
    return authorizeRequest(
      event,
      input,
      { assertSender, getRuntime, historySecurity },
      withConversation,
    );
  }

  function success(input, value) {
    return { ok: true, value, version: 1, requestId: input.requestId };
  }

  ipcMain.handle('games.catalog', async (event, input) => {
    try {
      const { runtime } = authorize(event, input);
      const value = runtime.gameRegistry
        .catalog()
        .filter((item) => item.distribution === 'official');
      return success(input, value);
    } catch (error) {
      return gameFailure(error, input, event.sender.id);
    }
  });

  ipcMain.handle('games.sessions', async (event, input) => {
    try {
      const context = authorize(event, input, true);
      const sessions = context.runtime.gameSessions
        .listSessions(input.accountId, context.conversationId)
        .map((session) => publicSession(session, context.runtime));
      return success(input, sessions);
    } catch (error) {
      return gameFailure(error, input, event.sender.id);
    }
  });

  ipcMain.handle('games.snapshot', async (event, input) => {
    try {
      const context = authorize(event, input, true);
      const { session } = authorizedSession(context, input);
      const snapshot = snapshotFor(context.runtime, input.accountId, session.sessionId);
      if (!snapshot) throw new Error('GAME_SESSION_SNAPSHOT_NOT_FOUND');
      return success(input, snapshot);
    } catch (error) {
      return gameFailure(error, input, event.sender.id);
    }
  });

  ipcMain.handle('games.invite', async (event, input) => {
    try {
      const context = authorize(event, input, true);
      if (typeof input.gameId !== 'string' || typeof input.gameVersion !== 'string')
        throw new Error('INVALID_INPUT');
      const descriptor = context.runtime.gameRegistry.getDescriptor(
        input.gameId,
        input.gameVersion,
      );
      if (!descriptor || descriptor.distribution !== 'official') throw new Error('UNSUPPORTED');
      const session = context.runtime.gameSessions.create({
        accountId: input.accountId,
        conversationId: context.conversationId,
        peerBareJid: context.conversationId,
        gameId: input.gameId,
        gameVersion: input.gameVersion,
        localRole: 'initiator',
      });
      const generation = context.runtime.xmpp.sessionGenerations.get(input.accountId) || 0;
      await context.runtime.xmpp.sendGameInvite(
        input.accountId,
        session.sessionId,
        input.requestId,
      );
      if (!historySecurity.authorize(event.sender.id, input.accountId))
        throw new Error('UNAUTHORIZED');
      if ((context.runtime.xmpp.sessionGenerations.get(input.accountId) || 0) !== generation)
        throw new Error('GAME_TRANSPORT_GENERATION_STALE');
      const value = receipt(context.runtime, session, 'invite', 'requested');
      gameEventPublisher.publish({
        type: 'game.sessionChanged',
        correlationId: input.requestId,
        payload: { accountId: input.accountId, session },
      });
      return success(input, value);
    } catch (error) {
      return gameFailure(error, input, event.sender.id);
    }
  });

  const controlOperations = Object.freeze({
    accept: ['sendGameAccept', 'requested'],
    reject: ['sendGameReject', 'requested'],
    cancel: ['sendGameCancel', 'requested'],
    start: ['sendGameStart', 'requested'],
    resign: ['sendGameResign', 'requested'],
    close: ['sendGameClose', 'requested'],
  });
  for (const [operation, [method, status]] of Object.entries(controlOperations)) {
    ipcMain.handle(`games.${operation}`, async (event, input) => {
      try {
        const context = authorize(event, input, true);
        const { session } = authorizedSession(context, input);
        const generation = context.runtime.xmpp.sessionGenerations.get(input.accountId) || 0;
        await context.runtime.xmpp[method](input.accountId, session.sessionId, input.requestId);
        if (!historySecurity.authorize(event.sender.id, input.accountId))
          throw new Error('UNAUTHORIZED');
        if ((context.runtime.xmpp.sessionGenerations.get(input.accountId) || 0) !== generation)
          throw new Error('GAME_TRANSPORT_GENERATION_STALE');
        const updated = context.runtime.gameSessions.getSession(input.accountId, session.sessionId);
        if (!updated) throw new Error('GAME_SESSION_NOT_FOUND');
        const value = receipt(context.runtime, updated, operation, status);
        gameEventPublisher.publish({
          type: 'game.sessionChanged',
          correlationId: input.requestId,
          payload: { accountId: input.accountId, session: updated },
        });
        return success(input, value);
      } catch (error) {
        return gameFailure(error, input, event.sender.id);
      }
    });
  }

  ipcMain.handle('games.move', async (event, input) => {
    try {
      const context = authorize(event, input, true);
      const { session } = authorizedSession(context, input);
      if (!['initiator', 'responder'].includes(input.actor) || !isSafeMove(input.move))
        throw new Error('INVALID_INPUT');
      if (input.actor !== session.localRole) throw new Error('GAME_SESSION_ACTOR_CONFLICT');
      const generation = context.runtime.xmpp.sessionGenerations.get(input.accountId) || 0;
      const result = await context.runtime.xmpp.sendGameMove(input.accountId, {
        sessionId: session.sessionId,
        actor: input.actor,
        move: input.move,
        ...(input.eventId ? { eventId: input.eventId } : {}),
        correlationId: input.requestId,
      });
      if (!historySecurity.authorize(event.sender.id, input.accountId))
        throw new Error('UNAUTHORIZED');
      if ((context.runtime.xmpp.sessionGenerations.get(input.accountId) || 0) !== generation)
        throw new Error('GAME_TRANSPORT_GENERATION_STALE');
      const updated = context.runtime.gameSessions.getSession(input.accountId, session.sessionId);
      if (!updated) throw new Error('GAME_SESSION_NOT_FOUND');
      const application = result.application;
      const value = receipt(
        context.runtime,
        updated,
        'move',
        application?.kind === 'applied' ? 'accepted' : 'proposal-sent',
        {
          ...(application?.event?.eventId ? { eventId: application.event.eventId } : {}),
          ...(application?.snapshot?.revision !== undefined
            ? { revision: application.snapshot.revision }
            : {}),
        },
      );
      return success(input, value);
    } catch (error) {
      return gameFailure(error, input, event.sender.id);
    }
  });

  ipcMain.handle('games.resync', async (event, input) => {
    try {
      const context = authorize(event, input, true);
      const { session } = authorizedSession(context, input);
      if (!['paused', 'resync-required'].includes(session.state))
        throw new Error('GAME_SESSION_INVALID_TRANSITION');
      await context.runtime.xmpp.sendGameStateRequest(
        input.accountId,
        session.sessionId,
        input.requestId,
      );
      if (!historySecurity.authorize(event.sender.id, input.accountId))
        throw new Error('UNAUTHORIZED');
      const updated = context.runtime.gameSessions.getSession(input.accountId, session.sessionId);
      if (!updated) throw new Error('GAME_SESSION_NOT_FOUND');
      return success(input, receipt(context.runtime, updated, 'resync', 'confirmation-pending'));
    } catch (error) {
      return gameFailure(error, input, event.sender.id);
    }
  });

  ipcMain.handle('games.rematch', async (event, input) => {
    try {
      const context = authorize(event, input, true);
      const { session } = authorizedSession(context, input);
      const generation = context.runtime.xmpp.sessionGenerations.get(input.accountId) || 0;
      const result = await context.runtime.xmpp.sendGameRematch(
        input.accountId,
        session.sessionId,
        input.requestId,
      );
      if (!historySecurity.authorize(event.sender.id, input.accountId))
        throw new Error('UNAUTHORIZED');
      if ((context.runtime.xmpp.sessionGenerations.get(input.accountId) || 0) !== generation)
        throw new Error('GAME_TRANSPORT_GENERATION_STALE');
      return success(input, receipt(context.runtime, result.session, 'rematch', 'requested'));
    } catch (error) {
      return gameFailure(error, input, event.sender.id);
    }
  });

  ipcMain.handle('games.subscribe', async (event, input) => {
    try {
      const context = authorize(event, input);
      const conversationId = input.conversationId
        ? directConversation(context.runtime, input.accountId, input.conversationId)
        : undefined;
      if (
        input.sessionId !== undefined &&
        (typeof input.sessionId !== 'string' || !input.sessionId.trim())
      )
        throw new Error('INVALID_INPUT');
      gameEventPublisher.subscribe(event.sender.id, {
        accountId: input.accountId,
        ...(conversationId ? { conversationId } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      });
      return success(input, { subscribed: true });
    } catch (error) {
      return gameFailure(error, input, event.sender.id);
    }
  });

  ipcMain.handle('games.unsubscribe', async (event, input) => {
    try {
      authorize(event, input);
      gameEventPublisher.unsubscribe(event.sender.id);
      return success(input, { subscribed: false });
    } catch (error) {
      return gameFailure(error, input, event.sender.id);
    }
  });

  return {
    clearSender: gameEventPublisher?.clearSender
      ? (senderId) => gameEventPublisher.clearSender(senderId)
      : () => undefined,
  };
}

module.exports = { createGameEventPublisher, registerGameHandlers, publicSession, publicSnapshot };
