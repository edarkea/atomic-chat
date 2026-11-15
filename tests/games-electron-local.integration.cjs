const { app, BrowserWindow, webContents, ipcMain } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const compiled = require('../electron/generated/games');
const { GameRegistry } = require('../electron/games/game-registry.cjs');
const { GameSessionManager } = require('../electron/games/game-session-manager.cjs');
const { GameStorage } = require('../electron/persistence/game-storage.cjs');
const { PersistenceStore } = require('../electron/persistence/storage.cjs');
const {
  createGameEventPublisher,
  registerGameHandlers,
} = require('../electron/ipc/ipc-game-handlers.cjs');
const { createIpcSenderGuard } = require('../electron/ipc/ipc-sender-guard.cjs');
const { XmppAdapter } = require('../electron/xmpp/xmpp-adapter.cjs');

const ALICE = 'alice@example.invalid';
const BOB = 'bob@example.invalid';
const ROOT = path.resolve(__dirname, '..');
const PAGE = path.join(ROOT, 'dist', 'atomic-chat', 'browser', 'index.html');
const PRELOAD = path.join(ROOT, 'electron', 'preload.cjs');

function descriptor(gameId, version, displayName) {
  return {
    gameId,
    displayName,
    version,
    apiVersion: 1,
    players: { min: 2, max: 2 },
    capabilities: ['invites', 'replay', 'resync', 'score'],
    distribution: 'official',
    source: 'built-in',
    enabled: true,
  };
}

function createRegistry() {
  const registry = new GameRegistry();
  registry.registerOfficial(
    descriptor(compiled.TIC_TAC_TOE_GAME_ID, compiled.TIC_TAC_TOE_GAME_VERSION, 'Tic-Tac-Toe'),
    compiled.ticTacToeRules,
  );
  registry.registerOfficial(
    descriptor(compiled.REVERSI_GAME_ID, compiled.REVERSI_GAME_VERSION, 'Reversi'),
    compiled.reversiRules,
  );
  return registry;
}

function createClient(accountId, peerBareJid, registry, root) {
  const persistence = new PersistenceStore(root);
  persistence.upsertAccount({
    accountId,
    host: 'example.invalid',
    port: 5222,
    tls: 1,
    transport: 'starttls',
    credentialRef: null,
    createdAt: '2026-11-14T00:00:00.000Z',
  });
  const manager = new GameSessionManager({
    registry,
    storage: new GameStorage(persistence.database),
    idFactory: () => `${accountId}-electron-session`,
    now: () => '2026-11-14T00:00:00.000Z',
  });
  const adapter = new XmppAdapter(false, persistence, [], null, null, null, null, false, {
    manager,
    registry,
  });
  adapter.sessions.set(accountId, {
    send: async (stanza) => {
      stanza.attrs.from = accountId;
      stanza.attrs.to = peerBareJid;
      clients.get(peerBareJid).adapter.handleStanza(peerBareJid, stanza);
    },
  });
  adapter.states.set(accountId, { accountId, status: 'connected' });
  adapter.sessionGenerations.set(accountId, 1);
  return { accountId, peerBareJid, persistence, manager, adapter, root };
}

const clients = new Map();

