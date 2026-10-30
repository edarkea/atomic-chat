const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PersistenceStore } = require('../electron/storage.cjs');
const { StickerStore, MAX_STICKER_BYTES } = require('../electron/sticker-store.cjs');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const decoder = { createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) }) };

async function fixture(options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-chat-sticker-test-'));
  const persistence = new PersistenceStore(root);
  persistence.upsertAccount({ accountId: 'alice@example.test', host: 'example.test', port: 5222, tls: 1, credentialRef: null, createdAt: new Date().toISOString() });
  return { root, persistence, store: new StickerStore(root, persistence, decoder, options) };
}

test('E8.2-STORE-001 migrates v9 databases additively and imports PNG with public metadata only', async () => {
  const value = await fixture();
  const source = path.join(value.root, 'source.png');
  await fs.writeFile(source, png);
  const result = await value.store.importFile('alice@example.test', source);
  assert.equal(result.asset.mimeType, 'image/png');
  assert.equal(result.asset.sizeBytes, String(png.length));
  assert.equal(result.sticker.accountId, 'alice@example.test');
  assert.equal(value.persistence.database.prepare('SELECT version FROM schema_meta').get().version, 12);
  assert.equal(value.persistence.database.prepare('SELECT COUNT(*) AS count FROM messages').get().count, 0);
  value.persistence.close();
  await fs.rm(value.root, { recursive: true, force: true });
});

test('E8.2-STORE-002 deduplicates by account and hash without duplicating physical bytes', async () => {
  const value = await fixture();
  const source = path.join(value.root, 'source.png');
  await fs.writeFile(source, png);
  const first = await value.store.importFile('alice@example.test', source);
  const second = await value.store.importFile('alice@example.test', source);
  assert.equal(second.deduplicated, true);
  assert.equal(first.asset.assetId, second.asset.assetId);
  assert.equal(value.persistence.database.prepare('SELECT COUNT(*) AS count FROM sticker_assets').get().count, 1);
  assert.equal(value.persistence.database.prepare('SELECT COUNT(*) AS count FROM stickers').get().count, 2);
  value.persistence.close();
  await fs.rm(value.root, { recursive: true, force: true });
});

test('E8.2-STORE-003 rejects oversized input before invoking the decoder', async () => {
  let decoderCalls = 0;
  const value = await fixture();
  value.store.nativeImage = { createFromBuffer: () => { decoderCalls += 1; return decoder.createFromBuffer(); } };
  const source = path.join(value.root, 'large.png');
  await fs.writeFile(source, Buffer.alloc(MAX_STICKER_BYTES + 1));
  await assert.rejects(() => value.store.importFile('alice@example.test', source), { code: 'MEDIA_SIZE_EXCEEDED' });
  assert.equal(decoderCalls, 0);
  value.persistence.close();
  await fs.rm(value.root, { recursive: true, force: true });
});

test('E8.2-STORE-004 repairs a deduplicated asset whose private copy was corrupted', async () => {
  const value = await fixture();
  const source = path.join(value.root, 'source.png');
  await fs.writeFile(source, png);
  const first = await value.store.importFile('alice@example.test', source);
  const asset = value.persistence.getStickerAsset('alice@example.test', first.asset.assetId);
  await fs.writeFile(path.join(value.root, 'sticker-assets', asset.storageKey), Buffer.alloc(png.length, 7));
  await value.store.delete('alice@example.test', first.sticker.stickerId);
  const recovered = await value.store.importFile('alice@example.test', source);
  assert.equal(recovered.asset.assetId, first.asset.assetId);
  assert.equal(recovered.asset.availability, 'available');
  assert.deepEqual(await fs.readFile(path.join(value.root, 'sticker-assets', value.persistence.getStickerAsset('alice@example.test', first.asset.assetId).storageKey)), png);
  value.persistence.close();
  await fs.rm(value.root, { recursive: true, force: true });
});

test('E8.2-STORE-005 accepts the exact 2 MiB limit without allocating a larger source', async () => {
  const value = await fixture();
  const source = path.join(value.root, 'exact.png');
  await fs.writeFile(source, Buffer.concat([png, Buffer.alloc(MAX_STICKER_BYTES - png.length)]));
  const result = await value.store.importFile('alice@example.test', source);
  assert.equal(result.asset.sizeBytes, String(MAX_STICKER_BYTES));
  value.persistence.close();
  await fs.rm(value.root, { recursive: true, force: true });
});

