const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PersistenceStore } = require('../electron/persistence/storage.cjs');
const { StickerMessageStore } = require('../electron/stickers/sticker-message-store.cjs');
const {
  createStickerStorageProvider,
} = require('../electron/stickers/sticker-storage-provider.cjs');
const {
  buildStickerMessage,
  createXmppStickerService,
} = require('../electron/xmpp/xmpp-stickers.cjs');

const bytes = Buffer.from('data');
const hashValue = crypto.createHash('sha256').update(bytes).digest('hex');
const metadata = {
  mimeType: 'image/png',
  sizeBytes: String(bytes.length),
  width: 512,
  height: 512,
  hashAlgorithm: 'sha-256',
  hashValue,
};
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const pngMetadata = {
  mimeType: 'image/png',
  sizeBytes: String(png.length),
  width: 1,
  height: 1,
  hashAlgorithm: 'sha-256',
  hashValue: crypto.createHash('sha256').update(png).digest('hex'),
};

function publicLookup() {
  return async () => [{ address: '203.0.113.10', family: 4 }];
}

function adapter() {
  const requests = [];
  const sent = [];
  const session = {
    iqCaller: {
      request: async (request) => {
        requests.push(request);
        throw new Error('XEP-0363 must not be used');
      },
    },
    send: async (stanza) => sent.push(stanza),
  };
  return {
    session,
    requests,
    sent,
    sessionGenerations: new Map([['alice@example.test', 1]]),
    sessionDomains: new Map([['alice@example.test', 'example.test']]),
    requireConnected: () => session,
    assertSessionCurrent: () => undefined,
    withTimeout: async (promise) => promise,
    bareJid: (value) => String(value).split('/')[0],
  };
}

test('E8.5-ALT-001 validates an injected persistent provider without exposing credentials', async () => {
  const calls = [];
  const provider = createStickerStorageProvider(
    {
      getCapabilities: async ({ accountId }) => {
        calls.push(['capabilities', accountId]);
        return {
          providerId: 'test-storage',
          uploadSupported: true,
          downloadSupported: true,
          maxFileSize: '4',
        };
      },
      uploadSticker: async (input) => {
        calls.push(['upload', input.accountId, input.idempotencyKey, input.bytes]);
        return {
          ...input.metadata,
          assetId: 'opaque-asset-1',
          remoteUrl: 'https://storage.example.test/assets/opaque-asset-1',
          availability: 'available',
        };
      },
      resolveSticker: async (input) => {
        calls.push(['resolve', input.accountId, input.remoteUrl]);
        return {
          ...metadata,
          assetId: 'opaque-asset-1',
          remoteUrl: input.remoteUrl,
          availability: 'available',
        };
      },
      downloadSticker: async () => bytes,
    },
    {
      providerId: 'test-storage',
      origins: ['https://storage.example.test'],
      lookup: publicLookup(),
      authorizeAccount: async () => true,
    },
  );

  const xmpp = adapter();
  const service = createXmppStickerService(xmpp, { storageProvider: provider });
  const capability = await service.discover({
    version: 1,
    requestId: 'alt-discover-1',
    accountId: 'alice@example.test',
  });
  assert.equal(capability.transportMode, 'PERSISTENT_HTTPS');
  assert.equal(capability.providerId, 'test-storage');
  const result = await service.send(
    {
      version: 1,
      requestId: 'alt-send-1',
      accountId: 'alice@example.test',
      conversationId: 'bob@example.test',
      clientMessageId: 'client-1',
      stickerId: 'sticker-1',
    },
    async () => ({
      ...metadata,
      accountId: 'alice@example.test',
      stickerId: 'sticker-1',
      assetId: 'local-asset-1',
      bytes,
      name: 'sticker.png',
    }),
  );

  assert.equal(result.transportStatus, 'sent');
  assert.equal(xmpp.requests.length, 0);
  assert.equal(xmpp.sent.length, 1);
  assert.equal(
    xmpp.sent[0].getChild('file-sharing', 'urn:xmpp:sfs:0').getChild('sources').getChild('url-data')
      .attrs.target,
    'https://storage.example.test/assets/opaque-asset-1',
  );
  assert.equal(
    xmpp.sent[0]
      .getChild('file-sharing', 'urn:xmpp:sfs:0')
      .getChild('provider', 'urn:atomic:sticker-storage:0').attrs.id,
    'test-storage',
  );
  assert.deepEqual(
    calls.map((call) => call[0]),
    ['capabilities', 'capabilities', 'upload', 'resolve'],
  );
  assert.equal(calls[2][2], 'client-1');
  assert.equal(Buffer.isBuffer(calls[2][3]), true);

  const external = buildStickerMessage({
    to: 'bob@example.test',
    clientMessageId: 'external-1',
    sticker: metadata,
    sourceUrl: 'https://storage.example.test/assets/external',
  });
  external.attrs.from = 'alice@example.test/resource';
  const externalRef = service.parseMessage('bob@example.test', external);
  assert.equal(externalRef.storageProviderId, undefined);
  const own = buildStickerMessage({
    to: 'bob@example.test',
    clientMessageId: 'own-1',
    sticker: metadata,
    sourceUrl: 'https://storage.example.test/assets/own',
    storageProviderId: 'test-storage',
    storageOrigin: 'https://storage.example.test',
  });
  own.attrs.from = 'alice@example.test/resource';
  const ownRef = service.parseMessage('bob@example.test', own);
  assert.equal(ownRef.storageProviderId, 'test-storage');
});

