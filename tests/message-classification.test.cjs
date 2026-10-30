const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PersistenceStore } = require('../electron/storage.cjs');

function account(accountId) {
  return {
    accountId,
    host: 'example.invalid',
    port: 5222,
    tls: 1,
    credentialRef: null,
    createdAt: new Date().toISOString(),
  };
}

function message(accountId, id, classification) {
  return {
    id,
    accountId,
    conversationId: 'contact@example.invalid',
    clientMessageId: id,
    senderJid: accountId,
    body: { kind: 'text', text: id },
    status: 'sent',
    createdAt: `2026-10-30T00:00:0${id === 'direct-1' ? '1' : '2'}.000Z`,
    ...(classification ? { classification } : {}),
  };
}

test('migrates messages to v7 and persists classification through history pagination', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-classification-'));
  let store = new PersistenceStore(directory);
  try {
    store.upsertAccount(account('receiver@example.invalid'));
    store.saveMessage(message('receiver@example.invalid', 'direct-1'));
    store.saveMessage(message('receiver@example.invalid', 'broadcast-1', 'broadcast'));
    assert.equal(store.database.prepare('SELECT version FROM schema_meta').get().version, 7);
    assert.equal(
      store.database
        .prepare("SELECT name FROM pragma_table_info('messages') WHERE name = 'classification'")
        .get().name,
      'classification',
    );
    assert.deepEqual(
      store
        .listMessages('receiver@example.invalid', 'contact@example.invalid')
        .map((item) => item.classification),
      ['direct', 'broadcast'],
    );
    assert.deepEqual(
      store
        .listMessagesPage('receiver@example.invalid', 'contact@example.invalid', 1, 'older', null)
        .items.map((item) => item.classification),
      ['broadcast'],
    );
    store.close();
    store = new PersistenceStore(directory);
    assert.deepEqual(
      store.listMessages('receiver@example.invalid', 'contact@example.invalid').map((item) => item.classification),
      ['direct', 'broadcast'],
    );
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
