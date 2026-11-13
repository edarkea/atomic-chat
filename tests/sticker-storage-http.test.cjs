const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const {
  createStickerStorageHttpTransport,
} = require('../electron/stickers/sticker-storage-http.cjs');

function lookupPublic() {
  return async () => [{ address: '203.0.113.10', family: 4 }];
}

function fakeRequestFactory({
  status = 200,
  headers = {},
  body = Buffer.from('{}'),
  hang = false,
  inspect,
} = {}) {
  return (_url, options, callback) => {
    inspect?.(options);
    const request = new EventEmitter();
    request.end = () => {
      if (hang) return;
      const response = new EventEmitter();
      response.statusCode = status;
      response.headers = headers;
      response.destroy = () => response.emit('aborted');
      response.resume = () => undefined;
      callback(response);
      process.nextTick(() => {
        if (body.length) response.emit('data', body);
        response.emit('end');
      });
    };
    request.destroy = () =>
      process.nextTick(() =>
        request.emit('error', Object.assign(new Error('aborted'), { code: 'ECONNRESET' })),
      );
    return request;
  };
}

function transport(options = {}) {
  return createStickerStorageHttpTransport({
    baseUrl: 'https://storage.example.test',
    origins: ['https://storage.example.test'],
    lookup: lookupPublic(),
    getAuthorizationHeader: async () => 'Bearer test-token',
    request: fakeRequestFactory(options),
    timeoutMs: 20,
  });
}

test('E8.5-ALT-09 HTTP adapter blocks DNS rebinding and redirects while preserving TLS validation', async () => {
  let called = false;
  const blocked = createStickerStorageHttpTransport({
    baseUrl: 'https://storage.example.test',
    origins: ['https://storage.example.test'],
    lookup: async () => [{ address: '127.0.0.1', family: 4 }],
    getAuthorizationHeader: async () => 'Bearer test-token',
    request: fakeRequestFactory({
      inspect: () => {
        called = true;
      },
    }),
  });
  await assert.rejects(() => blocked.getCapabilities({ accountId: 'alice@example.test' }), {
    code: 'UNSUPPORTED',
  });
  assert.equal(called, false);

  const redirect = transport({
    status: 302,
    headers: { location: 'https://other.example.test/v1/capabilities' },
  });
  await assert.rejects(() => redirect.getCapabilities({ accountId: 'alice@example.test' }), {
    code: 'UNSUPPORTED',
  });

  let tlsOptions;
  const secure = createStickerStorageHttpTransport({
    baseUrl: 'https://storage.example.test',
    origins: ['https://storage.example.test'],
    lookup: lookupPublic(),
    getAuthorizationHeader: async () => 'Bearer test-token',
    request: fakeRequestFactory({
      inspect: (options) => {
        tlsOptions = options;
      },
    }),
  });
  await secure.getCapabilities({ accountId: 'alice@example.test' });
  assert.equal(tlsOptions.rejectUnauthorized, true);
  assert.equal(tlsOptions.servername, 'storage.example.test');
});

test('E8.5-ALT-09 HTTP adapter cancels timeouts and enforces response bytes during streaming', async () => {
  const timedOut = transport({ hang: true });
  await assert.rejects(() => timedOut.getCapabilities({ accountId: 'alice@example.test' }), {
    code: 'TIMEOUT',
  });
  const oversized = transport({ body: Buffer.alloc(5) });
  await assert.rejects(
    () =>
      oversized.downloadSticker({
        accountId: 'alice@example.test',
        remoteUrl: 'https://storage.example.test/v1/assets/asset-12345678901234567890123456789012',
        expected: {},
        maxBytes: '4',
      }),
    { code: 'MEDIA_SIZE_EXCEEDED' },
  );
});
