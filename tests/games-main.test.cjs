const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const compiled = require('../electron/generated/games');
const { GameRegistry } = require('../electron/games/game-registry.cjs');
const { GameSessionManager } = require('../electron/games/game-session-manager.cjs');
const { GameStorage } = require('../electron/persistence/game-storage.cjs');
const { SchemaMigrator } = require('../electron/persistence/schema-migrator.cjs');

const descriptor = (gameId, version, displayName) => ({
  gameId,
  displayName,
  version,
  apiVersion: 1,
  players: { min: 2, max: 2 },
  capabilities: ['invites', 'replay', 'resync', 'score'],
  distribution: 'official',
  source: 'built-in',
  enabled: true,
});

function createDatabase() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-games-'));
  const database = new Database(path.join(directory, 'games.sqlite'));
  database.pragma('foreign_keys = ON');
  new SchemaMigrator(database).migrate();
  database
    .prepare(
      "INSERT INTO accounts (account_id, endpoint_host, endpoint_port, tls, transport, credential_ref, created_at) VALUES ('account-a', 'example.invalid', 5222, 1, 'direct-tls', NULL, '2026-11-13T00:00:00.000Z')",
    )
    .run();
  database
    .prepare(
      "INSERT INTO accounts (account_id, endpoint_host, endpoint_port, tls, transport, credential_ref, created_at) VALUES ('account-b', 'example.invalid', 5222, 1, 'direct-tls', NULL, '2026-11-13T00:00:00.000Z')",
    )
    .run();
  return { database, directory };
}

function createManager(database, ids = ['session-1']) {
  const registry = new GameRegistry();
  registry.registerOfficial(
    descriptor(compiled.TIC_TAC_TOE_GAME_ID, compiled.TIC_TAC_TOE_GAME_VERSION, 'Tic-Tac-Toe'),
    compiled.ticTacToeRules,
  );
  registry.registerOfficial(
    descriptor(compiled.REVERSI_GAME_ID, compiled.REVERSI_GAME_VERSION, 'Reversi'),
    compiled.reversiRules,
  );
  let index = 0;
  return new GameSessionManager({
    registry,
    storage: new GameStorage(database),
    idFactory: () => ids[index++],
    now: () => '2026-11-13T00:00:00.000Z',
  });
}

test('registry exposes only official built-ins and keeps executable rules out of catalog', () => {
  const registry = new GameRegistry();
  registry.registerOfficial(
    descriptor(compiled.TIC_TAC_TOE_GAME_ID, compiled.TIC_TAC_TOE_GAME_VERSION, 'Tic-Tac-Toe'),
    compiled.ticTacToeRules,
  );
  registry.registerOfficial(
    descriptor(compiled.REVERSI_GAME_ID, compiled.REVERSI_GAME_VERSION, 'Reversi'),
    compiled.reversiRules,
  );
  assert.deepEqual(
    registry.catalog().map((item) => item.gameId),
    [compiled.TIC_TAC_TOE_GAME_ID, compiled.REVERSI_GAME_ID],
  );
  assert.equal('applyMove' in registry.catalog()[0], false);
  assert.throws(
    () =>
      registry.registerOfficial(
        descriptor(compiled.TIC_TAC_TOE_GAME_ID, compiled.TIC_TAC_TOE_GAME_VERSION, 'Duplicate'),
        compiled.ticTacToeRules,
      ),
    { code: 'GAME_REGISTRY_DUPLICATE_ID' },
  );
  assert.throws(
    () =>
      registry.registerOfficial(
        { ...descriptor('invalid', '1.0.0', 'Invalid'), apiVersion: 2 },
        compiled.ticTacToeRules,
      ),
    { code: 'GAME_REGISTRY_UNSUPPORTED_VERSION' },
  );
  assert.throws(
    () =>
      registry.registerOfficial(
        { ...descriptor('external', '1.0.0', 'External'), distribution: 'external' },
        compiled.ticTacToeRules,
      ),
    { code: 'GAME_REGISTRY_UNSUPPORTED_DISTRIBUTION' },
  );
  assert.equal(
    registry.catalog().some((item) => item.gameId.includes('coin')),
    false,
  );
});

