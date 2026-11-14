const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const compiled = require('../electron/generated/games');
const { GameRegistry } = require('../electron/games/game-registry.cjs');
const { GameSessionManager } = require('../electron/games/game-session-manager.cjs');
const { GameStorage } = require('../electron/persistence/game-storage.cjs');
const { PersistenceStore } = require('../electron/persistence/storage.cjs');
const {
  createGameEventPublisher,
  registerGameHandlers,
} = require('../electron/ipc/ipc-game-handlers.cjs');
const { createIpcHelpers } = require('../electron/ipc/ipc-helpers.cjs');

const ACCOUNT = 'alice@example.invalid';
const CONTACT = 'bob@example.invalid';
const ROOM = 'room@conference.example.invalid';

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-games-ipc-'));
  const persistence = new PersistenceStore(root);
  persistence.upsertAccount({
    accountId: ACCOUNT,
    host: 'example.invalid',
    port: 5222,
    tls: 1,
    credentialRef: null,
    createdAt: '2026-11-13T00:00:00.000Z',
  });
  const registry = new GameRegistry();
  registry.registerOfficial(
    {
      gameId: compiled.TIC_TAC_TOE_GAME_ID,
      displayName: 'Tic-Tac-Toe',
      version: compiled.TIC_TAC_TOE_GAME_VERSION,
      apiVersion: 1,
      players: { min: 2, max: 2 },
      capabilities: ['invites', 'replay', 'resync', 'score'],
      distribution: 'official',
      source: 'built-in',
      enabled: true,
    },
    compiled.ticTacToeRules,
  );
  registry.registerOfficial(
    {
      gameId: compiled.REVERSI_GAME_ID,
      displayName: 'Reversi',
      version: compiled.REVERSI_GAME_VERSION,
      apiVersion: 1,
      players: { min: 2, max: 2 },
      capabilities: ['invites', 'replay', 'resync', 'score'],
      distribution: 'official',
      source: 'built-in',
      enabled: true,
    },
    compiled.reversiRules,
  );
  const manager = new GameSessionManager({
    registry,
    storage: new GameStorage(persistence.database),
    idFactory: () => 'ipc-session-1',
    now: () => '2026-11-13T00:00:00.000Z',
  });
  const sent = [];
  const xmpp = {
    sessionGenerations: new Map([[ACCOUNT, 1]]),
    mucRooms: new Map([[ACCOUNT, new Map([[ROOM, {}]])]]),
    bareJid: (jid) => String(jid).split('/')[0],
    sendGameInvite: async (...args) => sent.push(['invite', args]),
    sendGameAccept: async (...args) => sent.push(['accept', args]),
    sendGameReject: async (...args) => sent.push(['reject', args]),
    sendGameCancel: async (...args) => sent.push(['cancel', args]),
    sendGameStart: async (...args) => sent.push(['start', args]),
    sendGameResign: async (...args) => sent.push(['resign', args]),
    sendGameClose: async (...args) => sent.push(['close', args]),
    sendGameRematch: async (...args) => {
      sent.push(['rematch', args]);
      return { session: manager.getSession(ACCOUNT, 'ipc-session-1') };
    },
    sendGameStateRequest: async (...args) => sent.push(['resync', args]),
    sendGameMove: async (...args) => ({
      application: {
        kind: 'proposal-pending',
        proposal: { eventId: args[1].eventId || 'ipc-move-1' },
      },
    }),
    games: { sendRematch: async () => ({ session: manager.getSession(ACCOUNT, 'ipc-session-1') }) },
  };
  const runtime = { gameRegistry: registry, gameSessions: manager, xmpp };
  const owners = new Map([[7, ACCOUNT]]);
  const historySecurity = {
    authorize: (senderId, accountId) => owners.get(senderId) === accountId,
  };
  const messages = [];
  const webContents = {
    fromId: (senderId) =>
      senderId === 7
        ? { isDestroyed: () => false, send: (...args) => messages.push([senderId, ...args]) }
        : null,
  };
  const publisher = createGameEventPublisher({
    webContents,
    getRuntime: () => runtime,
    historySecurity,
  });
  const handlers = new Map();
  registerGameHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    assertSender: (event) => {
      if (event.secondary) throw new Error('UNAUTHORIZED');
    },
    getRuntime: () => runtime,
    historySecurity,
    helpers: createIpcHelpers({
      assertSender: () => undefined,
      validateXmppTransport: () => ({ transport: 'starttls' }),
      appIsPackaged: false,
      getRuntime: () => runtime,
      fileTransfers: {},
      outgoingFileTransfers: {},
      historySecurity,
    }),
    gameEventPublisher: publisher,
  });
  return {
    root,
    persistence,
    manager,
    runtime,
    handlers,
    sent,
    messages,
    publisher,
    historySecurity,
    owners,
    event: (senderId = 7) => ({ sender: { id: senderId } }),
    close: () => {
      manager.dispose();
      persistence.close();
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

function input(overrides = {}) {
  return {
    version: 1,
    requestId: 'games-request-1',
    accountId: ACCOUNT,
    conversationId: CONTACT,
    ...overrides,
  };
}

test('games IPC exposes official catalog and isolates sessions by account/conversation', async () => {
  const fixture = createFixture();
  try {
    const catalog = await fixture.handlers.get('games.catalog')(fixture.event(), input());
    assert.equal(catalog.ok, true);
    assert.deepEqual(
      catalog.value.map((item) => item.gameId),
      [compiled.TIC_TAC_TOE_GAME_ID, compiled.REVERSI_GAME_ID],
    );

    const invited = await fixture.handlers.get('games.invite')(
      fixture.event(),
      input({
        gameId: compiled.TIC_TAC_TOE_GAME_ID,
        gameVersion: compiled.TIC_TAC_TOE_GAME_VERSION,
      }),
    );
    assert.equal(invited.ok, true);
    assert.equal(invited.value.session.conversationId, CONTACT);
    assert.equal(fixture.sent[0][0], 'invite');

    const sessions = await fixture.handlers.get('games.sessions')(fixture.event(), input());
    assert.equal(sessions.ok, true);
    assert.equal(sessions.value.length, 1);
    const foreign = await fixture.handlers.get('games.sessions')(
      fixture.event(),
      input({ conversationId: 'mallory@example.invalid' }),
    );
    assert.equal(foreign.ok, true);
    assert.deepEqual(foreign.value, []);
  } finally {
    fixture.close();
  }
});

test('games IPC rejects MUC, malformed moves, foreign senders and secondary frames', async () => {
  const fixture = createFixture();
  try {
    const muc = await fixture.handlers.get('games.sessions')(
      fixture.event(),
      input({ conversationId: ROOM }),
    );
    assert.equal(muc.ok, false);
    assert.equal(muc.error.code, 'GAME_TRANSPORT_MUC_REJECTED');

    const invite = await fixture.handlers.get('games.invite')(
      fixture.event(),
      input({
        gameId: compiled.TIC_TAC_TOE_GAME_ID,
        gameVersion: compiled.TIC_TAC_TOE_GAME_VERSION,
      }),
    );
    const malformed = await fixture.handlers.get('games.move')(
      fixture.event(),
      input({
        sessionId: invite.value.session.sessionId,
        actor: 'initiator',
        move: () => undefined,
      }),
    );
    assert.equal(malformed.ok, false);
    assert.equal(malformed.error.code, 'INVALID_INPUT');

    const foreign = await fixture.handlers.get('games.catalog')(
      fixture.event(8),
      input({ requestId: 'foreign-catalog' }),
    );
    assert.equal(foreign.ok, false);
    assert.equal(foreign.error.code, 'UNAUTHORIZED');

    const secondary = await fixture.handlers.get('games.catalog')(
      { sender: { id: 7 }, secondary: true },
      input({ requestId: 'secondary-catalog' }),
    );
    assert.equal(secondary.ok, false);
    assert.equal(secondary.error.code, 'UNAUTHORIZED');
  } finally {
    fixture.close();
  }
});

test('game event subscriptions are sender/account/conversation scoped and revocable', async () => {
  const fixture = createFixture();
  try {
    const session = fixture.manager.create({
      accountId: ACCOUNT,
      conversationId: CONTACT,
      peerBareJid: CONTACT,
      gameId: compiled.TIC_TAC_TOE_GAME_ID,
      gameVersion: compiled.TIC_TAC_TOE_GAME_VERSION,
      localRole: 'initiator',
      sessionId: 'ipc-event-session',
    });
    const subscribed = await fixture.handlers.get('games.subscribe')(
      fixture.event(),
      input({ conversationId: CONTACT }),
    );
    assert.equal(subscribed.ok, true);
    fixture.publisher.publish({
      type: 'game.sessionChanged',
      correlationId: 'event-correlation',
      payload: { accountId: ACCOUNT, session },
    });
    assert.equal(fixture.messages.length, 1);
    assert.equal(fixture.messages[0][1], 'game.event');
    assert.equal(fixture.messages[0][2].payload.accountId, ACCOUNT);
    assert.equal(fixture.messages[0][2].payload.conversationId, CONTACT);

    const unsubscribed = await fixture.handlers.get('games.unsubscribe')(
      fixture.event(),
      input({ requestId: 'unsubscribe-1' }),
    );
    assert.equal(unsubscribed.ok, true);
    fixture.publisher.publish({
      type: 'game.sessionChanged',
      payload: { accountId: ACCOUNT, session },
    });
    assert.equal(fixture.messages.length, 1);
  } finally {
    fixture.close();
  }
});
