const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { xml } = require('@xmpp/client');
const compiled = require('../electron/generated/games');
const { GameRegistry } = require('../electron/games/game-registry.cjs');
const { GameSessionManager } = require('../electron/games/game-session-manager.cjs');
const { GameStorage } = require('../electron/persistence/game-storage.cjs');
const { PersistenceStore } = require('../electron/persistence/storage.cjs');
const { XmppAdapter } = require('../electron/xmpp/xmpp-adapter.cjs');
const { GAME_NAMESPACE, createGameElement } = require('../electron/xmpp/xmpp-games.cjs');

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

function account(accountId) {
  return {
    accountId,
    host: 'example.invalid',
    port: 5222,
    tls: 1,
    credentialRef: null,
    createdAt: '2026-11-13T00:00:00.000Z',
  };
}

function createEndpoint(accountId, registry) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-xmpp-games-'));
  const persistence = new PersistenceStore(root);
  persistence.upsertAccount(account(accountId));
  const storage = new GameStorage(persistence.database);
  const manager = new GameSessionManager({
    registry,
    storage,
    idFactory: (() => {
      let sequence = 0;
      return () => `${accountId}-id-${++sequence}`;
    })(),
    now: () => '2026-11-13T00:00:00.000Z',
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

function connectSimulatedPeers(
  left,
  leftAccount,
  right,
  rightAccount,
  leftGeneration = 1,
  rightGeneration = 1,
) {
  const leftSession = {
    send: async (stanza) => {
      stanza.attrs.from = leftAccount;
      stanza.attrs.to = rightAccount;
      right.adapter.handleStanza(rightAccount, stanza);
    },
  };
  const rightSession = {
    send: async (stanza) => {
      stanza.attrs.from = rightAccount;
      stanza.attrs.to = leftAccount;
      left.adapter.handleStanza(leftAccount, stanza);
    },
  };
  left.adapter.sessions.set(leftAccount, leftSession);
  right.adapter.sessions.set(rightAccount, rightSession);
  left.adapter.states.set(leftAccount, { accountId: leftAccount, status: 'connected' });
  right.adapter.states.set(rightAccount, { accountId: rightAccount, status: 'connected' });
  left.adapter.sessionGenerations.set(leftAccount, leftGeneration);
  right.adapter.sessionGenerations.set(rightAccount, rightGeneration);
  return { leftSession, rightSession };
}

async function flush() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function closeEndpoint(endpoint) {
  endpoint.adapter.disposeGames();
  endpoint.persistence.close();
  fs.rmSync(endpoint.root, { recursive: true, force: true });
}

test('two simulated XMPP adapters converge Tic-Tac-Toe without creating ordinary messages', async () => {
  const registry = createRegistry();
  const alice = createEndpoint(ALICE, registry);
  const bob = createEndpoint(BOB, registry);
  connectSimulatedPeers(alice, ALICE, bob, BOB);
  try {
    const session = alice.manager.create({
      accountId: ALICE,
      conversationId: BOB,
      peerBareJid: BOB,
      gameId: compiled.TIC_TAC_TOE_GAME_ID,
      gameVersion: compiled.TIC_TAC_TOE_GAME_VERSION,
      localRole: 'initiator',
      sessionId: 'ttt-session-1',
    });
    await alice.adapter.sendGameInvite(ALICE, session.sessionId, 'invite-1');
    await flush();
    assert.equal(bob.manager.getSession(BOB, session.sessionId).localRole, 'responder');
    await alice.adapter.sendGameInvite(ALICE, session.sessionId, 'invite-duplicate');
    await flush();
    assert.equal(
      bob.events.some((event) => event.type === 'game.invitationUpdated'),
      true,
    );

    await bob.adapter.games.sendAccept(BOB, session.sessionId, 'accept-1');
    await flush();
    await alice.adapter.games.sendStart(ALICE, session.sessionId, 'start-1');
    await flush();
    assert.equal(alice.manager.getSession(ALICE, session.sessionId).state, 'active');
    assert.equal(bob.manager.getSession(BOB, session.sessionId).state, 'active');

    await alice.adapter.sendGameMove(ALICE, {
      sessionId: session.sessionId,
      actor: 'initiator',
      move: { actor: 'initiator', index: 0 },
      eventId: 'move-1',
    });
    await flush();
    await bob.adapter.sendGameMove(BOB, {
      sessionId: session.sessionId,
      actor: 'responder',
      move: { actor: 'responder', index: 1 },
      eventId: 'move-2',
    });
    await flush();

    const aliceSession = alice.manager.getSession(ALICE, session.sessionId);
    const bobSession = bob.manager.getSession(BOB, session.sessionId);
    assert.equal(aliceSession.revision, 2);
    assert.equal(bobSession.revision, 2);
    assert.equal(aliceSession.stateHash, bobSession.stateHash);
    assert.equal(
      alice.events.some((event) => event.type === 'game.moveConfirmed'),
      true,
    );
    assert.equal(
      bob.events.some((event) => event.type === 'game.moveConfirmed'),
      true,
    );
    assert.equal(
      alice.events.some((event) => event.type === 'message.received'),
      false,
    );
    assert.equal(
      bob.events.some((event) => event.type === 'message.received'),
      false,
    );

    await alice.adapter.sendGameStateRequest(ALICE, session.sessionId, 'state-1');
    await flush();
    assert.equal(
      alice.events.some((event) => event.type === 'game.stateSynchronized'),
      true,
    );

    const before = alice.manager.getSession(ALICE, session.sessionId);
    const malformed = xml(
      'message',
      { type: 'chat', from: BOB, to: ALICE },
      xml('game', {
        xmlns: GAME_NAMESPACE,
        kind: 'move',
        'event-id': 'malformed',
        'session-id': session.sessionId,
        'api-version': '1',
        'connection-generation': '1',
        'conversation-id': BOB,
      }),
    );
    alice.adapter.handleStanza(ALICE, malformed);
    await flush();
    assert.equal(alice.manager.getSession(ALICE, session.sessionId).revision, before.revision);
    assert.equal(
      alice.events.some((event) => event.type === 'game.transportError'),
      true,
    );
  } finally {
    closeEndpoint(alice);
    closeEndpoint(bob);
  }
});

test('independent XMPP connection generations do not reject a valid peer event', async () => {
  const registry = createRegistry();
  const alice = createEndpoint(ALICE, registry);
  const bob = createEndpoint(BOB, registry);
  connectSimulatedPeers(alice, ALICE, bob, BOB, 7, 3);
  try {
    const session = alice.manager.create({
      accountId: ALICE,
      conversationId: BOB,
      peerBareJid: BOB,
      gameId: compiled.TIC_TAC_TOE_GAME_ID,
      gameVersion: compiled.TIC_TAC_TOE_GAME_VERSION,
      localRole: 'initiator',
      sessionId: 'ttt-independent-generations',
    });
    await alice.adapter.sendGameInvite(ALICE, session.sessionId);
    await flush();
    assert.equal(bob.manager.getSession(BOB, session.sessionId).localRole, 'responder');
    assert.equal(
      bob.events.some((event) => event.type === 'game.transportError'),
      false,
    );
  } finally {
    closeEndpoint(alice);
    closeEndpoint(bob);
  }
});

test('propagates an invitation rejection back to the initiator', async () => {
  const registry = createRegistry();
  const alice = createEndpoint(ALICE, registry);
  const bob = createEndpoint(BOB, registry);
  connectSimulatedPeers(alice, ALICE, bob, BOB);
  try {
    const session = alice.manager.create({
      accountId: ALICE,
      conversationId: BOB,
      peerBareJid: BOB,
      gameId: compiled.TIC_TAC_TOE_GAME_ID,
      gameVersion: compiled.TIC_TAC_TOE_GAME_VERSION,
      localRole: 'initiator',
      sessionId: 'ttt-rejected-invitation',
    });

    await alice.adapter.sendGameInvite(ALICE, session.sessionId, 'invite-rejected');
    await flush();
    await bob.adapter.games.sendReject(BOB, session.sessionId, 'reject-invitation');
    await flush();

    assert.equal(alice.manager.getSession(ALICE, session.sessionId).state, 'rejected');
    assert.equal(bob.manager.getSession(BOB, session.sessionId).state, 'rejected');
    assert.equal(
      alice.events.some(
        (event) =>
          event.type === 'game.sessionChanged' && event.payload.session.state === 'rejected',
      ),
      true,
    );
  } finally {
    closeEndpoint(alice);
    closeEndpoint(bob);
  }
});

test('propagates explicit game closure to both direct conversations', async () => {
  const registry = createRegistry();
  const alice = createEndpoint(ALICE, registry);
  const bob = createEndpoint(BOB, registry);
  connectSimulatedPeers(alice, ALICE, bob, BOB);
  try {
    const session = alice.manager.create({
      accountId: ALICE,
      conversationId: BOB,
      peerBareJid: BOB,
      gameId: compiled.TIC_TAC_TOE_GAME_ID,
      gameVersion: compiled.TIC_TAC_TOE_GAME_VERSION,
      localRole: 'initiator',
      sessionId: 'ttt-closed-session',
    });

    await alice.adapter.sendGameInvite(ALICE, session.sessionId, 'invite-closed');
    await flush();
    await bob.adapter.games.sendAccept(BOB, session.sessionId, 'accept-closed');
    await flush();
    await alice.adapter.games.sendStart(ALICE, session.sessionId, 'start-closed');
    await flush();
    await alice.adapter.games.sendFinish(ALICE, session.sessionId, 'finish-closed');
    await flush();
    await alice.adapter.games.sendClose(ALICE, session.sessionId, 'close-closed');
    await flush();

    assert.equal(alice.manager.getSession(ALICE, session.sessionId).state, 'closed');
    assert.equal(bob.manager.getSession(BOB, session.sessionId).state, 'closed');
    assert.equal(
      bob.events.some(
        (event) => event.type === 'game.sessionChanged' && event.payload.session.state === 'closed',
      ),
      true,
    );
  } finally {
    closeEndpoint(alice);
    closeEndpoint(bob);
  }
});

test('bare-JID identity survives a peer resource change without replaying the move', async () => {
  const registry = createRegistry();
  const alice = createEndpoint(ALICE, registry);
  const bob = createEndpoint(BOB, registry);
  connectSimulatedPeers(alice, ALICE, bob, BOB);
  try {
    const session = alice.manager.create({
      accountId: ALICE,
      conversationId: BOB,
      peerBareJid: BOB,
      gameId: compiled.TIC_TAC_TOE_GAME_ID,
      gameVersion: compiled.TIC_TAC_TOE_GAME_VERSION,
      localRole: 'initiator',
      sessionId: 'ttt-resource-change',
    });
    await alice.adapter.sendGameInvite(ALICE, session.sessionId, 'resource-invite');
    await flush();
    bob.adapter.sessions.set(BOB, {
      send: async (stanza) => {
        stanza.attrs.from = `${BOB}/second-device`;
        stanza.attrs.to = `${ALICE}/desktop`;
        alice.adapter.handleStanza(ALICE, stanza);
      },
    });
    await bob.adapter.games.sendAccept(BOB, session.sessionId, 'resource-accept');
    await flush();
    assert.equal(alice.manager.getSession(ALICE, session.sessionId).state, 'accepted');
    assert.equal(
      alice.events.some((event) => event.type === 'game.transportError'),
      false,
    );
  } finally {
    closeEndpoint(alice);
    closeEndpoint(bob);
  }
});

test('game extensions inside a Message Carbon are ignored without entering chat or game state', async () => {
  const registry = createRegistry();
  const alice = createEndpoint(ALICE, registry);
  const bob = createEndpoint(BOB, registry);
  connectSimulatedPeers(alice, ALICE, bob, BOB);
  try {
    const carbon = xml(
      'message',
      { type: 'chat', from: `${ALICE}/desktop`, to: ALICE },
      xml(
        'received',
        { xmlns: 'urn:xmpp:carbons:2' },
        xml(
          'forwarded',
          { xmlns: 'urn:xmpp:forward:0' },
          xml(
            'message',
            { type: 'chat', from: `${BOB}/second-device`, to: `${ALICE}/desktop` },
            createGameElement({
              kind: 'invite',
              eventId: 'carbon-game-event',
              sessionId: 'carbon-game-session',
              gameId: compiled.TIC_TAC_TOE_GAME_ID,
              gameVersion: compiled.TIC_TAC_TOE_GAME_VERSION,
              conversationId: BOB,
              connectionGeneration: 1,
            }),
          ),
        ),
      ),
    );
    alice.adapter.handleStanza(ALICE, carbon);
    await flush();
    assert.equal(alice.manager.getSession(ALICE, 'carbon-game-session'), undefined);
    assert.equal(
      alice.events.some((event) => event.type === 'message.received'),
      false,
    );
    assert.equal(
      alice.events.some((event) => event.type === 'game.transportError'),
      false,
    );
  } finally {
    closeEndpoint(alice);
    closeEndpoint(bob);
  }
});

test('simulated XMPP adapters reproduce a Reversi capture with the same hash', async () => {
  const registry = createRegistry();
  const alice = createEndpoint(ALICE, registry);
  const bob = createEndpoint(BOB, registry);
  connectSimulatedPeers(alice, ALICE, bob, BOB);
  try {
    const session = alice.manager.create({
      accountId: ALICE,
      conversationId: BOB,
      peerBareJid: BOB,
      gameId: compiled.REVERSI_GAME_ID,
      gameVersion: compiled.REVERSI_GAME_VERSION,
      localRole: 'initiator',
      sessionId: 'reversi-session-1',
    });
    await alice.adapter.sendGameInvite(ALICE, session.sessionId);
    await flush();
    await bob.adapter.games.sendAccept(BOB, session.sessionId);
    await flush();
    await alice.adapter.games.sendStart(ALICE, session.sessionId);
    await flush();
    await alice.adapter.sendGameMove(ALICE, {
      sessionId: session.sessionId,
      actor: 'initiator',
      move: { kind: 'place', actor: 'initiator', index: 19 },
      eventId: 'reversi-move-1',
    });
    await flush();
    const aliceSnapshot = alice.manager.recover(ALICE)[0].snapshot;
    const bobSnapshot = bob.manager.recover(BOB)[0].snapshot;
    assert.equal(aliceSnapshot.revision, 1);
    assert.equal(aliceSnapshot.state.board[19], 'initiator');
    assert.equal(aliceSnapshot.state.board[27], 'initiator');
    assert.deepEqual(bobSnapshot, aliceSnapshot);
  } finally {
    closeEndpoint(alice);
    closeEndpoint(bob);
  }
});

test('stale, MUC and foreign game stanzas are rejected without mutating the session', async () => {
  const registry = createRegistry();
  const alice = createEndpoint(ALICE, registry);
  const bob = createEndpoint(BOB, registry);
  connectSimulatedPeers(alice, ALICE, bob, BOB);
  try {
    const session = alice.manager.create({
      accountId: ALICE,
      conversationId: BOB,
      peerBareJid: BOB,
      gameId: compiled.TIC_TAC_TOE_GAME_ID,
      gameVersion: compiled.TIC_TAC_TOE_GAME_VERSION,
      localRole: 'initiator',
      sessionId: 'ttt-session-2',
    });
    const event = {
      xmlns: GAME_NAMESPACE,
      kind: 'invite',
      'event-id': 'foreign-invite',
      'session-id': session.sessionId,
      'game-id': compiled.TIC_TAC_TOE_GAME_ID,
      'game-version': compiled.TIC_TAC_TOE_GAME_VERSION,
      'api-version': '1',
      'connection-generation': '99',
      'conversation-id': BOB,
    };
    alice.adapter.handleStanza(
      ALICE,
      xml(
        'message',
        { type: 'chat', from: 'mallory@example.invalid', to: ALICE },
        xml('game', event),
      ),
    );
    alice.adapter.handleStanza(
      ALICE,
      xml('message', { type: 'groupchat', from: BOB, to: ALICE }, xml('game', event)),
    );
    await flush();
    assert.equal(alice.manager.getSession(ALICE, session.sessionId).revision, 0);
    assert.equal(
      alice.events.filter((item) => item.type === 'game.transportError').length >= 2,
      true,
    );
  } finally {
    closeEndpoint(alice);
    closeEndpoint(bob);
  }
});

test('disconnect pauses active games and a new connection generation requests state without auto-resuming', async () => {
  const registry = createRegistry();
  const alice = createEndpoint(ALICE, registry);
  const bob = createEndpoint(BOB, registry);
  const peers = connectSimulatedPeers(alice, ALICE, bob, BOB);
  try {
    const session = alice.manager.create({
      accountId: ALICE,
      conversationId: BOB,
      peerBareJid: BOB,
      gameId: compiled.TIC_TAC_TOE_GAME_ID,
      gameVersion: compiled.TIC_TAC_TOE_GAME_VERSION,
      localRole: 'initiator',
      sessionId: 'ttt-session-3',
    });
    await alice.adapter.sendGameInvite(ALICE, session.sessionId);
    await flush();
    await bob.adapter.games.sendAccept(BOB, session.sessionId);
    await flush();
    await alice.adapter.games.sendStart(ALICE, session.sessionId);
    await flush();
    alice.adapter.handleSessionEvent(ALICE, peers.leftSession, 'offline');
    assert.equal(alice.manager.getSession(ALICE, session.sessionId).state, 'paused');
    const newSession = {
      send: async (stanza) => {
        stanza.attrs.from = ALICE;
        stanza.attrs.to = BOB;
        bob.adapter.handleStanza(BOB, stanza);
      },
    };
    alice.adapter.sessions.set(ALICE, newSession);
    alice.adapter.sessionGenerations.set(ALICE, 2);
    bob.adapter.sessionGenerations.set(BOB, 2);
    alice.adapter.handleSessionEvent(ALICE, newSession, 'online');
    await flush();
    assert.equal(alice.manager.getSession(ALICE, session.sessionId).state, 'paused');
    assert.equal(
      alice.events.some((event) => event.type === 'game.stateSynchronized'),
      true,
    );
  } finally {
    closeEndpoint(alice);
    closeEndpoint(bob);
  }
});