test('generated CommonJS artifact preserves SHA-256 vectors and initial game hashes', () => {
  const hex = (bytes) => compiled.bytesToHex(bytes);
  const encoder = new TextEncoder();
  assert.equal(
    hex(compiled.sha256(new Uint8Array())),
    'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  );
  assert.equal(
    hex(compiled.sha256(encoder.encode('abc'))),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
  assert.equal(
    hex(compiled.sha256(encoder.encode('é'))),
    '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c',
  );
  assert.equal(
    compiled.ticTacToeRules.hashState(compiled.ticTacToeRules.initialState()),
    '54d2a83b61aa6312dd440a050f4c15779ca1a7fe3dfb9e49d5d8ccf0a1d1f8fd',
  );
  assert.equal(
    compiled.reversiRules.hashState(compiled.reversiRules.initialState()),
    '00caa5fa95fd049b9d79760b1e5ec64360a1472d6fd1c5181f55ba5b7440eb5e',
  );
});

test('session manager enforces lifecycle, responder proposals, atomic events, duplicates, gaps and account isolation', () => {
  const { database, directory } = createDatabase();
  try {
    const manager = createManager(database, ['session-a', 'session-b']);
    const created = manager.create({
      accountId: 'account-a',
      conversationId: 'chat',
      peerBareJid: 'peer@example.invalid',
      gameId: compiled.TIC_TAC_TOE_GAME_ID,
      gameVersion: compiled.TIC_TAC_TOE_GAME_VERSION,
      localRole: 'initiator',
    });
    assert.equal(created.state, 'invited');
    assert.throws(
      () =>
        manager.start({
          accountId: 'account-a',
          sessionId: created.sessionId,
          expectedGeneration: 1,
        }),
      { code: 'GAME_SESSION_INVALID_TRANSITION' },
    );
    manager.accept({ accountId: 'account-a', sessionId: created.sessionId, expectedGeneration: 1 });
    manager.start({ accountId: 'account-a', sessionId: created.sessionId, expectedGeneration: 1 });
    const moved = manager.submitProposal({
      accountId: 'account-a',
      sessionId: created.sessionId,
      expectedGeneration: 1,
      actor: 'initiator',
      move: { actor: 'initiator', index: 0 },
      eventId: 'event-1',
    });
    assert.equal(moved.kind, 'applied');
    assert.equal(moved.session.revision, 1);
    assert.equal(
      manager.acceptSequencedEvent({
        accountId: 'account-a',
        sessionId: created.sessionId,
        expectedGeneration: 1,
        event: moved.event,
      }).kind,
      'duplicate',
    );
    assert.throws(
      () =>
        manager.acceptSequencedEvent({
          accountId: 'account-a',
          sessionId: created.sessionId,
          expectedGeneration: 1,
          event: { ...moved.event, eventId: 'event-gap', revision: 3, expectedRevision: 2 },
        }),
      { code: 'GAME_RULE_REVISION_GAP' },
    );
    assert.equal(manager.getSession('account-b', created.sessionId), undefined);
    const responder = manager.create({
      accountId: 'account-a',
      conversationId: 'chat',
      peerBareJid: 'peer@example.invalid',
      gameId: compiled.TIC_TAC_TOE_GAME_ID,
      gameVersion: compiled.TIC_TAC_TOE_GAME_VERSION,
      localRole: 'responder',
    });
    manager.accept({
      accountId: 'account-a',
      sessionId: responder.sessionId,
      expectedGeneration: 1,
    });
    manager.start({
      accountId: 'account-a',
      sessionId: responder.sessionId,
      expectedGeneration: 1,
    });
    assert.equal(
      manager.submitProposal({
        accountId: 'account-a',
        sessionId: responder.sessionId,
        expectedGeneration: 1,
        actor: 'responder',
        move: { actor: 'responder', index: 1 },
        eventId: 'proposal-1',
      }).kind,
      'proposal-pending',
    );
    assert.equal(
      database
        .prepare('SELECT COUNT(*) AS count FROM game_events WHERE session_id = ?')
        .get(responder.sessionId).count,
      0,
    );
    assert.throws(
      () =>
        manager.submitProposal({
          accountId: 'account-a',
          sessionId: created.sessionId,
          expectedGeneration: 99,
          actor: 'initiator',
          move: { actor: 'initiator', index: 2 },
        }),
      { code: 'GAME_SESSION_GENERATION_CONFLICT' },
    );
    manager.dispose();
    assert.throws(() => manager.listSessions('account-a'), {
      code: 'GAME_SESSION_MANAGER_DISPOSED',
    });
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('schema migration 15 to 16 is idempotent, preserves existing records and enforces game foreign keys', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-games-migration-'));
  const database = new Database(path.join(directory, 'legacy.sqlite'));
  try {
    database.exec(`CREATE TABLE schema_meta (version INTEGER NOT NULL); INSERT INTO schema_meta VALUES (15);
      CREATE TABLE accounts (account_id TEXT PRIMARY KEY, endpoint_host TEXT NOT NULL, endpoint_port INTEGER NOT NULL, tls INTEGER NOT NULL, transport TEXT NOT NULL, credential_ref TEXT, created_at TEXT NOT NULL);
      CREATE TABLE contacts (account_id TEXT NOT NULL, jid TEXT NOT NULL, name TEXT, groups_json TEXT NOT NULL DEFAULT '[]', PRIMARY KEY(account_id, jid), FOREIGN KEY(account_id) REFERENCES accounts(account_id));
      CREATE TABLE messages (id TEXT PRIMARY KEY, account_id TEXT NOT NULL, conversation_id TEXT NOT NULL, client_message_id TEXT NOT NULL, sender_jid TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(account_id) REFERENCES accounts(account_id));
      INSERT INTO accounts VALUES ('legacy', 'example.invalid', 5222, 1, 'direct-tls', NULL, '2026-11-13T00:00:00.000Z');
      INSERT INTO contacts VALUES ('legacy', 'peer@example.invalid', 'Peer', '[]');
      INSERT INTO messages VALUES ('message-1', 'legacy', 'peer@example.invalid', 'client-1', 'peer@example.invalid', '{}', 'sent', '2026-11-13T00:00:00.000Z');`);
    new SchemaMigrator(database).migrate();
    new SchemaMigrator(database).migrate();
    assert.equal(database.prepare('SELECT version FROM schema_meta').get().version, 16);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM contacts').get().count, 1);
    assert.equal(database.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 1);
    assert.equal(
      database
        .prepare(
          "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name LIKE 'game_%'",
        )
        .get().count,
      4,
    );
    assert.throws(
      () =>
        database
          .prepare(
            "INSERT INTO game_sessions (account_id, conversation_id, peer_bare_jid, session_id, game_id, game_version, api_version, local_role, state, revision, state_hash, session_generation, created_at, updated_at) VALUES ('missing', 'chat', 'peer', 's', 'g', '1', 1, 'initiator', 'invited', 0, 'hash', 1, 'now', 'now')",
          )
          .run(),
      /FOREIGN KEY/,
    );
  } finally {
    database.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
