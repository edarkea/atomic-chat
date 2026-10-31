const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PersistenceStore } = require('../electron/storage.cjs');
const { StickerMessageStore } = require('../electron/sticker-message-store.cjs');
const { StickerStore } = require('../electron/sticker-store.cjs');

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

test('E8.5-STORE-004 keeps equal third-party stanza ids distinct by sender and conversation', async () => {
  const value = await fixture();
  const first = value.persistence.upsertStickerMessageRef({ ...reference('alice@example.test', 'contact-a@example.test', 'ref-a'), senderJid: 'contact-a@example.test' });
  const second = value.persistence.upsertStickerMessageRef({
    ...reference('alice@example.test', 'contact-b@example.test', 'ref-b'),
    clientMessageId: first.clientMessageId,
    senderJid: 'contact-b@example.test',
  });
  assert.notEqual(first.refId, second.refId);
  assert.equal(value.persistence.database.prepare('SELECT COUNT(*) AS count FROM sticker_message_refs WHERE account_id = ?').get('alice@example.test').count, 2);
  const preserved = value.persistence.upsertStickerMessageRef({ ...first, refId: 'legacy-v12-ref' });
  assert.equal(preserved.refId, first.refId);
  assert.equal(preserved.previewStickerId, `message:${first.refId}`);
  assert.equal(value.persistence.getStickerMessageRef('alice@example.test', first.refId).previewStickerId, `message:${first.refId}`);
  assert.throws(() => value.persistence.upsertStickerMessageRef({ ...first, refId: 'different-content-ref', hashValue: 'b'.repeat(64) }), { code: 'CONFLICT' });
  const lateFailure = value.persistence.markStickerMessageFailed('alice@example.test', first.refId, 'TRANSPORT_FAILED', new Date().toISOString());
  assert.equal(lateFailure.transportStatus, 'sent');
  assert.equal(value.persistence.getStickerMessageRef('alice@example.test', first.refId).transportStatus, 'sent');
  assert.equal(value.persistence.database.prepare('SELECT COUNT(*) AS count FROM sticker_message_refs WHERE account_id = ?').get('alice@example.test').count, 2);
  await close(value);
});

test('E8.5-STORE-005 resolves an outgoing message preview through its original E8.2 asset', async () => {
  const value = await fixture();
  const ref = value.persistence.upsertStickerMessageRef({
    ...reference('alice@example.test', 'bob@example.test', 'ref-outgoing'),
    direction: 'outgoing', senderJid: 'alice@example.test', availability: 'available', localAssetId: 'asset-e82', storageKey: null,
  });
  const store = new StickerMessageStore(value.root, value.persistence, decoder, {
    assetStore: { resolveAssetForPreview: (accountId, assetId, stickerId) => ({ accountId, assetId, stickerId, path: 'e82-private', mimeType: ref.mimeType, sizeBytes: ref.sizeBytes, width: ref.width, height: ref.height, hashValue: ref.hashValue }) },
  });
  assert.equal(store.resolveForPreview('alice@example.test', ref.previewStickerId).assetId, 'asset-e82');
  await close(value);
});

