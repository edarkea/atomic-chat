const test = require('node:test');
const assert = require('node:assert/strict');
const { registerStickerMessageHandlers } = require('../electron/ipc-sticker-message-handlers.cjs');

function setup(authorized = true) {
  const handlers = new Map();
  const ref = {
    refId: 'ref-1', previewStickerId: 'message:ref-1', accountId: 'alice@example.test',
    conversationId: 'bob@example.test', clientMessageId: 'client-1', direction: 'outgoing',
    senderJid: 'alice@example.test', mimeType: 'image/png', sizeBytes: '4', width: 1, height: 1,
    hashAlgorithm: 'sha-256', hashValue: 'a'.repeat(64), transportStatus: 'sent', availability: 'available',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  };
  const runtime = {
    persistence: {
      getStickerMessageRef: () => null,
      getStickerMessageRefByClientMessageId: () => null,
      getSticker: () => ({ stickerId: 's1', assetId: 'asset-1', name: 'one.png', altText: 'one' }),
    },
    stickers: { resolveForPreview: () => ({ path: 'private', assetId: 'asset-1', mimeType: 'image/png', sizeBytes: '4', width: 1, height: 1, hashValue: 'a'.repeat(64) }), saveHistoricalMessage: async () => ({ stickerId: 'saved-1' }) },
    stickerMessages: { save: () => ref, publicRef: (value) => value, load: async () => ref, resolveForPreview: () => ({ path: 'private', assetId: 'asset-1', mimeType: 'image/png', sizeBytes: '4', width: 1, height: 1, hashValue: 'a'.repeat(64) }) },
    xmpp: {
      discoverStickers: async () => ({ serviceJid: 'upload.example.test', maxFileSize: 4 }),
      sendSticker: async () => ref,
      sessionGenerations: new Map([['alice@example.test', 1]]),
    },
  };
  registerStickerMessageHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    assertSender: () => undefined,
    getRuntime: () => runtime,
    historySecurity: { authorize: () => authorized },
    helpers: { validVersion: (input) => input?.version === 1, requestId: (_event, input) => input?.requestId || 'generated' },
  });
  return { handlers, runtime, event: { sender: { id: 7 } } };
}

test('E8.5-IPC-001 rejects account access from an unauthorized window', async () => {
  const value = setup(false);
  const result = await value.handlers.get('stickerMessages.send')(value.event, {
    version: 1, requestId: 'r1', accountId: 'alice@example.test', conversationId: 'bob@example.test', clientMessageId: 'm1', stickerId: 's1',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'UNAUTHORIZED');
});

test('E8.5-IPC-002 sends only through an owned sticker id and returns a metadata ref', async () => {
  const value = setup(true);
  const result = await value.handlers.get('stickerMessages.send')(value.event, {
    version: 1, requestId: 'r1', accountId: 'alice@example.test', conversationId: 'bob@example.test', clientMessageId: 'm1', stickerId: 's1',
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.refId, 'ref-1');
  assert.equal(Object.hasOwn(result.value, 'path'), false);
});

test('E8.5-IPC-003 requires the stored conversation when manually loading a sticker', async () => {
  const value = setup(true);
  value.runtime.persistence.getStickerMessageRef = () => ({ refId: 'ref-1', conversationId: 'other@example.test' });
  const result = await value.handlers.get('stickerMessages.load')(value.event, {
    version: 1, requestId: 'r1', accountId: 'alice@example.test', conversationId: 'bob@example.test', refId: 'ref-1',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'MEDIA_PREVIEW_UNAVAILABLE');
});

test('E8.5-IPC-004 saves only an incoming historical reference and returns an idempotent library marker', async () => {
  const value = setup(true);
  value.runtime.persistence.getStickerMessageRef = () => ({ ...value.runtime.stickerMessages.save(), direction: 'incoming', conversationId: 'bob@example.test', previewStickerId: 'message:ref-1', refId: 'ref-1' });
  const result = await value.handlers.get('stickerMessages.save')(value.event, {
    version: 1, requestId: 'r1', accountId: 'alice@example.test', conversationId: 'bob@example.test', refId: 'ref-1',
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.savedStickerId, 'saved-1');
});
