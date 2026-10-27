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
