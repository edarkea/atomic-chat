const assert = require('node:assert/strict');
const test = require('node:test');
const { PreviewGrantRegistry } = require('../electron/preview-grants.cjs');
const { MAX_PREVIEW_BYTES } = require('../electron/preview-image.cjs');

const metadata = (size) => ({ dev: '1', ino: '2', size: String(size), mtimeMs: '3', birthtimeMs: '4' });
const jpeg = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x02, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xd9,
]);
const decoder = { createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 2, height: 1 }) }) };

function input(overrides = {}) {
  return {
    version: 1,
    requestId: 'preview-get',
    accountId: 'account@example.invalid',
    transferId: 'transfer-1',
    ...overrides,
  };
}

function readySource(size = jpeg.length) {
  return { path: 'image.jpg', metadata: metadata(size) };
}

function fakeRegistry({ source = readySource(), streamStats, readImpl } = {}) {
  let openCount = 0;
  const registry = new PreviewGrantRegistry({
    nativeImage: decoder,
    resolveSource: async () => source,
    lstat: async () => ({
      isSymbolicLink: () => false,
      isFile: () => true,
      ...metadata(Number(source.metadata.size)),
    }),
    realpath: async (value) => value,
    openFile: async () => {
      openCount += 1;
      const stats = streamStats || metadata(Number(source.metadata.size));
      return {
        stat: async () => ({ isFile: () => true, ...stats }),
        readFile: async () => jpeg,
        read: readImpl || (async (buffer, _offset, length) => {
          jpeg.copy(buffer, 0, 0, length);
          return { bytesRead: Math.min(length, jpeg.length) };
        }),
        close: async () => undefined,
      };
    },
  });
  return { registry, getOpenCount: () => openCount };
}

test('rejects a file over 10 MiB before opening or loading it', async () => {
  let openCalled = false;
  const registry = new PreviewGrantRegistry({
    nativeImage: decoder,
    resolveSource: async () => readySource(MAX_PREVIEW_BYTES + 1),
    lstat: async () => ({
      isSymbolicLink: () => false,
      isFile: () => true,
      ...metadata(MAX_PREVIEW_BYTES + 1),
    }),
    openFile: async () => {
      openCalled = true;
      throw new Error('should not open');
    },
  });
  const result = await registry.get(1, input());
  assert.equal(result.state, 'failed');
  assert.equal(result.reasonCode, 'MEDIA_SIZE_EXCEEDED');
  assert.equal(openCalled, false);
});

test('rejects a concurrent read and preserves one sequence/offset', async () => {
  let releaseRead;
  const readStarted = new Promise((resolve) => {
    releaseRead = resolve;
  });
  const { registry } = fakeRegistry({
    readImpl: async (buffer, _offset, length) => {
      releaseRead();
      await new Promise((resolve) => setTimeout(resolve, 10));
      jpeg.copy(buffer, 0, 0, length);
      return { bytesRead: jpeg.length };
    },
  });
  const preview = await registry.get(1, input());
  assert.equal(preview.state, 'ready');
  const stream = await registry.open(1, { ...input({ requestId: 'open' }), previewId: preview.previewId });
  const first = registry.read(1, {
    ...input({ requestId: 'read-1' }),
    previewId: preview.previewId,
    streamId: stream.streamId,
    sequence: 0,
  });
  await readStarted;
  await assert.rejects(
    () => registry.read(1, { ...input({ requestId: 'read-2' }), previewId: preview.previewId, streamId: stream.streamId, sequence: 0 }),
    (error) => error.code === 'CONFLICT',
  );
  const chunk = await first;
  assert.equal(chunk.done, true);
  await registry.revoke(1, { ...input({ requestId: 'revoke-after-read' }), previewId: preview.previewId });
});

test('revokes on metadata change during a read and prevents reopening', async () => {
  let changed = false;
  const { registry } = fakeRegistry({
    streamStats: metadata(jpeg.length),
    readImpl: async (buffer, _offset, length) => {
      changed = true;
      jpeg.copy(buffer, 0, 0, length);
      return { bytesRead: jpeg.length };
    },
  });
  const original = registry.openFile;
  registry.openFile = async (value) => {
    const handle = await original(value);
    return {
      ...handle,
      stat: async () => ({ isFile: () => true, ...metadata(changed ? jpeg.length + 1 : jpeg.length) }),
    };
  };
  const preview = await registry.get(1, input());
  assert.equal(preview.state, 'ready');
  const stream = await registry.open(1, { ...input({ requestId: 'open' }), previewId: preview.previewId });
  await assert.rejects(
    () => registry.read(1, { ...input({ requestId: 'read' }), previewId: preview.previewId, streamId: stream.streamId, sequence: 0 }),
    (error) => error.code === 'STORAGE_FAILED',
  );
  await assert.rejects(
    () => registry.open(1, { ...input({ requestId: 'open-again' }), previewId: preview.previewId }),
    (error) => error.code === 'UNAUTHORIZED',
  );
});

test('rejects symlink sources and keeps revocation owner-scoped and idempotent', async () => {
  const symlinkRegistry = new PreviewGrantRegistry({
    nativeImage: decoder,
    resolveSource: async () => readySource(),
    lstat: async () => ({ isSymbolicLink: () => true, isFile: () => false, ...metadata(jpeg.length) }),
  });
  const unavailable = await symlinkRegistry.get(1, input());
  assert.equal(unavailable.state, 'unavailable');

  const { registry } = fakeRegistry();
  const preview = await registry.get(1, input());
  assert.equal(preview.state, 'ready');
  await assert.rejects(
    () => registry.revoke(2, { ...input({ requestId: 'revoke-cross' }), previewId: preview.previewId }),
    (error) => error.code === 'UNAUTHORIZED',
  );
  await assert.rejects(
    () => registry.revoke(1, { ...input({ requestId: 'revoke-unknown' }), previewId: 'unknown-preview' }),
    (error) => error.code === 'UNAUTHORIZED',
  );
  const revocation = registry.revoke(1, { ...input({ requestId: 'revoke-owner' }), previewId: preview.previewId });
  await assert.rejects(
    () => registry.open(1, { ...input({ requestId: 'open-during-revoke' }), previewId: preview.previewId }),
    (error) => error.code === 'UNAUTHORIZED',
  );
  await Promise.all([
    revocation,
    registry.revoke(1, { ...input({ requestId: 'revoke-owner-again' }), previewId: preview.previewId }),
  ]);
  await assert.rejects(
    () => registry.open(1, { ...input({ requestId: 'open-after-revoke' }), previewId: preview.previewId }),
    (error) => error.code === 'UNAUTHORIZED',
  );
});
