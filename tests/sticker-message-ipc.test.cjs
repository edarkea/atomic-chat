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

test('E8.5-IPC-005 does not report a failed reference as successfully sent', async () => {
  const value = setup(true);
  value.runtime.persistence.getStickerMessageRef = () => ({ ...value.runtime.stickerMessages.save(), transportStatus: 'failed', errorCode: 'TRANSPORT_FAILED' });
  const result = await value.handlers.get('stickerMessages.send')(value.event, {
    version: 1, requestId: 'r1', accountId: 'alice@example.test', conversationId: 'bob@example.test', clientMessageId: 'm1', stickerId: 's1',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TRANSPORT_FAILED');
});

test('E8.5-IPC-008 only returns sent references as confirmed and keeps persisted pending states pending', async () => {
  for (const transportStatus of ['queued', 'uploading', 'sending']) {
    const value = setup(true);
    value.runtime.persistence.getStickerMessageRef = () => ({ ...value.runtime.stickerMessages.save(), transportStatus });
    const result = await value.handlers.get('stickerMessages.send')(value.event, {
      version: 1, requestId: `pending-${transportStatus}`, accountId: 'alice@example.test', conversationId: 'bob@example.test', clientMessageId: 'm1', stickerId: 's1',
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'SEND_IN_PROGRESS');
  }
  const sent = setup(true);
  sent.runtime.persistence.getStickerMessageRef = () => ({ ...sent.runtime.stickerMessages.save(), transportStatus: 'sent' });
  const result = await sent.handlers.get('stickerMessages.send')(sent.event, {
    version: 1, requestId: 'sent', accountId: 'alice@example.test', conversationId: 'bob@example.test', clientMessageId: 'm1', stickerId: 's1',
  });
  assert.equal(result.ok, true);
  assert.equal(result.value.transportStatus, 'sent');
});

test('E8.5-IPC-009 applies pending and failed rules through the historical identity lookup', async () => {
  const pending = setup(true);
  pending.runtime.persistence.getStickerMessageRefByClientMessageId = () => ({
    ...pending.runtime.stickerMessages.save(), conversationId: 'bob@example.test', transportStatus: 'sending',
  });
  const pendingResult = await pending.handlers.get('stickerMessages.send')(pending.event, {
    version: 1, requestId: 'pending-compat', accountId: 'alice@example.test', conversationId: 'bob@example.test', clientMessageId: 'm1', stickerId: 's1',
  });
  assert.equal(pendingResult.ok, false);
  assert.equal(pendingResult.error.code, 'SEND_IN_PROGRESS');

  const failed = setup(true);
  failed.runtime.persistence.getStickerMessageRefByClientMessageId = () => ({
    ...failed.runtime.stickerMessages.save(), conversationId: 'bob@example.test', transportStatus: 'failed', errorCode: 'SEND_RESULT_UNKNOWN',
  });
  const failedResult = await failed.handlers.get('stickerMessages.send')(failed.event, {
    version: 1, requestId: 'failed-compat', accountId: 'alice@example.test', conversationId: 'bob@example.test', clientMessageId: 'm1', stickerId: 's1',
  });
  assert.equal(failedResult.ok, false);
  assert.equal(failedResult.error.code, 'SEND_RESULT_UNKNOWN');
});

test('E8.5-IPC-010 single-flights concurrent identical sends without changing the client message id', async () => {
  const value = setup(true);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  value.runtime.xmpp.sendSticker = async () => {
    calls += 1;
    await gate;
    return value.runtime.stickerMessages.save();
  };
  const input = { version: 1, requestId: 'concurrent-1', accountId: 'alice@example.test', conversationId: 'bob@example.test', clientMessageId: 'same-client-id', stickerId: 's1' };
  const first = value.handlers.get('stickerMessages.send')(value.event, input);
  const second = value.handlers.get('stickerMessages.send')(value.event, { ...input, requestId: 'concurrent-2' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls, 1);
  release();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results.map((item) => item.ok), [true, true]);
});

test('E8.5-IPC-006 finalizes queued state as failed when the XMPP operation rejects', async () => {
  const value = setup(true);
  const failed = [];
  value.runtime.persistence.markStickerMessageFailed = (...args) => { failed.push(args); return value.runtime.stickerMessages.save(); };
  value.runtime.xmpp.sendSticker = async () => { throw Object.assign(new Error('upload failed'), { code: 'TRANSPORT_FAILED' }); };
  const result = await value.handlers.get('stickerMessages.send')(value.event, {
    version: 1, requestId: 'r1', accountId: 'alice@example.test', conversationId: 'bob@example.test', clientMessageId: 'm1', stickerId: 's1',
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'TRANSPORT_FAILED');
  assert.equal(failed.length, 1);
});

test('E8.5-IPC-007 does not emit a late failure into a replacement session', async () => {
  const value = setup(true);
  const events = [];
  value.runtime.xmpp.emit = (event) => events.push(event);
  value.runtime.persistence.markStickerMessageFailed = () => ({
    ...value.runtime.stickerMessages.save(), transportStatus: 'failed', errorCode: 'NOT_CONNECTED',
  });
  value.runtime.xmpp.sendSticker = async () => {
    value.runtime.xmpp.sessionGenerations.set('alice@example.test', 2);
    throw Object.assign(new Error('session replaced'), { code: 'NOT_CONNECTED' });
  };
  const result = await value.handlers.get('stickerMessages.send')(value.event, {
    version: 1, requestId: 'r1', accountId: 'alice@example.test', conversationId: 'bob@example.test', clientMessageId: 'm1', stickerId: 's1',
  });
  assert.equal(result.ok, false);
  assert.equal(events.length, 1);
});
