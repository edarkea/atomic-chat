const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PersistenceStore } = require('../electron/storage.cjs');

test('message search escapes LIKE wildcards and isolates accounts', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-search-'));
  const store = new PersistenceStore(directory);
  try {
    for (const accountId of ['alice@example.test', 'bob@example.test']) {
      store.upsertAccount({
        accountId,
        host: 'localhost',
        port: 5222,
        tls: 1,
        credentialRef: 'test',
        createdAt: new Date().toISOString(),
      });
    }
    const save = (accountId, id, text, createdAt) => store.saveMessage({
      id,
      accountId,
      conversationId: 'chat@example.test',
      clientMessageId: id,
      senderJid: accountId,
      body: { kind: 'text', text },
      status: 'sent',
      createdAt,
    });
    save('alice@example.test', 'a1', '100% safe', '2026-01-01T00:00:00.000Z');
    save('alice@example.test', 'a2', 'underscore _ safe', '2026-01-02T00:00:00.000Z');
    save('bob@example.test', 'b1', '100% safe', '2026-01-03T00:00:00.000Z');

    const page = store.searchMessages('alice@example.test', '100%', null, 50, null);
    assert.deepEqual(page.items.map((item) => item.messageId), ['a1']);
    assert.equal(store.searchMessages('alice@example.test', '_', null, 50, null).items.length, 1);
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
