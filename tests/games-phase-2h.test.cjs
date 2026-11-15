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
const { XmppAdapter } = require('../electron/xmpp/xmpp-adapter.cjs');

const ALICE = 'alice@example.invalid';
const BOB = 'bob@example.invalid';
const TTT = compiled.TIC_TAC_TOE_GAME_ID;
const TTT_VERSION = compiled.TIC_TAC_TOE_GAME_VERSION;

function registry() {
  const value = new GameRegistry();
  value.registerOfficial(
    {
      gameId: TTT,
      displayName: 'Tic-Tac-Toe',
      version: TTT_VERSION,
      apiVersion: 1,
      players: { min: 2, max: 2 },
      capabilities: ['invites', 'replay', 'resync', 'score'],
      distribution: 'official',
      source: 'built-in',
      enabled: true,
    },
    compiled.ticTacToeRules,
  );
  return value;
}

function endpoint(accountId, limits) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-games-2h-'));
  const persistence = new PersistenceStore(root);
  persistence.upsertAccount({
    accountId,
    host: 'example.invalid',
    port: 5222,
    tls: 1,
    credentialRef: null,
    createdAt: '2026-11-14T00:00:00.000Z',
  });
  const value = registry();
  const storage = new GameStorage(persistence.database);
  const manager = new GameSessionManager({
    registry: value,
    storage,
    limits,
    idFactory: (() => {
      let index = 0;
      return () => `${accountId}-2h-${++index}`;
    })(),
    now: () => '2026-11-14T00:00:00.000Z',
  });
  const adapter = new XmppAdapter(false, persistence, [], null, null, null, null, false, {
    manager,
    registry: value,
    limits,
  });
  const events = [];
  adapter.onEvent((event) => {
    if (event.type.startsWith('game.')) events.push(event);
  });
  return { root, persistence, storage, manager, adapter, events };
}