test('E8.5-STORE-006 promotes a validated historical asset once and saves it as an individual sticker', async () => {
  const value = await fixture();
  const stickers = new StickerStore(value.root, value.persistence, decoder);
  const messages = new StickerMessageStore(value.root, value.persistence, decoder, {
    assetStore: stickers,
    stickerStore: stickers,
    download: async () => png,
  });
  const ref = messages.save(reference('alice@example.test', 'bob@example.test', 'ref-save'));
  const loaded = await messages.load('alice@example.test', ref.refId);
  assert.ok(loaded.localAssetId);
  assert.equal(value.persistence.database.prepare('SELECT COUNT(*) AS count FROM sticker_assets').get().count, 1);
  const saved = await stickers.saveHistoricalMessage('alice@example.test', messages.resolveForPreview('alice@example.test', ref.previewStickerId), loaded);
  const repeated = await stickers.saveHistoricalMessage('alice@example.test', messages.resolveForPreview('alice@example.test', ref.previewStickerId), loaded);
  assert.equal(saved.stickerId, repeated.stickerId);
  assert.equal(value.persistence.countStickers('alice@example.test'), 1);
  const secondRef = messages.save(reference('alice@example.test', 'bob@example.test', 'ref-save-2'));
  const secondLoaded = await messages.load('alice@example.test', secondRef.refId);
  const secondSaved = await stickers.saveHistoricalMessage('alice@example.test', messages.resolveForPreview('alice@example.test', secondRef.previewStickerId), secondLoaded);
  assert.equal(saved.stickerId, secondSaved.stickerId);
  assert.equal(value.persistence.countStickers('alice@example.test'), 1);
  assert.equal(value.persistence.database.prepare('SELECT COUNT(*) AS count FROM sticker_assets').get().count, 1);
  assert.equal(messages.get('alice@example.test', ref.refId).savedStickerId, saved.stickerId);
  assert.equal(messages.get('alice@example.test', secondRef.refId).savedStickerId, saved.stickerId);
  await stickers.delete('alice@example.test', saved.stickerId);
  assert.equal(messages.get('alice@example.test', ref.refId).savedStickerId, undefined);
  const savedAgain = await stickers.saveHistoricalMessage('alice@example.test', messages.resolveForPreview('alice@example.test', ref.previewStickerId), loaded);
  assert.equal(savedAgain.stickerId, saved.stickerId);
  assert.ok(messages.resolveForPreview('alice@example.test', ref.previewStickerId));
  await close(value);
});

test('E8.5-STORE-007 enforces the 250 visible-entry quota under the account lock', async () => {
  const value = await fixture();
  const stickers = new StickerStore(value.root, value.persistence, decoder);
  const sourcePath = path.join(value.root, 'quota.png');
  await fs.writeFile(sourcePath, png);
  const now = new Date().toISOString();
  const hashValue = crypto.createHash('sha256').update(png).digest('hex');
  for (let index = 0; index < 250; index += 1) {
    const assetId = `quota-asset-${index}`;
    value.persistence.insertStickerAsset({ accountId: 'alice@example.test', assetId, hashValue: index === 0 ? hashValue : `${String(index).padStart(64, '0')}`, mimeType: 'image/png', sizeBytes: index === 0 ? String(png.length) : '1', width: 1, height: 1, storageKey: `${assetId}.bin`, availability: 'available', createdAt: now, updatedAt: now });
    value.persistence.insertSticker({ stickerId: `quota-sticker-${index}`, accountId: 'alice@example.test', assetId, name: 'quota', altText: 'quota', sortKey: `${now}-${index}`, availability: 'available', createdAt: now, updatedAt: now });
  }
  const existing = await stickers.saveHistoricalMessage('alice@example.test', { accountId: 'alice@example.test', path: sourcePath }, { refId: 'quota-existing', hashValue: hashValue, mimeType: 'image/png', sizeBytes: String(png.length), width: 1, height: 1 });
  assert.equal(existing.stickerId, 'quota-sticker-0');
  const newPath = path.join(value.root, 'quota-new.png');
  const newBytes = Buffer.concat([png, Buffer.from('new quota content')]);
  await fs.writeFile(newPath, newBytes);
  const newHash = crypto.createHash('sha256').update(newBytes).digest('hex');
  await assert.rejects(() => stickers.saveHistoricalMessage('alice@example.test', { accountId: 'alice@example.test', path: newPath }, { refId: 'quota-new', hashValue: newHash, mimeType: 'image/png', sizeBytes: String(newBytes.length), width: 1, height: 1 }), { code: 'RESOURCE_CONSTRAINT' });
  assert.equal(value.persistence.countStickers('alice@example.test'), 250);
  await close(value);
});

test('E8.5-STORE-008 reuses an available E8.2 library entry by hash without merging it retroactively', async () => {
  const value = await fixture();
  const stickers = new StickerStore(value.root, value.persistence, decoder);
  const sourcePath = path.join(value.root, 'imported.png');
  await fs.writeFile(sourcePath, png);
  const imported = await stickers.importFile('alice@example.test', sourcePath);
  const source = stickers.resolveForPreview('alice@example.test', imported.sticker.stickerId);
  const saved = await stickers.saveHistoricalMessage('alice@example.test', source, reference('alice@example.test', 'bob@example.test', 'ref-imported'));
  assert.equal(saved.stickerId, imported.sticker.stickerId);
  assert.equal(value.persistence.countStickers('alice@example.test'), 1);
  await close(value);
});
