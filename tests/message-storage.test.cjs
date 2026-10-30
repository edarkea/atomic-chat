const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PersistenceStore } = require('../electron/storage.cjs');

test('SQLite creates the approved P0 schema and persists idempotent messages', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-'));
  const store = new PersistenceStore(directory);
  store.upsertAccount({
    accountId: 'a@example.invalid',
    host: 'example.invalid',
    port: 5222,
    tls: 1,
    credentialRef: null,
    createdAt: new Date().toISOString(),
  });
  store.saveMessage({
    id: 'msg-1',
    accountId: 'a@example.invalid',
    conversationId: 'c-1',
    clientMessageId: 'client-1',
    senderJid: 'a@example.invalid',
    body: { kind: 'text', text: 'hola' },
    status: 'sent',
    createdAt: new Date().toISOString(),
  });
  store.saveMessage({
    id: 'msg-2',
    accountId: 'a@example.invalid',
    conversationId: 'c-1',
    clientMessageId: 'client-1',
    senderJid: 'a@example.invalid',
    body: { kind: 'text', text: 'hola' },
    status: 'failed',
    createdAt: new Date().toISOString(),
  });
  assert.equal(store.database.prepare('SELECT COUNT(*) AS count FROM accounts').get().count, 1);
  assert.equal(
    store.database
      .prepare('SELECT status FROM messages WHERE client_message_id = ?')
      .get('client-1').status,
    'failed',
  );
  store.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('conversation index is account-isolated, ordered, and survives reopening SQLite', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-conversations-'));
  let store = new PersistenceStore(directory);
  for (const accountId of ['one@example.invalid', 'two@example.invalid'])
    store.upsertAccount({
      accountId,
      host: 'example.invalid',
      port: 5222,
      tls: 1,
      credentialRef: null,
      createdAt: new Date().toISOString(),
    });
  const message = (id, accountId, conversationId, createdAt) =>
    store.saveMessage({
      id,
      accountId,
      conversationId,
      clientMessageId: id,
      senderJid: conversationId,
      body: { kind: 'text', text: id },
      status: 'sent',
      createdAt,
    });
  message('one-old', 'one@example.invalid', 'old@example.invalid', '2026-01-01T00:00:00.000Z');
  message('one-new', 'one@example.invalid', 'new@example.invalid', '2026-01-03T00:00:00.000Z');
  message('two-only', 'two@example.invalid', 'two@example.invalid', '2026-01-04T00:00:00.000Z');
  assert.deepEqual(
    store.listConversations('one@example.invalid').map((item) => item.jid),
    ['new@example.invalid', 'old@example.invalid'],
  );
  assert.deepEqual(
    store.listConversations('two@example.invalid').map((item) => item.jid),
    ['two@example.invalid'],
  );
  store.close();
  store = new PersistenceStore(directory);
  assert.deepEqual(
    store.listConversations('one@example.invalid').map((item) => item.jid),
    ['new@example.invalid', 'old@example.invalid'],
  );
  assert.equal(store.listConversations('missing@example.invalid').length, 0);
  store.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('history is isolated by account and legacy messages are quarantined', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-migrate-'));
  const dbPath = path.join(directory, 'data', 'atomic-chat.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const Database = require('better-sqlite3');
  const legacy = new Database(dbPath);
  legacy.exec(`CREATE TABLE schema_meta(version INTEGER NOT NULL); INSERT INTO schema_meta VALUES (2);
    CREATE TABLE accounts(account_id TEXT PRIMARY KEY, endpoint_host TEXT NOT NULL, endpoint_port INTEGER NOT NULL, tls INTEGER NOT NULL, credential_ref TEXT, created_at TEXT NOT NULL);
    CREATE TABLE messages(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, client_message_id TEXT NOT NULL UNIQUE, sender_jid TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    INSERT INTO messages VALUES ('old-1','same-contact','old-client','same-contact@example.invalid','{"kind":"text","text":"ambiguous"}','sent','2026-01-01T00:00:00.000Z');`);
  legacy.close();
  const store = new PersistenceStore(directory);
  store.upsertAccount({
    accountId: 'one@example.invalid',
    host: 'example.invalid',
    port: 5222,
    tls: 1,
    credentialRef: null,
    createdAt: new Date().toISOString(),
  });
  store.upsertAccount({
    accountId: 'two@example.invalid',
    host: 'example.invalid',
    port: 5222,
    tls: 1,
    credentialRef: null,
    createdAt: new Date().toISOString(),
  });
  store.saveMessage({
    id: 'one-1',
    accountId: 'one@example.invalid',
    conversationId: 'same-contact',
    clientMessageId: 'one-client',
    senderJid: 'same-contact@example.invalid',
    body: { kind: 'text', text: 'one' },
    status: 'draft',
    createdAt: new Date().toISOString(),
  });
  assert.equal(store.listMessages('one@example.invalid', 'same-contact').length, 1);
  assert.equal(store.listMessages('two@example.invalid', 'same-contact').length, 0);
  assert.equal(
    store.database
      .prepare('SELECT COUNT(*) AS count FROM message_recovery WHERE reason = ?')
      .get('account_identity_missing').count,
    1,
  );
  store.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('history pages use stable composite ordering and recover both directions', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-pages-'));
  const store = new PersistenceStore(directory);
  store.upsertAccount({
    accountId: 'page@example.invalid',
    host: 'example.invalid',
    port: 5222,
    tls: 1,
    credentialRef: null,
    createdAt: new Date().toISOString(),
  });
  for (let index = 0; index < 101; index += 1)
    store.saveMessage({
      id: `message-${String(index).padStart(3, '0')}`,
      accountId: 'page@example.invalid',
      conversationId: 'contact@example.invalid',
      clientMessageId: `client-${index}`,
      senderJid: 'contact@example.invalid',
      body: { kind: 'text', text: String(index) },
      status: 'sent',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
  const recent = store.listMessagesPage(
    'page@example.invalid',
    'contact@example.invalid',
    50,
    'older',
    null,
  );
  assert.equal(recent.items.length, 50);
  assert.equal(recent.items[0].id, 'message-051');
  assert.equal(recent.items.at(-1).id, 'message-100');
  assert.equal(recent.hasMore, true);
  assert.ok(
    store.database
      .prepare('PRAGMA index_list(messages)')
      .all()
      .some((index) => index.name === 'idx_messages_account_conversation_created_id'),
  );
  assert.match(
    store.database
      .prepare(
        'EXPLAIN QUERY PLAN SELECT id FROM messages WHERE account_id = ? AND conversation_id = ? ORDER BY created_at DESC, id DESC LIMIT ?',
      )
      .all('page@example.invalid', 'contact@example.invalid', 51)
      .map((row) => row.detail)
      .join(' '),
    /idx_messages_account_conversation_created_id|account_conversation/,
  );
  const older = store.listMessagesPage(
    'page@example.invalid',
    'contact@example.invalid',
    50,
    'older',
    { createdAt: recent.items[0].createdAt, id: recent.items[0].id },
  );
  assert.equal(older.items[0].id, 'message-001');
  assert.equal(older.items.at(-1).id, 'message-050');
  const newer = store.listMessagesPage(
    'page@example.invalid',
    'contact@example.invalid',
    50,
    'newer',
    { createdAt: older.items.at(-1).createdAt, id: older.items.at(-1).id },
  );
  assert.equal(newer.items[0].id, 'message-051');
  assert.equal(newer.items.at(-1).id, 'message-100');
  store.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('history paging traverses synthetic 1000 and 10000 message conversations without gaps', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-large-pages-'));
  const store = new PersistenceStore(directory);
  store.upsertAccount({
    accountId: 'large@example.invalid',
    host: 'example.invalid',
    port: 5222,
    tls: 1,
    credentialRef: null,
    createdAt: new Date().toISOString(),
  });
  for (const total of [1000, 10000]) {
    const conversationId = `contact-${total}@example.invalid`;
    for (let index = 0; index < total; index += 1)
      store.saveMessage({
        id: `${total}-${String(index).padStart(5, '0')}`,
        accountId: 'large@example.invalid',
        conversationId,
        clientMessageId: `${total}-client-${index}`,
        senderJid: conversationId,
        body: { kind: 'text', text: String(index) },
        status: 'sent',
        createdAt: new Date(1700000000000 + index).toISOString(),
      });
    const seen = [];
    let cursor = null;
    let hasMore = true;
    while (hasMore) {
      const page = store.listMessagesPage(
        'large@example.invalid',
        conversationId,
        100,
        'older',
        cursor,
      );
      seen.push(...page.items.map((message) => message.id));
      hasMore = page.hasMore;
      const first = page.items[0];
      cursor = first ? { createdAt: first.createdAt, id: first.id } : null;
    }
    assert.equal(seen.length, total);
    assert.equal(new Set(seen).size, total);
    assert.equal(seen[0], `${total}-${String(total - 100).padStart(5, '0')}`);
    assert.equal(seen.at(-1), `${total}-00099`);
  }
  store.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('v3 message tables migrate through v8 and remain idempotent', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-v3-'));
  const dbPath = path.join(directory, 'data', 'atomic-chat.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const Database = require('better-sqlite3');
  const legacy = new Database(dbPath);
  legacy.exec(`CREATE TABLE schema_meta(version INTEGER NOT NULL); INSERT INTO schema_meta VALUES (3);
    CREATE TABLE accounts(account_id TEXT PRIMARY KEY, endpoint_host TEXT NOT NULL, endpoint_port INTEGER NOT NULL, tls INTEGER NOT NULL, credential_ref TEXT, created_at TEXT NOT NULL);
    INSERT INTO accounts VALUES ('one@example.invalid','example.invalid',5222,1,NULL,'2026-01-01'); INSERT INTO accounts VALUES ('two@example.invalid','example.invalid',5222,1,NULL,'2026-01-01');
    CREATE TABLE messages(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, conversation_id TEXT NOT NULL, client_message_id TEXT NOT NULL UNIQUE, sender_jid TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);
    INSERT INTO messages VALUES ('m1','one@example.invalid','c','old-one','x@example.invalid','{"kind":"text","text":"one"}','sent','2026-01-01');
    INSERT INTO messages VALUES ('m2','two@example.invalid','c','old-two','x@example.invalid','{"kind":"text","text":"two"}','sent','2026-01-02');`);
  legacy.close();
  let store = new PersistenceStore(directory);
  assert.equal(store.database.prepare('SELECT version FROM schema_meta').get().version, 8);
  assert.ok(
    store.database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'media_assets'")
      .get(),
  );
  assert.equal(store.listMessages('one@example.invalid', 'c')[0].body.text, 'one');
  assert.equal(store.listMessages('two@example.invalid', 'c')[0].body.text, 'two');
  store.saveMessage({
    id: 'shared-one',
    accountId: 'one@example.invalid',
    conversationId: 'c',
    clientMessageId: 'shared',
    senderJid: 'x@example.invalid',
    body: { kind: 'text', text: 'one-shared' },
    status: 'sent',
    createdAt: new Date().toISOString(),
  });
  store.saveMessage({
    id: 'shared-two',
    accountId: 'two@example.invalid',
    conversationId: 'c',
    clientMessageId: 'shared',
    senderJid: 'x@example.invalid',
    body: { kind: 'text', text: 'two-shared' },
    status: 'sent',
    createdAt: new Date().toISOString(),
  });
  assert.equal(
    store
      .listMessages('one@example.invalid', 'c')
      .find((message) => message.clientMessageId === 'shared').body.text,
    'one-shared',
  );
  assert.equal(
    store
      .listMessages('two@example.invalid', 'c')
      .find((message) => message.clientMessageId === 'shared').body.text,
    'two-shared',
  );
  assert.ok(
    store.database
      .prepare(
        "SELECT COUNT(*) AS count FROM pragma_index_list('messages') WHERE name LIKE 'sqlite_autoindex_messages_%'",
      )
      .get().count >= 1,
  );
  store.close();
  store = new PersistenceStore(directory);
  assert.equal(store.database.prepare('SELECT version FROM schema_meta').get().version, 8);
  assert.ok(
    store.database
      .prepare('PRAGMA index_list(messages)')
      .all()
      .some((index) => index.name === 'idx_messages_account_conversation_created_id'),
  );
  store.close();
  fs.rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

test('v3 migration rolls back atomically when source metadata is invalid', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-rollback-'));
  const dbPath = path.join(directory, 'data', 'atomic-chat.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const Database = require('better-sqlite3');
  const legacy = new Database(dbPath);
  legacy.exec(`CREATE TABLE schema_meta(version INTEGER NOT NULL); INSERT INTO schema_meta VALUES (3);
    CREATE TABLE accounts(account_id TEXT PRIMARY KEY, endpoint_host TEXT NOT NULL, endpoint_port INTEGER NOT NULL, tls INTEGER NOT NULL, credential_ref TEXT, created_at TEXT NOT NULL);
    CREATE TABLE messages(id TEXT PRIMARY KEY, account_id TEXT NOT NULL, conversation_id TEXT NOT NULL, client_message_id TEXT NOT NULL, sender_jid TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL);`);
  legacy.close();
  assert.throws(() => new PersistenceStore(directory));
  const check = new Database(dbPath);
  assert.equal(
    check.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages'").get()
      .name,
    'messages',
  );
  assert.equal(
    check.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='messages_v3'").get(),
    undefined,
  );
  check.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