test('E8.5-ALT-002 rejects expiring or private recovery URLs and verifies downloaded bytes', async () => {
  const provider = createStickerStorageProvider(
    {
      getCapabilities: async () => ({
        providerId: 'test-storage',
        uploadSupported: true,
        downloadSupported: true,
      }),
      uploadSticker: async () => ({
        ...metadata,
        assetId: 'asset-1',
        remoteUrl: 'https://storage.example.test/assets/asset-1',
        availability: 'available',
      }),
      resolveSticker: async () => ({
        ...metadata,
        assetId: 'asset-1',
        remoteUrl: 'https://storage.example.test/assets/asset-1?token=secret',
        availability: 'available',
      }),
      downloadSticker: async () => Buffer.from('nope'),
    },
    {
      providerId: 'test-storage',
      origins: ['https://storage.example.test'],
      lookup: publicLookup(),
      authorizeAccount: async () => true,
    },
  );

  await assert.rejects(
    () =>
      provider.resolveSticker({
        accountId: 'alice@example.test',
        remoteUrl: 'https://storage.example.test/assets/asset-1?token=secret',
        expected: metadata,
      }),
    { code: 'UNSUPPORTED' },
  );
  await assert.rejects(
    () =>
      provider.downloadSticker({
        accountId: 'alice@example.test',
        remoteUrl: 'https://storage.example.test/assets/asset-1',
        expected: metadata,
        maxBytes: '4',
      }),
    { code: 'MEDIA_DECODE_FAILED' },
  );
  await assert.rejects(
    () =>
      provider.resolveSticker({
        accountId: 'alice@example.test',
        remoteUrl: 'https://127.0.0.1/assets/asset-1',
        expected: metadata,
      }),
    { code: 'UNSUPPORTED' },
  );
  const expiredProvider = createStickerStorageProvider(
    {
      getCapabilities: async () => ({
        providerId: 'test-storage',
        uploadSupported: true,
        downloadSupported: true,
      }),
      uploadSticker: async () => ({
        ...metadata,
        assetId: 'asset-1',
        remoteUrl: 'https://storage.example.test/assets/asset-1',
        availability: 'available',
        expiresAt: '2020-01-01T00:00:00.000Z',
      }),
      resolveSticker: async () => ({
        ...metadata,
        assetId: 'asset-1',
        remoteUrl: 'https://storage.example.test/assets/asset-1',
        availability: 'available',
        expiresAt: '2020-01-01T00:00:00.000Z',
      }),
      downloadSticker: async () => bytes,
    },
    {
      providerId: 'test-storage',
      origins: ['https://storage.example.test'],
      lookup: publicLookup(),
      authorizeAccount: async () => true,
    },
  );
  await assert.rejects(
    () =>
      expiredProvider.resolveSticker({
        accountId: 'alice@example.test',
        remoteUrl: 'https://storage.example.test/assets/asset-1',
        expected: metadata,
      }),
    { code: 'UNSUPPORTED' },
  );
});