test('E8.2-STORE-006 serializes orphan cleanup and reimport per account', async () => {
  const value = await fixture();
  const source = path.join(value.root, 'source.png');
  await fs.writeFile(source, png);
  const first = await value.store.importFile('alice@example.test', source);
  let releaseCleanup;
  const cleanupStarted = new Promise((resolve) => { releaseCleanup = resolve; });
  value.store.cleanupAccountOrphans = async () => cleanupStarted;
  const deletion = value.store.delete('alice@example.test', first.sticker.stickerId);
  await Promise.resolve();
  let settled = false;
  const reimport = value.store.importFile('alice@example.test', source).finally(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);
  releaseCleanup();
  await deletion;
  const result = await reimport;
  assert.equal(result.asset.assetId, first.asset.assetId);
  value.persistence.close();
  await fs.rm(value.root, { recursive: true, force: true });
});

test('E8.2-STORE-007 revalidates authorization after dedupe validation', async () => {
  const value = await fixture();
  const source = path.join(value.root, 'source.png');
  await fs.writeFile(source, png);
  await value.store.importFile('alice@example.test', source);
  let authorized = true;
  value.store.isManagedAssetValid = async () => { authorized = false; return true; };
  await assert.rejects(() => value.store.importFile('alice@example.test', source, () => authorized), { code: 'UNAUTHORIZED' });
  assert.equal(value.persistence.database.prepare('SELECT COUNT(*) AS count FROM stickers').get().count, 1);
  value.persistence.close();
  await fs.rm(value.root, { recursive: true, force: true });
});

test('E8.2-STORE-008 removes unpublished recovery bytes when authorization is revoked', async () => {
  const value = await fixture();
  const source = path.join(value.root, 'source.png');
  await fs.writeFile(source, png);
  const first = await value.store.importFile('alice@example.test', source);
  value.persistence.markStickerAssetAvailability('alice@example.test', first.asset.assetId, 'missing');
  const originalPublish = value.store.publishBytes.bind(value.store);
  let authorized = true;
  value.store.publishBytes = async (...args) => {
    const published = await originalPublish(...args);
    authorized = false;
    return published;
  };
  await assert.rejects(() => value.store.importFile('alice@example.test', source, () => authorized), { code: 'UNAUTHORIZED' });
  assert.equal(value.persistence.database.prepare('SELECT COUNT(*) AS count FROM stickers').get().count, 1);
  assert.equal(value.persistence.getStickerAsset('alice@example.test', first.asset.assetId).availability, 'missing');
  const files = await fs.readdir(path.join(value.root, 'sticker-assets'));
  assert.deepEqual(files.filter((file) => !file.startsWith('.tmp-')), [first.asset.assetId + '.bin']);
  value.persistence.close();
  await fs.rm(value.root, { recursive: true, force: true });
});

test('E8.2-STORE-009 keeps an orphan row when physical deletion fails and retries later', async () => {
  let failRemoval = true;
  const value = await fixture({ removeFile: async () => {
    if (failRemoval) { const cause = new Error('locked'); cause.code = 'EACCES'; throw cause; }
    return undefined;
  } });
  const source = path.join(value.root, 'source.png');
  await fs.writeFile(source, png);
  const first = await value.store.importFile('alice@example.test', source);
  await value.store.delete('alice@example.test', first.sticker.stickerId);
  value.persistence.database.prepare('UPDATE sticker_assets SET orphaned_at = ? WHERE asset_id = ?').run(new Date(Date.now() - (8 * 24 * 60 * 60 * 1000)).toISOString(), first.asset.assetId);
  await value.store.cleanupOrphans();
  assert.ok(value.persistence.getStickerAsset('alice@example.test', first.asset.assetId));
  failRemoval = false;
  value.store.removeFile = (filePath, options) => fs.rm(filePath, options);
  await value.store.cleanupOrphans();
  assert.equal(value.persistence.getStickerAsset('alice@example.test', first.asset.assetId), null);
  value.persistence.close();
  await fs.rm(value.root, { recursive: true, force: true });
});

test('E8.2-STORE-010 serializes reconciliation behind recovery', async () => {
  const value = await fixture();
  const source = path.join(value.root, 'source.png');
  await fs.writeFile(source, png);
  const first = await value.store.importFile('alice@example.test', source);
  value.persistence.markStickerAssetAvailability('alice@example.test', first.asset.assetId, 'missing');
  let releasePublication;
  let publicationStarted;
  const publicationReady = new Promise((resolve) => { publicationStarted = resolve; });
  const publicationRelease = new Promise((resolve) => { releasePublication = resolve; });
  const originalPublish = value.store.publishBytes.bind(value.store);
  value.store.publishBytes = async (...args) => {
    publicationStarted();
    await publicationRelease;
    return originalPublish(...args);
  };
  const recovery = value.store.importFile('alice@example.test', source);
  await publicationReady;
  const reconciliation = value.store.reconcile();
  releasePublication();
  await recovery;
  await reconciliation;
  assert.equal(value.persistence.getStickerAsset('alice@example.test', first.asset.assetId).availability, 'available');
  value.persistence.close();
  await fs.rm(value.root, { recursive: true, force: true });
});
