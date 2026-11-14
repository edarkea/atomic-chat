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

function createEndpoint(accountId, registry) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-games-2f-'));
  const persistence = new PersistenceStore(root);
  persistence.upsertAccount({
    accountId,
    host: 'example.invalid',
    port: 5222,
    tls: 1,
    credentialRef: null,
    createdAt: '2026-11-14T00:00:00.000Z',
  });
  const storage = new GameStorage(persistence.database);
  const manager = new GameSessionManager({
    registry,
    storage,
    idFactory: (() => {
      let sequence = 0;
      return () => `${accountId}-generated-${++sequence}`;
    })(),
    now: () => '2026-11-14T00:00:00.000Z',
  });
  const adapter = new XmppAdapter(false, persistence, [], null, null, null, null, false, {
    manager,
    registry,
  });
  const events = [];
  adapter.onEvent((event) => {
    if (event.type.startsWith('game.')) events.push(event);
  });
  return { root, persistence, manager, adapter, events };
}

function connectSimulatedPeers(left, right) {
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

function closeEndpoint(endpoint) {
  endpoint.adapter.disposeGames();
  endpoint.manager.dispose();
  endpoint.persistence.close();
  fs.rmSync(endpoint.root, { recursive: true, force: true });
}

function snapshot(endpoint, accountId, sessionId) {
  return endpoint.manager.recover(accountId).find((entry) => entry.session.sessionId === sessionId);
}

function assertConverged(alice, bob, sessionId) {
  const left = snapshot(alice, ALICE, sessionId);
  const right = snapshot(bob, BOB, sessionId);
  assert.ok(left);
  assert.ok(right);
  assert.equal(left.session.revision, right.session.revision);
  assert.equal(left.session.stateHash, right.session.stateHash);
  assert.deepEqual(left.snapshot, right.snapshot);
  assert.deepEqual(left.result, right.result);
  return { left, right };
}

async function startGame(alice, bob, gameId, gameVersion, sessionId) {
  const session = alice.manager.create({
    accountId: ALICE,
    conversationId: BOB,
    peerBareJid: BOB,
    gameId,
    gameVersion,
    localRole: 'initiator',
    sessionId,
  });
  await alice.adapter.sendGameInvite(ALICE, sessionId, `${sessionId}-invite`);
  await flush();
  await bob.adapter.games.sendAccept(BOB, sessionId, `${sessionId}-accept`);
  await flush();
  await alice.adapter.games.sendStart(ALICE, sessionId, `${sessionId}-start`);
  await flush();
  assert.equal(alice.manager.getSession(ALICE, sessionId).state, 'active');
  assert.equal(bob.manager.getSession(BOB, sessionId).state, 'active');
  assertConverged(alice, bob, sessionId);
  return session;
}

test('Tic Tac Toe completes victory, rejects invalid moves, persists deduplication and rematches', async () => {
  const registry = createRegistry();
  const alice = createEndpoint(ALICE, registry);
  const bob = createEndpoint(BOB, registry);
  connectSimulatedPeers(alice, bob);
  try {
    const sessionId = 'ttt-2f-victory';
    await startGame(
      alice,
      bob,
      compiled.TIC_TAC_TOE_GAME_ID,
      compiled.TIC_TAC_TOE_GAME_VERSION,
      sessionId,
    );

    await assert.rejects(
      alice.adapter.games.sendRematch(ALICE, sessionId, 'ttt-rematch-too-early'),
      { code: 'GAME_TRANSPORT_INVALID_TRANSITION' },
    );

    await assert.rejects(
      alice.adapter.sendGameMove(ALICE, {
        sessionId,
        actor: 'responder',
        move: { actor: 'responder', index: 0 },
        eventId: 'ttt-invalid-actor',
      }),
      { code: 'GAME_SESSION_ACTOR_CONFLICT' },
    );

    const first = await alice.adapter.sendGameMove(ALICE, {
      sessionId,
      actor: 'initiator',
      move: { actor: 'initiator', index: 0 },
      eventId: 'ttt-victory-1',
    });
    await flush();
    assertConverged(alice, bob, sessionId);

    await bob.adapter.sendGameMove(BOB, {
      sessionId,
      actor: 'responder',
      move: { actor: 'responder', index: 0 },
      eventId: 'ttt-occupied',
    });
    await flush();
    assert.equal(snapshot(alice, ALICE, sessionId).session.revision, 1);
    assert.equal(
      alice.events.some(
        (event) =>
          event.type === 'game.transportError' && event.payload.code === 'GAME_RULE_CELL_OCCUPIED',
      ),
      true,
    );

    const duplicateManager = new GameSessionManager({
      registry,
      storage: new GameStorage(alice.persistence.database),
      now: () => '2026-11-14T00:00:00.000Z',
    });
    try {
      const duplicate = duplicateManager.acceptSequencedEvent({
        accountId: ALICE,
        sessionId,
        expectedGeneration: 1,
        event: first.application.event,
      });
      assert.equal(duplicate.kind, 'duplicate');
    } finally {
      duplicateManager.dispose();
    }

    await assert.rejects(
      alice.adapter.sendGameMove(ALICE, {
        sessionId,
        actor: 'initiator',
        move: { actor: 'initiator', index: 3 },
        eventId: 'ttt-out-of-turn',
      }),
      { code: 'GAME_RULE_NOT_YOUR_TURN' },
    );

    await bob.adapter.sendGameMove(BOB, {
      sessionId,
      actor: 'responder',
      move: { actor: 'responder', index: 1 },
      eventId: 'ttt-victory-2',
    });
    await flush();
    await alice.adapter.sendGameMove(ALICE, {
      sessionId,
      actor: 'initiator',
      move: { actor: 'initiator', index: 3 },
      eventId: 'ttt-victory-3',
    });
    await flush();
    await bob.adapter.sendGameMove(BOB, {
      sessionId,
      actor: 'responder',
      move: { actor: 'responder', index: 2 },
      eventId: 'ttt-victory-4',
    });
    await flush();
    await alice.adapter.sendGameMove(ALICE, {
      sessionId,
      actor: 'initiator',
      move: { actor: 'initiator', index: 6 },
      eventId: 'ttt-victory-5',
    });
    await flush();

    const converged = assertConverged(alice, bob, sessionId);
    assert.equal(converged.left.session.state, 'finished');
    assert.equal(converged.left.snapshot.state.status, 'won');
    assert.equal(converged.left.snapshot.state.winner, 'initiator');
    assert.equal(converged.left.result.result.winner, 'initiator');
    await assert.rejects(
      alice.adapter.sendGameMove(ALICE, {
        sessionId,
        actor: 'initiator',
        move: { actor: 'initiator', index: 8 },
        eventId: 'ttt-after-finish',
      }),
      { code: 'GAME_SESSION_NOT_ACTIVE' },
    );

    const rematch = await alice.adapter.games.sendRematch(ALICE, sessionId, 'ttt-rematch');
    await flush();
    assert.notEqual(rematch.session.sessionId, sessionId);
    assert.equal(bob.manager.getSession(BOB, rematch.session.sessionId).localRole, 'responder');

    await bob.adapter.games.sendAccept(BOB, rematch.session.sessionId, 'ttt-rematch-accept');
    await flush();
    await alice.adapter.games.sendStart(ALICE, rematch.session.sessionId, 'ttt-rematch-start');
    await flush();
    const drawMoves = [
      ['initiator', 0],
      ['responder', 1],
      ['initiator', 2],
      ['responder', 4],
      ['initiator', 3],
      ['responder', 5],
      ['initiator', 7],
      ['responder', 6],
      ['initiator', 8],
    ];
    for (const [actor, index] of drawMoves) {
      const endpoint = actor === 'initiator' ? alice : bob;
      const accountId = actor === 'initiator' ? ALICE : BOB;
      await endpoint.adapter.sendGameMove(accountId, {
        sessionId: rematch.session.sessionId,
        actor,
        move: { actor, index },
        eventId: `ttt-draw-${index}`,
      });
      await flush();
    }
    const draw = assertConverged(alice, bob, rematch.session.sessionId);
    assert.equal(draw.left.snapshot.state.status, 'draw');
    assert.equal(draw.left.result.result.status, 'draw');
  } finally {
    closeEndpoint(alice);
    closeEndpoint(bob);
  }
});

test('Reversi completes a reproducible terminal game with passes and identical result', async () => {
  const registry = createRegistry();
  const alice = createEndpoint(ALICE, registry);
  const bob = createEndpoint(BOB, registry);
  connectSimulatedPeers(alice, bob);
  try {
    const sessionId = 'reversi-2f-full';
    await startGame(alice, bob, compiled.REVERSI_GAME_ID, compiled.REVERSI_GAME_VERSION, sessionId);
    let passCount = 0;
    for (let moveNumber = 0; moveNumber < 100; moveNumber += 1) {
      const current = snapshot(alice, ALICE, sessionId);
      const state = current.snapshot.state;
      if (state.status !== 'active') break;
      const actor = state.turn;
      const legal = compiled.reversiLegalMoves(state, actor);
      const move = legal.length
        ? { kind: 'place', actor, index: legal[0] }
        : (passCount++, { kind: 'pass', actor });
      const endpoint = actor === 'initiator' ? alice : bob;
      const accountId = actor === 'initiator' ? ALICE : BOB;
      await endpoint.adapter.sendGameMove(accountId, {
        sessionId,
        actor,
        move,
        eventId: `reversi-full-${moveNumber}`,
      });
      await flush();
      assertConverged(alice, bob, sessionId);
    }
    const terminal = assertConverged(alice, bob, sessionId);
    assert.equal(terminal.left.session.state, 'finished');
    assert.equal(terminal.left.snapshot.state.status, 'won');
    assert.equal(terminal.left.snapshot.state.board.length, 64);
    assert.equal(passCount > 0, true);
    assert.deepEqual(terminal.left.result, terminal.right.result);
  } finally {
    closeEndpoint(alice);
    closeEndpoint(bob);
  }
});

test('Reversi exposes and accepts a mandatory pass without speculative state', async () => {
  const registry = createRegistry();
  const alice = createEndpoint(ALICE, registry);
  const bob = createEndpoint(BOB, registry);
  connectSimulatedPeers(alice, bob);
  try {
    const sessionId = 'reversi-2f-pass';
    await startGame(alice, bob, compiled.REVERSI_GAME_ID, compiled.REVERSI_GAME_VERSION, sessionId);
    for (let moveNumber = 0; moveNumber < 100; moveNumber += 1) {
      const current = snapshot(alice, ALICE, sessionId);
      const state = current.snapshot.state;
      const actor = state.turn;
      const legal = compiled.reversiLegalMoves(state, actor);
      const endpoint = actor === 'initiator' ? alice : bob;
      const accountId = actor === 'initiator' ? ALICE : BOB;
      const move = legal.length
        ? { kind: 'place', actor, index: legal[0] }
        : { kind: 'pass', actor };
      await endpoint.adapter.sendGameMove(accountId, {
        sessionId,
        actor,
        move,
        eventId: `reversi-pass-${moveNumber}`,
      });
      await flush();
      if (!legal.length) {
        const afterPass = assertConverged(alice, bob, sessionId);
        assert.equal(afterPass.left.snapshot.state.consecutivePasses, 1);
        assert.equal(
          afterPass.left.snapshot.state.turn,
          actor === 'initiator' ? 'responder' : 'initiator',
        );
        return;
      }
    }
    assert.fail('The deterministic Reversi sequence did not reach a mandatory pass');
  } finally {
    closeEndpoint(alice);
    closeEndpoint(bob);
  }
});

test('two simultaneous sessions with one contact keep snapshots and revisions isolated', async () => {
  const registry = createRegistry();
  const alice = createEndpoint(ALICE, registry);
  const bob = createEndpoint(BOB, registry);
  connectSimulatedPeers(alice, bob);
  try {
    await startGame(
      alice,
      bob,
      compiled.TIC_TAC_TOE_GAME_ID,
      compiled.TIC_TAC_TOE_GAME_VERSION,
      'ttt-simultaneous',
    );
    await startGame(
      alice,
      bob,
      compiled.REVERSI_GAME_ID,
      compiled.REVERSI_GAME_VERSION,
      'reversi-simultaneous',
    );
    await alice.adapter.sendGameMove(ALICE, {
      sessionId: 'ttt-simultaneous',
      actor: 'initiator',
      move: { actor: 'initiator', index: 0 },
      eventId: 'simultaneous-ttt-1',
    });
    await flush();
    assert.equal(snapshot(alice, ALICE, 'ttt-simultaneous').session.revision, 1);
    assert.equal(snapshot(bob, BOB, 'ttt-simultaneous').session.revision, 1);
    assert.equal(snapshot(alice, ALICE, 'reversi-simultaneous').session.revision, 0);
    assert.equal(snapshot(bob, BOB, 'reversi-simultaneous').session.revision, 0);
  } finally {
    closeEndpoint(alice);
    closeEndpoint(bob);
  }
});
