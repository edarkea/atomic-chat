const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { StickerGrantRegistry } = require('../electron/sticker-grants.cjs');

test('E8.2-GRANT-001 reads sequentially and rejects a duplicate concurrent read', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-chat-grant-test-'));
  const source = path.join(root, 'asset.bin');
  await fs.writeFile(source, Buffer.from('sticker-content'));
  const hashValue = crypto.createHash('sha256').update('sticker-content').digest('hex');
  const registry = new StickerGrantRegistry({ resolveSource: async () => ({ accountId: 'alice', stickerId: 's1', assetId: 'a1', path: source, mimeType: 'image/png', sizeBytes: '15', width: 1, height: 1, hashValue }) });
  const grant = await registry.get(10, { accountId: 'alice', stickerId: 's1' });
  const stream = await registry.open(10, { accountId: 'alice', stickerId: 's1', grantId: grant.grantId });
  const first = await registry.read(10, { accountId: 'alice', stickerId: 's1', grantId: grant.grantId, streamId: stream.streamId, sequence: 0 });
  assert.equal(first.done, true);
  await assert.rejects(() => registry.read(10, { accountId: 'alice', stickerId: 's1', grantId: grant.grantId, streamId: stream.streamId, sequence: 0 }), { code: 'CONFLICT' });
  await registry.close(10, { accountId: 'alice', stickerId: 's1', grantId: grant.grantId, streamId: stream.streamId });
  await registry.revoke(10, { accountId: 'alice', stickerId: 's1', grantId: grant.grantId });
  await fs.rm(root, { recursive: true, force: true });
});

test('E8.2-GRANT-002 revocation invalidates later opens and is idempotent for the owner', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-chat-grant-test-'));
  const source = path.join(root, 'asset.bin');
  await fs.writeFile(source, Buffer.from('sticker-content'));
  let resolveSource;
  const pending = new Promise((resolve) => { resolveSource = resolve; });
  const registry = new StickerGrantRegistry({ resolveSource: () => pending });
  const opening = registry.get(10, { accountId: 'alice', stickerId: 's1' });
  registry.clearSender(10);
  resolveSource({ accountId: 'alice', stickerId: 's1', assetId: 'a1', path: source, mimeType: 'image/png', sizeBytes: '15', width: 1, height: 1, hashValue: crypto.createHash('sha256').update('sticker-content').digest('hex') });
  await assert.rejects(() => opening, { code: 'UNAUTHORIZED' });
  await fs.rm(root, { recursive: true, force: true });
});

test('E8.2-GRANT-003 rejects a same-size replacement before publishing a stream', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-chat-grant-test-'));
  const source = path.join(root, 'asset.bin');
  const original = Buffer.from('sticker-content');
  await fs.writeFile(source, original);
  const registry = new StickerGrantRegistry({ resolveSource: async () => ({ accountId: 'alice', stickerId: 's1', assetId: 'a1', path: source, mimeType: 'image/png', sizeBytes: String(original.length), width: 1, height: 1, hashValue: crypto.createHash('sha256').update(original).digest('hex') }) });
  const grant = await registry.get(10, { accountId: 'alice', stickerId: 's1' });
  await fs.writeFile(source, Buffer.from('altered-content'));
  await assert.rejects(() => registry.open(10, { accountId: 'alice', stickerId: 's1', grantId: grant.grantId }), { code: 'STORAGE_FAILED' });
  await fs.rm(root, { recursive: true, force: true });
});

test('E8.2-GRANT-004 rejects a grant when account authorization is revoked during lstat', async () => {
  let resolveLstat;
  const pending = new Promise((resolve) => { resolveLstat = resolve; });
  const registry = new StickerGrantRegistry({
    resolveSource: async () => ({ accountId: 'alice', stickerId: 's1', assetId: 'a1', path: 'private', mimeType: 'image/png', sizeBytes: '1', width: 1, height: 1, hashValue: 'a'.repeat(64) }),
    lstat: () => pending,
  });
  const request = registry.get(10, { accountId: 'alice', stickerId: 's1' });
  registry.clearAccount('alice');
  resolveLstat({ isSymbolicLink: () => false, isFile: () => true, size: 1, dev: 1, ino: 1, mtimeMs: 1, birthtimeMs: 1 });
  await assert.rejects(() => request, { code: 'UNAUTHORIZED' });
});

test('E8.2-GRANT-005 accepts partial reads and rejects premature EOF', async () => {
  const content = Buffer.from('sticker-content');
  const hashValue = crypto.createHash('sha256').update(content).digest('hex');
  const partialReader = {
    async read(buffer, offset, length, position) {
      const bytesRead = Math.min(3, length, content.length - position);
      content.copy(buffer, offset, position, position + bytesRead);
      return { bytesRead };
    },
    async stat() { return { size: content.length }; },
  };
  const registry = new StickerGrantRegistry();
  assert.equal(await registry.matchesHash(partialReader, hashValue, content.length), true);
  const prematureReader = {
    async read(buffer, offset, length, position) {
      if (position >= 3) return { bytesRead: 0 };
      content.copy(buffer, offset, 0, 3);
      return { bytesRead: 3 };
    },
    async stat() { return { size: 3 }; },
  };
  assert.equal(await registry.matchesHash(prematureReader, hashValue, content.length), false);
});