test('E8.5-ALT-004 does not duplicate the stanza after a provider failure', async () => {
  let uploads = 0;
  const provider = createStickerStorageProvider(
    {
      getCapabilities: async () => ({
        providerId: 'test-storage',
        uploadSupported: true,
        downloadSupported: true,
      }),
      uploadSticker: async () => {
        uploads += 1;
        throw Object.assign(new Error('backend unavailable'), { code: 'TRANSPORT_FAILED' });
      },
      resolveSticker: async () => {
        throw new Error('must not resolve after failed upload');
      },
      downloadSticker: async () => bytes,
    },
    {
      providerId: 'test-storage',
      origins: ['https://storage.example.test'],
      lookup: publicLookup(),
      authorizeAccount: async () => true,
    },
  );
  const xmpp = adapter();
  const service = createXmppStickerService(xmpp, { storageProvider: provider });
  const input = {
    version: 1,
    requestId: 'alt-failure-1',
    accountId: 'alice@example.test',
    conversationId: 'bob@example.test',
    clientMessageId: 'client-failure',
    stickerId: 'sticker-1',
  };
  const results = await Promise.allSettled([
    service.send(input, async () => ({ ...metadata, bytes, name: 'sticker.png' })),
    service.send(input, async () => ({ ...metadata, bytes, name: 'sticker.png' })),
  ]);
  assert.equal(uploads, 1);
  assert.equal(xmpp.sent.length, 0);
  assert.equal(
    results.every(
      (result) => result.status === 'rejected' && result.reason.code === 'TRANSPORT_FAILED',
    ),
    true,
  );
});

test('E8.5-ALT-003 loads a persisted offline reference without a sender session', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-chat-alt-storage-'));
  const persistence = new PersistenceStore(root);
  persistence.upsertAccount({
    accountId: 'bob@example.test',
    host: 'example.test',
    port: 5222,
    tls: 1,
    credentialRef: null,
    createdAt: new Date().toISOString(),
  });
  let resolved = 0;
  let downloaded = 0;
  const provider = createStickerStorageProvider(
    {
      getCapabilities: async () => ({
        providerId: 'test-storage',
        uploadSupported: true,
        downloadSupported: true,
      }),
      uploadSticker: async () => ({
        ...pngMetadata,
        assetId: 'asset-1',
        remoteUrl: 'https://storage.example.test/assets/asset-1',
        availability: 'available',
      }),
      resolveSticker: async (input) => {
        resolved += 1;
        return {
          ...pngMetadata,
          assetId: 'asset-1',
          remoteUrl: input.remoteUrl,
          availability: 'available',
        };
      },
      downloadSticker: async () => {
        downloaded += 1;
        return png;
      },
    },
    {
      providerId: 'test-storage',
      origins: ['https://storage.example.test'],
      lookup: publicLookup(),
      authorizeAccount: async () => true,
    },
  );
  const store = new StickerMessageStore(
    root,
    persistence,
    {
      createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) }),
    },
    { storageProvider: provider },
  );
  const ref = store.save({
    refId: 'offline-ref',
    previewStickerId: 'message:offline-ref',
    accountId: 'bob@example.test',
    conversationId: 'alice@example.test',
    clientMessageId: 'offline-client',
    direction: 'incoming',
    senderJid: 'alice@example.test',
    mimeType: pngMetadata.mimeType,
    sizeBytes: pngMetadata.sizeBytes,
    width: 1,
    height: 1,
    hashAlgorithm: 'sha-256',
    hashValue: pngMetadata.hashValue,
    storageProviderId: 'test-storage',
    storageOrigin: 'https://storage.example.test',
    remoteUrl: 'https://storage.example.test/assets/asset-1',
    transportStatus: 'sent',
    availability: 'missing',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  const loaded = await store.load('bob@example.test', ref.refId);
  assert.equal(loaded.availability, 'available');
  assert.equal(resolved, 1);
  assert.equal(downloaded, 1);
  persistence.close();
  const reopened = new PersistenceStore(root);
  const restoredStore = new StickerMessageStore(
    root,
    reopened,
    {
      createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) }),
    },
    { storageProvider: provider },
  );
  const restored = await restoredStore.load('bob@example.test', ref.refId);
  assert.equal(restored.availability, 'available');
  assert.equal(downloaded, 1);
  reopened.close();
  await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
});
