const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PersistenceStore } = require('../electron/storage.cjs');

test('SQLite creates the approved P0 schema and persists idempotent messages', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-'));
  const store = new PersistenceStore(directory);
  store.upsertAccount({ accountId: 'a@example.invalid', host: 'example.invalid', port: 5222, tls: 1, credentialRef: null, createdAt: new Date().toISOString() });
  store.saveMessage({ id: 'msg-1', accountId: 'a@example.invalid', conversationId: 'c-1', clientMessageId: 'client-1', senderJid: 'a@example.invalid', body: { kind: 'text', text: 'hola' }, status: 'sent', createdAt: new Date().toISOString() });
  store.saveMessage({ id: 'msg-2', accountId: 'a@example.invalid', conversationId: 'c-1', clientMessageId: 'client-1', senderJid: 'a@example.invalid', body: { kind: 'text', text: 'hola' }, status: 'failed', createdAt: new Date().toISOString() });
  assert.equal(store.database.prepare('SELECT COUNT(*) AS count FROM accounts').get().count, 1);
  assert.equal(store.database.prepare('SELECT status FROM messages WHERE client_message_id = ?').get('client-1').status, 'failed');
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
  store.upsertAccount({ accountId: 'one@example.invalid', host: 'example.invalid', port: 5222, tls: 1, credentialRef: null, createdAt: new Date().toISOString() });
  store.upsertAccount({ accountId: 'two@example.invalid', host: 'example.invalid', port: 5222, tls: 1, credentialRef: null, createdAt: new Date().toISOString() });
  store.saveMessage({ id: 'one-1', accountId: 'one@example.invalid', conversationId: 'same-contact', clientMessageId: 'one-client', senderJid: 'same-contact@example.invalid', body: { kind: 'text', text: 'one' }, status: 'draft', createdAt: new Date().toISOString() });
  assert.equal(store.listMessages('one@example.invalid', 'same-contact').length, 1);
  assert.equal(store.listMessages('two@example.invalid', 'same-contact').length, 0);
  assert.equal(store.database.prepare('SELECT COUNT(*) AS count FROM message_recovery WHERE reason = ?').get('account_identity_missing').count, 1);
  store.close(); fs.rmSync(directory, { recursive: true, force: true });
});
