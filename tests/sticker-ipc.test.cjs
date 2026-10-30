const test = require('node:test');
const assert = require('node:assert/strict');
const { registerStickerHandlers } = require('../electron/ipc-sticker-handlers.cjs');

function harness(authorized = true) {
  const handlers = new Map();
  registerStickerHandlers({
    ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
    assertSender: () => undefined,
    getRuntime: () => ({ stickers: { list: () => [] } }),
    historySecurity: { authorize: () => authorized },
    stickerGrants: { get: async () => ({ grantId: 'opaque', accountId: 'alice', stickerId: 's1', assetId: 'a1', expiresAt: new Date().toISOString(), mimeType: 'image/png', sizeBytes: '1', width: 1, height: 1, chunkSize: 65536 }) },
    selectStickerSource: async () => null,
    helpers: { requestId: (_event, input) => input?.requestId || 'generated', validVersion: (input) => input?.version === 1 },
  });
  return handlers;
}

test('E8.2-IPC-001 rejects list access when the sender is not authorized for the account', async () => {
  const handlers = harness(false);
  const result = await handlers.get('stickers.list')({ sender: { id: 7 } }, { version: 1, requestId: 'r1', accountId: 'alice' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'UNAUTHORIZED');
});

test('E8.2-IPC-002 exposes only opaque preview metadata', async () => {
  const handlers = harness(true);
  const result = await handlers.get('stickers.preview.get')({ sender: { id: 7 } }, { version: 1, requestId: 'r2', accountId: 'alice', stickerId: 's1' });
  assert.equal(result.ok, true);
  assert.equal('path' in result.value, false);
  assert.equal('storageKey' in result.value, false);
  assert.equal('bytes' in result.value, false);
});
