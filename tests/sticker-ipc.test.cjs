const test = require('node:test');
const assert = require('node:assert/strict');
const { registerStickerHandlers } = require('../electron/ipc-sticker-handlers.cjs');

function harness(authorized = true, selectStickerSource = async () => null) {
  const handlers = new Map();
  const imports = [];
  const isAuthorized = typeof authorized === 'function' ? authorized : () => authorized;
  registerStickerHandlers({
    ipcMain: { handle: (channel, callback) => handlers.set(channel, callback) },
    assertSender: () => undefined,
    getRuntime: () => ({ stickers: { list: () => [], importFile: async (...args) => { imports.push(args); return { sticker: {}, asset: {}, deduplicated: false }; } } }),
    historySecurity: { authorize: () => isAuthorized() },
    stickerGrants: { get: async () => ({ grantId: 'opaque', accountId: 'alice', stickerId: 's1', assetId: 'a1', expiresAt: new Date().toISOString(), mimeType: 'image/png', sizeBytes: '1', width: 1, height: 1, chunkSize: 65536 }) },
    selectStickerSource,
    helpers: { requestId: (_event, input) => input?.requestId || 'generated', validVersion: (input) => input?.version === 1 },
  });
  handlers.imports = imports;
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

test('E8.2-IPC-003 revalidates account authorization after the file dialog returns', async () => {
  let authorized = true;
  let select;
  const dialog = new Promise((resolve) => { select = resolve; });
  const handlers = harness(() => authorized, () => dialog);
  const pending = handlers.get('stickers.import')({ sender: { id: 7 } }, { version: 1, requestId: 'r3', accountId: 'alice' });
  authorized = false;
  select('C:/private/source.png');
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'UNAUTHORIZED');
  assert.equal(handlers.imports.length, 0);
});
