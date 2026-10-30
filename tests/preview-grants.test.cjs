const assert = require('node:assert/strict');
const fs = require('node:fs');
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

function fakeHandle(stats, readImpl) {
  return {
    stat: async () => ({ isFile: () => true, ...stats }),
    readFile: async () => jpeg,
    read: readImpl || (async (buffer, _offset, length) => {
      jpeg.copy(buffer, 0, 0, length);
      return { bytesRead: Math.min(length, jpeg.length) };
    }),
    close: async () => undefined,
  };
}

function fakeRegistry({ source = readySource(), streamStats, readImpl, resolveSource, openFile } = {}) {
  let openCount = 0;
  const defaultOpenFile = async () => {
    openCount += 1;
    return fakeHandle(streamStats || metadata(Number(source.metadata.size)), readImpl);
  };
  const registry = new PreviewGrantRegistry({
    nativeImage: decoder,
    resolveSource: resolveSource || (async () => source),
    lstat: async () => ({
      isSymbolicLink: () => false,
      isFile: () => true,
      ...metadata(Number(source.metadata.size)),
    }),
    realpath: async (value) => value,
    openFile: openFile || defaultOpenFile,
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

test('reserves the single stream slot before concurrent opens can proceed', async () => {
  let releaseSourceCheck;
  let sourceCheckStarted;
  const sourceCheck = new Promise((resolve) => {
    releaseSourceCheck = resolve;
  });
  const sourceCheckStartedPromise = new Promise((resolve) => {
    sourceCheckStarted = resolve;
  });
  const { registry } = fakeRegistry();
  registry.assertGrantSource = async () => {
    sourceCheckStarted();
    await sourceCheck;
  };
  const preview = await registry.get(1, input());
  const firstOpen = registry.open(1, { ...input({ requestId: 'open-1' }), previewId: preview.previewId });
  await sourceCheckStartedPromise;
  await assert.rejects(
    () => registry.open(1, { ...input({ requestId: 'open-2' }), previewId: preview.previewId }),
    (error) => error.code === 'RESOURCE_CONSTRAINT',
  );
  releaseSourceCheck();
  const stream = await firstOpen;
  await registry.close(1, { ...input({ requestId: 'close' }), previewId: preview.previewId, streamId: stream.streamId });
  const reopened = await registry.open(1, { ...input({ requestId: 'open-after-close' }), previewId: preview.previewId });
  await registry.close(1, { ...input({ requestId: 'close-after-reopen' }), previewId: preview.previewId, streamId: reopened.streamId });
  await registry.revoke(1, { ...input({ requestId: 'revoke' }), previewId: preview.previewId });
});

test('revocation invalidates an open that resolves later and cleans its private copy', async () => {
  let releaseOpenFile;
  let openFileStarted;
  let openCalls = 0;
  let closeCalls = 0;
  const openFileGate = new Promise((resolve) => {
    releaseOpenFile = resolve;
  });
  const openFileStartedPromise = new Promise((resolve) => {
    openFileStarted = resolve;
  });
  const removedPaths = [];
  const { registry } = fakeRegistry({
    openFile: async () => {
      openCalls += 1;
      if (openCalls === 2) {
        openFileStarted();
        await openFileGate;
      }
      const handle = fakeHandle(metadata(jpeg.length));
      return {
        ...handle,
        close: async () => {
          closeCalls += 1;
        },
      };
    },
  });
  const removePrivateCopy = registry.removePrivateCopy.bind(registry);
  registry.removePrivateCopy = async (privatePath, directory) => {
    if (privatePath) removedPaths.push(privatePath);
    await removePrivateCopy(privatePath, directory);
  };
  const preview = await registry.get(1, input());
  const pendingOpen = registry.open(1, { ...input({ requestId: 'open' }), previewId: preview.previewId });
  await openFileStartedPromise;
  const pendingRevoke = registry.revoke(1, { ...input({ requestId: 'revoke' }), previewId: preview.previewId });
  await pendingRevoke;
  releaseOpenFile();
  await assert.rejects(pendingOpen, (error) => error.code === 'MEDIA_REFERENCE_REVOKED');
  assert.ok(closeCalls >= 2);
  assert.ok(removedPaths.length >= 1);
  assert.equal(removedPaths.every((filePath) => !fs.existsSync(filePath)), true);
});

test('does not return a block when revocation or close wins a pending read', async () => {
  let releaseRead;
  let readStarted;
  const readGate = new Promise((resolve) => {
    releaseRead = resolve;
  });
  const readStartedPromise = new Promise((resolve) => {
    readStarted = resolve;
  });
  const { registry } = fakeRegistry({
    readImpl: async (buffer, _offset, length) => {
      readStarted();
      await readGate;
      jpeg.copy(buffer, 0, 0, length);
      return { bytesRead: jpeg.length };
    },
  });
  const preview = await registry.get(1, input());
  const stream = await registry.open(1, { ...input({ requestId: 'open' }), previewId: preview.previewId });
  const pendingRead = registry.read(1, {
    ...input({ requestId: 'read' }),
    previewId: preview.previewId,
    streamId: stream.streamId,
    sequence: 0,
  });
  await readStartedPromise;
  await registry.revoke(1, { ...input({ requestId: 'revoke' }), previewId: preview.previewId });
  releaseRead();
  await assert.rejects(pendingRead, (error) => error.code === 'MEDIA_REFERENCE_REVOKED');

  const second = await registry.get(1, input({ requestId: 'preview-get-2' }));
  const secondStream = await registry.open(1, { ...input({ requestId: 'open-2' }), previewId: second.previewId });
  let releaseSecondRead;
  let secondReadStarted;
  const secondReadGate = new Promise((resolve) => {
    releaseSecondRead = resolve;
  });
  const secondReadStartedPromise = new Promise((resolve) => {
    secondReadStarted = resolve;
  });
  registry.grants.get(second.previewId).streams.get(secondStream.streamId).handle.read = async (buffer, _offset, length) => {
    secondReadStarted();
    await secondReadGate;
    jpeg.copy(buffer, 0, 0, length);
    return { bytesRead: jpeg.length };
  };
  const pendingClosedRead = registry.read(1, {
    ...input({ requestId: 'read-2' }),
    previewId: second.previewId,
    streamId: secondStream.streamId,
    sequence: 0,
  });
  await secondReadStartedPromise;
  await registry.close(1, { ...input({ requestId: 'close-2' }), previewId: second.previewId, streamId: secondStream.streamId });
  releaseSecondRead();
  await assert.rejects(pendingClosedRead, (error) => error.code === 'CONFLICT');
  await registry.revoke(1, { ...input({ requestId: 'revoke-2' }), previewId: second.previewId });
});

test('invalidates pending get operations when account or sender is cleared', async () => {
  for (const mode of ['account', 'sender']) {
    let releaseSource;
    let sourceStarted;
    const sourceGate = new Promise((resolve) => {
      releaseSource = resolve;
    });
    const sourceStartedPromise = new Promise((resolve) => {
      sourceStarted = resolve;
    });
    const { registry } = fakeRegistry({
      resolveSource: async () => {
        sourceStarted();
        await sourceGate;
        return readySource();
      },
    });
    const pendingGet = registry.get(7, input({ requestId: `pending-${mode}` }));
    await sourceStartedPromise;
    if (mode === 'account') registry.clearAccount(input().accountId);
    else registry.clearSender(7);
    releaseSource();
    await assert.rejects(pendingGet, (error) => error.code === 'UNAUTHORIZED');
    assert.equal(registry.grants.size, 0);
  }
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
  await registry.close(1, { ...input({ requestId: 'close-after-revoke' }), previewId: preview.previewId, streamId: 'stream-after-revoke' });
  await assert.rejects(
    () => registry.open(1, { ...input({ requestId: 'open-after-revoke' }), previewId: preview.previewId }),
    (error) => error.code === 'UNAUTHORIZED',
  );
});
