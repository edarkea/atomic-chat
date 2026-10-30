const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PersistenceStore } = require('../electron/storage.cjs');
const { StickerMessageStore } = require('../electron/sticker-message-store.cjs');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const decoder = { createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) }) };

function reference(accountId, conversationId, refId = 'ref-1') {
  return {
    refId,
    previewStickerId: `message:${refId}`,
    accountId,
    conversationId,
    clientMessageId: `client-${refId}`,
    direction: 'incoming',
    senderJid: 'alice@example.test',
    name: 'remote.png',
    altText: 'remote',
    mimeType: 'image/png',
    sizeBytes: String(png.length),
    width: 1,
    height: 1,
    hashAlgorithm: 'sha-256',
    hashValue: crypto.createHash('sha256').update(png).digest('hex'),
    remoteUrl: 'https://cdn.example.test/remote.png',
    transportStatus: 'sent',
    availability: 'missing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-chat-sticker-message-'));
  const persistence = new PersistenceStore(root);
  persistence.upsertAccount({ accountId: 'alice@example.test', host: 'example.test', port: 5222, tls: 1, credentialRef: null, createdAt: new Date().toISOString() });
  persistence.upsertAccount({ accountId: 'bob@example.test', host: 'example.test', port: 5222, tls: 1, credentialRef: null, createdAt: new Date().toISOString() });
  return { root, persistence };
}

async function close(value) {
  value.persistence.close();
  await fs.rm(value.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
}

test('E8.5-STORE-001 stores incoming metadata without downloading until explicit load', async () => {
  const value = await fixture();
  let downloads = 0;
  const store = new StickerMessageStore(value.root, value.persistence, decoder, {
    download: async () => { downloads += 1; return png; },
  });
  const saved = store.save(reference('alice@example.test', 'bob@example.test'));
  assert.equal(saved.availability, 'missing');
  assert.equal(downloads, 0);
  assert.equal(store.get('bob@example.test', saved.refId), null);
  assert.ok(store.get('alice@example.test', saved.refId));
  const loaded = await store.load('alice@example.test', saved.refId);
  assert.equal(loaded.availability, 'available');
  assert.equal(downloads, 1);
  assert.throws(() => store.resolveForPreview('bob@example.test', saved.previewStickerId), { code: 'MEDIA_PREVIEW_UNAVAILABLE' });
  await close(value);
});

test('E8.5-STORE-002 serializes concurrent loads and remains idempotent after the first asset is published', async () => {
  const value = await fixture();
  let downloads = 0;
  const store = new StickerMessageStore(value.root, value.persistence, decoder, {
    download: async () => { downloads += 1; await new Promise((resolve) => setTimeout(resolve, 5)); return png; },
  });
  const saved = store.save(reference('alice@example.test', 'bob@example.test', 'ref-concurrent'));
  const results = await Promise.all([
    store.load('alice@example.test', saved.refId),
    store.load('alice@example.test', saved.refId),
  ]);
  assert.equal(downloads, 1);
  assert.equal(results[0].availability, 'available');
  assert.equal(results[1].availability, 'available');
  const files = await fs.readdir(path.join(value.root, 'sticker-message-assets'));
  assert.equal(files.filter((item) => item.endsWith('.bin')).length, 1);
  await close(value);
});

test('E8.5-STORE-003 preserves account isolation and mixed timeline entries', async () => {
  const value = await fixture();
  const first = value.persistence.upsertStickerMessageRef(reference('alice@example.test', 'only-stickers@example.test', 'ref-only'));
  value.persistence.saveMessage({
    id: 'message-1', accountId: 'alice@example.test', conversationId: 'mixed@example.test',
    clientMessageId: 'message-1', senderJid: 'alice@example.test', body: { kind: 'text', text: 'hello' },
    status: 'sent', createdAt: new Date().toISOString(),
  });
  value.persistence.upsertStickerMessageRef(reference('alice@example.test', 'mixed@example.test', 'ref-mixed'));
  const timeline = value.persistence.listTimelinePage('alice@example.test', 'mixed@example.test', 100, 'older', null);
  assert.deepEqual(timeline.items.map((item) => item.kind).sort(), ['sticker', 'text']);
  assert.ok(value.persistence.listConversations('alice@example.test').some((item) => item.jid === 'only-stickers@example.test'));
  assert.equal(value.persistence.getStickerMessageRef('bob@example.test', first.refId), null);
  await close(value);
});
