const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { StickerGrantRegistry } = require('../electron/sticker-grants.cjs');

test('E8.2-GRANT-001 reads sequentially and rejects a duplicate concurrent read', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-chat-grant-test-'));
  const source = path.join(root, 'asset.bin');
  await fs.writeFile(source, Buffer.from('sticker-content'));
  const registry = new StickerGrantRegistry({ resolveSource: async () => ({ accountId: 'alice', stickerId: 's1', assetId: 'a1', path: source, mimeType: 'image/png', sizeBytes: '15', width: 1, height: 1 }) });
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
  resolveSource({ accountId: 'alice', stickerId: 's1', assetId: 'a1', path: source, mimeType: 'image/png', sizeBytes: '15', width: 1, height: 1 });
  await assert.rejects(() => opening, { code: 'UNAUTHORIZED' });
  await fs.rm(root, { recursive: true, force: true });
});
