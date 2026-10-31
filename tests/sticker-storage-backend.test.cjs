const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { createStickerStorageService } = require('../backend/sticker-storage-service.cjs');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const hashValue = require('node:crypto').createHash('sha256').update(png).digest('hex');

async function request(port, method, route, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const client = http.request({ hostname: '127.0.0.1', port, method, path: route, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    client.once('error', reject);
    if (body) client.end(body); else client.end();
  });
}

async function fixture(readAccessMode = 'opaque-url') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-chat-storage-backend-'));
  const service = await createStickerStorageService({
    storageDir: root,
    providerId: 'test-storage',
    publicOrigin: 'https://storage.example.test',
    authTokens: { 'alice-token': 'alice@example.test', 'bob-token': 'bob@example.test' },
    readAccessMode,
    retentionSeconds: 3600,
    maxStorageBytesPerAccount: 4 * 1024 * 1024,
  });
  const server = service.createHttpServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { root, service, server, port: server.address().port };
}

function uploadHeaders(token, idempotencyKey, bytes = png) {
  return {
    Authorization: `Bearer ${token}`,
    'Content-Length': String(bytes.length),
    'X-Atomic-Client-Message-Id': idempotencyKey,
    'X-Atomic-Mime-Type': 'image/png',
    'X-Atomic-Size-Bytes': String(bytes.length),
    'X-Atomic-Width': '1',
    'X-Atomic-Height': '1',
    'X-Atomic-Sha256': hashValue,
  };
}

test('E8.5-ALT-09 backend authenticates upload, persists it, and supports cross-account opaque recovery', async () => {
  const value = await fixture();
  try {
    const unauthorized = await request(value.port, 'POST', '/v1/assets', uploadHeaders('wrong-token', 'm-unauthorized'), png);
    assert.equal(unauthorized.status, 401);
    const uploaded = await request(value.port, 'POST', '/v1/assets', uploadHeaders('alice-token', 'm-1'), png);
    assert.equal(uploaded.status, 200);
    const asset = JSON.parse(uploaded.body.toString('utf8'));
    assert.equal(asset.providerId, 'test-storage');
    assert.match(asset.remoteUrl, /^https:\/\/storage\.example\.test\/v1\/assets\/[A-Za-z0-9_-]{43}$/);
    const repeated = await request(value.port, 'POST', '/v1/assets', uploadHeaders('alice-token', 'm-1'), png);
    assert.equal(JSON.parse(repeated.body.toString('utf8')).assetId, asset.assetId);
    const head = await request(value.port, 'HEAD', new URL(asset.remoteUrl).pathname);
    assert.equal(head.status, 200);
    assert.equal(head.headers['x-atomic-sha256'], hashValue);
    const recovered = await request(value.port, 'GET', new URL(asset.remoteUrl).pathname);
    assert.equal(recovered.status, 200);
    assert.deepEqual(recovered.body, png);
    await new Promise((resolve) => value.server.close(resolve));
    const restarted = await createStickerStorageService({
      storageDir: value.root,
      providerId: 'test-storage',
      publicOrigin: 'https://storage.example.test',
      authTokens: { 'alice-token': 'alice@example.test', 'bob-token': 'bob@example.test' },
      readAccessMode: 'opaque-url', retentionSeconds: 3600, maxStorageBytesPerAccount: 4 * 1024 * 1024,
    });
    const restartedServer = restarted.createHttpServer();
    await new Promise((resolve) => restartedServer.listen(0, '127.0.0.1', resolve));
    const afterRestart = await request(restartedServer.address().port, 'GET', new URL(asset.remoteUrl).pathname);
    assert.equal(afterRestart.status, 200);
    await new Promise((resolve) => restartedServer.close(resolve));
  } finally {
    if (value.server.listening) await new Promise((resolve) => value.server.close(resolve));
    await fs.rm(value.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});

test('E8.5-ALT-09 backend enforces bearer read policy, idempotency conflicts, and streaming size limit', async () => {
  const value = await fixture('bearer');
  try {
    const uploaded = await request(value.port, 'POST', '/v1/assets', uploadHeaders('alice-token', 'm-2'), png);
    const asset = JSON.parse(uploaded.body.toString('utf8'));
    const noAuth = await request(value.port, 'GET', new URL(asset.remoteUrl).pathname);
    assert.equal(noAuth.status, 401);
    const otherAccount = await request(value.port, 'GET', new URL(asset.remoteUrl).pathname, { Authorization: 'Bearer bob-token' });
    assert.equal(otherAccount.status, 200);
    const conflict = await request(value.port, 'POST', '/v1/assets', uploadHeaders('alice-token', 'm-2', Buffer.from('not-png')) , Buffer.from('not-png'));
    assert.notEqual(conflict.status, 200);
    const oversized = Buffer.alloc(2 * 1024 * 1024 + 1);
    const tooLarge = await request(value.port, 'POST', '/v1/assets', { ...uploadHeaders('alice-token', 'm-large', oversized), 'X-Atomic-Size-Bytes': String(oversized.length) }, oversized);
    assert.equal(tooLarge.status, 413);
  } finally {
    await new Promise((resolve) => value.server.close(resolve));
    await fs.rm(value.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 });
  }
});