function createScopedRuntime(left, right, registry) {
  const byAccount = (accountId) => {
    const client = clients.get(accountId);
    if (!client) throw new Error('unknown test account');
    return client;
  };
  const managerMethods = [
    'getSession',
    'listSessions',
    'recover',
    'create',
    'accept',
    'reject',
    'cancel',
    'start',
    'finish',
    'abandon',
    'pause',
    'resume',
    'requireResync',
    'submitProposal',
    'acceptProposal',
    'acceptSequencedEvent',
  ];
  const gameSessions = {};
  for (const method of managerMethods)
    gameSessions[method] = (accountIdOrInput, ...rest) => {
      const accountId =
        typeof accountIdOrInput === 'string' ? accountIdOrInput : accountIdOrInput.accountId;
      return byAccount(accountId).manager[method](accountIdOrInput, ...rest);
    };
  gameSessions.dispose = () => {
    left.manager.dispose();
    right.manager.dispose();
  };

  const sessionGenerations = new Map([
    [left.accountId, left.adapter.sessionGenerations.get(left.accountId)],
    [right.accountId, right.adapter.sessionGenerations.get(right.accountId)],
  ]);
  const xmppMethods = [
    'sendGameInvite',
    'sendGameAccept',
    'sendGameReject',
    'sendGameCancel',
    'sendGameStart',
    'sendGameMove',
    'sendGameResign',
    'sendGameStateRequest',
    'sendGameRematch',
    'sendGameClose',
  ];
  const xmpp = {
    sessionGenerations,
    mucRooms: new Map(),
    mucDiscoveries: new Map(),
    bareJid: (jid) => String(jid).split('/')[0],
  };
  for (const method of xmppMethods)
    xmpp[method] = (accountId, ...args) => byAccount(accountId).adapter[method](accountId, ...args);

  return { gameRegistry: registry, gameSessions, xmpp };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

async function call(window, method, input) {
  const encoded = JSON.stringify(input);
  return window.webContents.executeJavaScript(
    `window.atomicChat.games.${method}(${encoded})`,
    true,
  );
}

async function subscribe(window, input) {
  const encoded = JSON.stringify(input);
  await window.webContents.executeJavaScript(
    `window.__atomicGameEvents = [];
     window.atomicChat.games.subscribe(${encoded}, (event) => window.__atomicGameEvents.push(event));
     Boolean(window.atomicChat?.games);`,
    true,
  );
}

async function events(window) {
  return window.webContents.executeJavaScript('window.__atomicGameEvents || []', true);
}

async function run() {
  if (!fs.existsSync(PAGE))
    throw new Error('Missing dist/atomic-chat/browser/index.html; run npm run build first');

  const registry = createRegistry();
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-games-electron-'));
  const aliceRoot = path.join(root, 'alice');
  const bobRoot = path.join(root, 'bob');
  fs.mkdirSync(aliceRoot);
  fs.mkdirSync(bobRoot);
  const alice = createClient(ALICE, BOB, registry, aliceRoot);
  const bob = createClient(BOB, ALICE, registry, bobRoot);
  clients.set(ALICE, alice);
  clients.set(BOB, bob);
  const runtime = createScopedRuntime(alice, bob, registry);
  const owners = new Map();
  const historySecurity = {
    authorize: (senderId, accountId) => owners.get(senderId) === accountId,
    destroySender: (senderId) => owners.delete(senderId),
  };
  const publisher = createGameEventPublisher({
    webContents,
    getRuntime: () => runtime,
    historySecurity,
  });
  const unsubscribeAlice = alice.adapter.onEvent((event) => {
    if (event.type.startsWith('game.')) publisher.publish(event);
  });
  const unsubscribeBob = bob.adapter.onEvent((event) => {
    if (event.type.startsWith('game.')) publisher.publish(event);
  });
  const assertSender = createIpcSenderGuard({
    BrowserWindow,
    packagedUrl: pathToFileURL(PAGE).href,
  });
  registerGameHandlers({
    ipcMain,
    assertSender,
    getRuntime: () => runtime,
    historySecurity,
    gameEventPublisher: publisher,
  });
  const harnessHandlers = [
    ['preferences.get', () => ({ ok: true, version: 1, value: {} })],
    ['updates.getStatus', () => ({ ok: true, version: 1, value: { state: 'idle' } })],
    ['connectionProfiles.list', () => ({ ok: true, version: 1, value: [] })],
  ];
  for (const [channel, handler] of harnessHandlers) ipcMain.handle(channel, handler);

  const windows = [];
  try {
    for (const accountId of [ALICE, BOB]) {
      const window = new BrowserWindow({
        show: false,
        webPreferences: {
          preload: PRELOAD,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      owners.set(window.webContents.id, accountId);
      await window.loadFile(PAGE);
      assert.equal(
        await window.webContents.executeJavaScript(
          'Boolean(window.atomicChat?.games && document.body)',
          true,
        ),
        true,
      );
      windows.push(window);
    }
    const aliceWindow = windows[0];
    const bobWindow = windows[1];
    await subscribe(aliceWindow, {
      version: 1,
      requestId: 'electron-subscribe-alice',
      accountId: ALICE,
      conversationId: BOB,
    });
    await subscribe(bobWindow, {
      version: 1,
      requestId: 'electron-subscribe-bob',
      accountId: BOB,
      conversationId: ALICE,
    });
    const catalog = await call(aliceWindow, 'catalog', {
      version: 1,
      requestId: 'electron-catalog',
      accountId: ALICE,
    });
    assert.equal(catalog.ok, true);
    assert.deepEqual(
      catalog.value.map((entry) => entry.gameId),
      [compiled.TIC_TAC_TOE_GAME_ID, compiled.REVERSI_GAME_ID],
    );

    const invite = await call(aliceWindow, 'invite', {
      version: 1,
      requestId: 'electron-invite',
      accountId: ALICE,
      conversationId: BOB,
      gameId: compiled.TIC_TAC_TOE_GAME_ID,
      gameVersion: compiled.TIC_TAC_TOE_GAME_VERSION,
    });
    assert.equal(invite.ok, true);
    await flush();
    const bobSessions = await call(bobWindow, 'sessions', {
      version: 1,
      requestId: 'electron-bob-sessions',
      accountId: BOB,
      conversationId: ALICE,
    });
    assert.equal(bobSessions.ok, true);
    assert.equal(bobSessions.value.length, 1);
    const bobSession = bobSessions.value[0];
    const accept = await call(bobWindow, 'accept', {
      version: 1,
      requestId: 'electron-accept',
      accountId: BOB,
      conversationId: ALICE,
      sessionId: bobSession.sessionId,
      sessionGeneration: bobSession.sessionGeneration,
      connectionGeneration: bobSession.connectionGeneration,
    });
    assert.equal(accept.ok, true);
    await flush();
    const aliceSessions = await call(aliceWindow, 'sessions', {
      version: 1,
      requestId: 'electron-alice-sessions',
      accountId: ALICE,
      conversationId: BOB,
    });
    const aliceSession = aliceSessions.value[0];
    const start = await call(aliceWindow, 'start', {
      version: 1,
      requestId: 'electron-start',
      accountId: ALICE,
      conversationId: BOB,
      sessionId: aliceSession.sessionId,
      sessionGeneration: aliceSession.sessionGeneration,
      connectionGeneration: aliceSession.connectionGeneration,
    });
    assert.equal(start.ok, true);
    await flush();
    const active = (
      await call(aliceWindow, 'sessions', {
        version: 1,
        requestId: 'electron-active-sessions',
        accountId: ALICE,
        conversationId: BOB,
      })
    ).value[0];
    const move = await call(aliceWindow, 'move', {
      version: 1,
      requestId: 'electron-move',
      accountId: ALICE,
      conversationId: BOB,
      sessionId: active.sessionId,
      sessionGeneration: active.sessionGeneration,
      connectionGeneration: active.connectionGeneration,
      actor: 'initiator',
      move: { actor: 'initiator', index: 0 },
    });
    assert.equal(move.ok, true);
    await flush();
    const moves = [
      [bobWindow, bobSession, 'responder', 1, 'electron-move-2'],
      [aliceWindow, active, 'initiator', 3, 'electron-move-3'],
      [bobWindow, bobSession, 'responder', 4, 'electron-move-4'],
      [aliceWindow, active, 'initiator', 6, 'electron-move-5'],
    ];
    for (const [window, sessionForMove, actor, index, requestId] of moves) {
      const nextMove = await call(window, 'move', {
        version: 1,
        requestId,
        accountId: window === bobWindow ? BOB : ALICE,
        conversationId: window === bobWindow ? ALICE : BOB,
        sessionId: active.sessionId,
        sessionGeneration: sessionForMove.sessionGeneration,
        connectionGeneration: sessionForMove.connectionGeneration,
        actor,
        move: { actor, index },
      });
      assert.equal(nextMove.ok, true);
      await flush();
    }
    const aliceSnapshot = await call(aliceWindow, 'snapshot', {
      version: 1,
      requestId: 'electron-alice-snapshot',
      accountId: ALICE,
      conversationId: BOB,
      sessionId: active.sessionId,
      sessionGeneration: active.sessionGeneration,
      connectionGeneration: active.connectionGeneration,
    });
    const bobSnapshot = await call(bobWindow, 'snapshot', {
      version: 1,
      requestId: 'electron-bob-snapshot',
      accountId: BOB,
      conversationId: ALICE,
      sessionId: active.sessionId,
      sessionGeneration: bobSession.sessionGeneration,
      connectionGeneration: bobSession.connectionGeneration,
    });
    assert.equal(aliceSnapshot.ok, true);
    assert.equal(bobSnapshot.ok, true);
    assert.equal(aliceSnapshot.value.stateHash, bobSnapshot.value.stateHash);
    assert.equal(aliceSnapshot.value.revision, 5);
    assert.equal(bobSnapshot.value.revision, 5);
    const finishedAlice = await call(aliceWindow, 'sessions', {
      version: 1,
      requestId: 'electron-finished-alice',
      accountId: ALICE,
      conversationId: BOB,
    });
    const finishedBob = await call(bobWindow, 'sessions', {
      version: 1,
      requestId: 'electron-finished-bob',
      accountId: BOB,
      conversationId: ALICE,
    });
    assert.equal(finishedAlice.value[0].state, 'finished');
    assert.equal(finishedBob.value[0].state, 'finished');
    const foreign = await call(bobWindow, 'sessions', {
      version: 1,
      requestId: 'electron-foreign-account',
      accountId: ALICE,
      conversationId: BOB,
    });
    assert.equal(foreign.ok, false);
    assert.equal(foreign.error.code, 'UNAUTHORIZED');
    const eventCounts = {
      alice: (await events(aliceWindow)).length,
      bob: (await events(bobWindow)).length,
    };
    assert.equal(eventCounts.alice > 0, true);
    assert.equal(eventCounts.bob > 0, true);
    console.log(
      JSON.stringify({
        suite: 'games-electron-local',
        evidenceLevel: 2,
        result: 'PASS',
        sessionId: active.sessionId,
        revision: aliceSnapshot.value.revision,
        finished: finishedAlice.value[0].state === 'finished',
        stateHash: aliceSnapshot.value.stateHash,
        eventCounts,
        network: 'disabled; simulated adapter transport only',
      }),
    );
  } finally {
    for (const window of windows) {
      owners.delete(window.webContents.id);
      publisher.clearSender(window.webContents.id);
      if (!window.isDestroyed()) await window.close();
    }
    unsubscribeAlice();
    unsubscribeBob();
    alice.adapter.disposeGames();
    bob.adapter.disposeGames();
    runtime.gameSessions.dispose();
    alice.persistence.close();
    bob.persistence.close();
    clients.clear();
    fs.rmSync(root, { recursive: true, force: true });
    for (const channel of [
      'games.catalog',
      'games.sessions',
      'games.snapshot',
      'games.invite',
      'games.accept',
      'games.reject',
      'games.cancel',
      'games.start',
      'games.move',
      'games.resign',
      'games.resync',
      'games.rematch',
      'games.close',
      'games.subscribe',
      'games.unsubscribe',
    ])
      ipcMain.removeHandler(channel);
    for (const [channel] of harnessHandlers) ipcMain.removeHandler(channel);
  }
}

app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-gpu');
app
  .whenReady()
  .then(run)
  .then(() => app.exit(0))
  .catch((error) => {
    console.error(
      JSON.stringify({ suite: 'games-electron-local', result: 'FAIL', message: error.message }),
    );
    app.exit(1);
  });