function connect(left, right) {
  left.adapter.sessions.set(ALICE, {
    send: async (stanza) => {
      stanza.attrs.from = ALICE;
      stanza.attrs.to = BOB;
      right.adapter.handleStanza(BOB, stanza);
    },
  });
  right.adapter.sessions.set(BOB, {
    send: async (stanza) => {
      stanza.attrs.from = BOB;
      stanza.attrs.to = ALICE;
      left.adapter.handleStanza(ALICE, stanza);
    },
  });
  left.adapter.states.set(ALICE, { accountId: ALICE, status: 'connected' });
  right.adapter.states.set(BOB, { accountId: BOB, status: 'connected' });
  left.adapter.sessionGenerations.set(ALICE, 1);
  right.adapter.sessionGenerations.set(BOB, 1);
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function session(manager, accountId, peerBareJid, sessionId) {
  return manager.create({
    accountId,
    conversationId: peerBareJid,
    peerBareJid,
    gameId: TTT,
    gameVersion: TTT_VERSION,
    localRole: 'initiator',
    sessionId,
  });
}

function close(...endpoints) {
  for (const value of endpoints) {
    value.adapter.disposeGames();
    value.manager.dispose();
    value.persistence.close();
    fs.rmSync(value.root, { recursive: true, force: true });
  }
}

test('session admission limits are per account, peer, and pending state', () => {
  const value = endpoint(ALICE, {
    maxSessionsPerAccount: 5,
    maxSessionsPerPeer: 2,
    maxPendingSessionsPerAccount: 3,
  });
  try {
    session(value.manager, ALICE, BOB, 's1');
    session(value.manager, ALICE, BOB, 's2');
    assert.throws(
      () => session(value.manager, ALICE, BOB, 's3'),
      (error) => error.code === 'GAME_SESSION_LIMIT_PEER',
    );
    for (const id of ['s1', 's2']) {
      value.manager.accept({ accountId: ALICE, sessionId: id, expectedGeneration: 1 });
      value.manager.start({ accountId: ALICE, sessionId: id, expectedGeneration: 1 });
    }
    session(value.manager, ALICE, 'carol@example.invalid', 's3');
    session(value.manager, ALICE, 'dave@example.invalid', 's4');
    session(value.manager, ALICE, 'erin@example.invalid', 's5');
    assert.throws(
      () => session(value.manager, ALICE, 'frank@example.invalid', 's6'),
      (error) => error.code === 'GAME_SESSION_LIMIT_ACCOUNT',
    );
  } finally {
    close(value);
  }

  const pending = endpoint(ALICE, {
    maxSessionsPerAccount: 8,
    maxSessionsPerPeer: 8,
    maxPendingSessionsPerAccount: 1,
  });
  try {
    session(pending.manager, ALICE, BOB, 'pending-1');
    assert.throws(
      () => session(pending.manager, ALICE, 'carol@example.invalid', 'pending-2'),
      (error) => error.code === 'GAME_SESSION_LIMIT_PENDING',
    );
  } finally {
    close(pending);
  }
});

test('duplicate storms are bounded and rate limits do not cross accounts', async () => {
  const alice = endpoint(ALICE, {
    maxEventsPerWindow: 2,
    eventWindowMs: 1000,
    maxRateScopesPerAccount: 16,
  });
  const bob = endpoint(BOB, {
    maxEventsPerWindow: 2,
    eventWindowMs: 1000,
    maxRateScopesPerAccount: 16,
  });
  connect(alice, bob);
  try {
    const created = session(alice.manager, ALICE, BOB, 'rate-session');
    await alice.adapter.sendGameInvite(ALICE, created.sessionId, 'invite-1');
    await alice.adapter.sendGameInvite(ALICE, created.sessionId, 'invite-2');
    await assert.rejects(
      alice.adapter.sendGameInvite(ALICE, created.sessionId, 'invite-3'),
      (error) => error.code === 'GAME_TRANSPORT_RATE_LIMITED',
    );
    assert.equal(bob.adapter.games.diagnostics().seenEvents, 2);
    assert.equal(bob.manager.getSession(BOB, created.sessionId).state, 'invited');
    assert.equal(alice.adapter.games.diagnostics().rateScopes, 1);
  } finally {
    close(alice, bob);
  }
});

test('pending state requests are capped and connection cleanup releases bounded state', async () => {
  const value = endpoint(ALICE, {
    maxStateRequestsPerSession: 1,
    maxPendingAcksPerSession: 1,
  });
  try {
    const created = session(value.manager, ALICE, BOB, 'pending-session');
    value.manager.accept({ accountId: ALICE, sessionId: created.sessionId, expectedGeneration: 1 });
    value.manager.start({ accountId: ALICE, sessionId: created.sessionId, expectedGeneration: 1 });
    value.adapter.sessions.set(ALICE, { send: async () => undefined });
    value.adapter.states.set(ALICE, { accountId: ALICE, status: 'connected' });
    value.adapter.sessionGenerations.set(ALICE, 1);
    await value.adapter.games.sendStateRequest(ALICE, created.sessionId, 'state-1');
    assert.equal(value.adapter.games.diagnostics().stateRequests, 1);
    await assert.rejects(
      value.adapter.games.sendStateRequest(ALICE, created.sessionId, 'state-2'),
      (error) => error.code === 'GAME_TRANSPORT_PENDING_LIMIT',
    );
    value.adapter.games.clear(ALICE);
    assert.deepEqual(value.adapter.games.diagnostics(), {
      pendingAcks: 0,
      stateRequests: 0,
      seenEvents: 0,
      seenScopes: 0,
      rateScopes: 0,
      limits: value.adapter.games.diagnostics().limits,
    });
  } finally {
    close(value);
  }
});

test('divergent snapshots remain resync-required without unsafe remote installation', async () => {
  const alice = endpoint(ALICE);
  const bob = endpoint(BOB);
  connect(alice, bob);
  try {
    const created = session(alice.manager, ALICE, BOB, 'divergent-session');
    await alice.adapter.sendGameInvite(ALICE, created.sessionId, 'invite');
    await flush();
    await bob.adapter.games.sendAccept(BOB, created.sessionId, 'accept');
    await flush();
    await alice.adapter.games.sendStart(ALICE, created.sessionId, 'start');
    await flush();
    const divergentState = compiled.ticTacToeRules.applyMove(
      compiled.ticTacToeRules.initialState(),
      { actor: 'initiator', index: 0 },
    ).value;
    const divergentHash = compiled.ticTacToeRules.hashState(divergentState);
    bob.storage.database
      .prepare(
        'INSERT INTO game_snapshots (account_id, session_id, revision, state_hash, state_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(
        BOB,
        created.sessionId,
        1,
        divergentHash,
        JSON.stringify(divergentState),
        '2026-11-14T00:00:01.000Z',
      );
    bob.storage.database
      .prepare(
        'UPDATE game_sessions SET revision = 1, state_hash = ?, updated_at = ? WHERE account_id = ? AND session_id = ?',
      )
      .run(divergentHash, '2026-11-14T00:00:01.000Z', BOB, created.sessionId);
    await alice.adapter.games.sendStateRequest(ALICE, created.sessionId, 'divergence');
    await flush();
    const local = alice.manager.getSession(ALICE, created.sessionId);
    assert.equal(local.state, 'resync-required');
    assert.equal(local.revision, 0);
    assert.notEqual(local.stateHash, divergentHash);
    assert.equal(
      alice.events.some((event) => event.type === 'game.syncRequired'),
      true,
    );
  } finally {
    close(alice, bob);
  }
});

test('storage statistics persist accepted history without automatic compaction', async () => {
  const value = endpoint(ALICE);
  const databaseRoot = value.root;
  try {
    const created = session(value.manager, ALICE, BOB, 'stats-session');
    value.manager.accept({ accountId: ALICE, sessionId: created.sessionId, expectedGeneration: 1 });
    value.manager.start({ accountId: ALICE, sessionId: created.sessionId, expectedGeneration: 1 });
    value.manager.submitProposal({
      accountId: ALICE,
      sessionId: created.sessionId,
      expectedGeneration: 1,
      actor: 'initiator',
      move: { actor: 'initiator', index: 0 },
    });
    const before = value.storage.getStats(ALICE);
    assert.deepEqual(
      {
        sessions: before.sessions,
        events: before.events,
        snapshots: before.snapshots,
        results: before.results,
      },
      { sessions: 1, events: 1, snapshots: 2, results: 0 },
    );
  } finally {
    value.adapter.disposeGames();
    value.manager.dispose();
    value.persistence.close();
  }
  const reopened = new PersistenceStore(databaseRoot);
  try {
    const storage = new GameStorage(reopened.database);
    assert.equal(storage.getStats(ALICE).events, 1);
    assert.equal(storage.getStats(ALICE).snapshots, 2);
  } finally {
    reopened.close();
    fs.rmSync(databaseRoot, { recursive: true, force: true });
  }
});
