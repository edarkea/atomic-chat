const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const MAX_STICKER_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 1024;
const MIME_TYPES = new Set(['image/png', 'image/jpeg']);

function serviceError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function textHeader(value, name, maxLength = 512) {
  if (typeof value !== 'string' || !value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/.test(value))
    throw serviceError('INVALID_INPUT', `falta ${name}`);
  return value.trim();
}

function hashValue(value) {
  const normalized = String(value || '').toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw serviceError('MEDIA_DECODE_FAILED', 'el hash no es válido');
  return normalized;
}

function metadataFromHeaders(headers) {
  const mimeType = textHeader(headers['x-atomic-mime-type'], 'MIME', 64);
  if (!MIME_TYPES.has(mimeType)) throw serviceError('MEDIA_TYPE_UNSUPPORTED', 'solo se permiten PNG/JPEG estáticos');
  const sizeBytes = Number(textHeader(headers['x-atomic-size-bytes'], 'tamaño', 32));
  const width = Number(textHeader(headers['x-atomic-width'], 'ancho', 16));
  const height = Number(textHeader(headers['x-atomic-height'], 'alto', 16));
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_STICKER_BYTES)
    throw serviceError('MEDIA_SIZE_EXCEEDED', 'el sticker supera 2 MiB', 413);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION)
    throw serviceError('MEDIA_DIMENSIONS_INVALID', 'las dimensiones no están permitidas');
  return { mimeType, sizeBytes, width, height, hashValue: hashValue(headers['x-atomic-sha256']) };
}

function inspectImage(bytes) {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    return { mimeType: 'image/png', width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < bytes.length) {
      if (bytes[offset] !== 0xff) { offset += 1; continue; }
      const marker = bytes[offset + 1];
      offset += 2;
      if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) break;
      const segmentLength = bytes.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > bytes.length) break;
      const progressive = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (progressive) return { mimeType: 'image/jpeg', height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
      offset += segmentLength;
    }
  }
  throw serviceError('MEDIA_DECODE_FAILED', 'el contenido no es una imagen PNG/JPEG válida');
}

function validateImage(bytes, metadata) {
  if (bytes.length !== metadata.sizeBytes) throw serviceError('MEDIA_DECODE_FAILED', 'el tamaño real no coincide con la metadata');
  const image = inspectImage(bytes);
  const actualHash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (image.mimeType !== metadata.mimeType || image.width !== metadata.width || image.height !== metadata.height || actualHash !== metadata.hashValue)
    throw serviceError('MEDIA_DECODE_FAILED', 'el contenido no coincide con la metadata');
  return image;
}

function normalizeOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw serviceError('INVALID_INPUT', 'el origen público no es válido'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw serviceError('INVALID_INPUT', 'el origen público debe ser HTTPS');
  return url.origin;
}

function readAuthToken(request) {
  const header = request.headers.authorization;
  if (typeof header !== 'string' || !header.startsWith('Bearer ')) return undefined;
  const token = header.slice('Bearer '.length).trim();
  return token || undefined;
}

class StickerStorageRepository {
  constructor(options) {
    this.root = path.resolve(options.storageDir);
    this.indexPath = path.join(this.root, 'index.json');
    this.tempDir = path.join(this.root, '.tmp');
    this.providerId = textHeader(options.providerId, 'providerId', 128);
    this.publicOrigin = normalizeOrigin(options.publicOrigin);
    this.retentionSeconds = Number(options.retentionSeconds);
    this.maxStorageBytesPerAccount = Number(options.maxStorageBytesPerAccount);
    if (!Number.isSafeInteger(this.retentionSeconds) || this.retentionSeconds < 1)
      throw serviceError('INVALID_INPUT', 'la retención debe ser positiva');
    if (!Number.isSafeInteger(this.maxStorageBytesPerAccount) || this.maxStorageBytesPerAccount < MAX_STICKER_BYTES)
      throw serviceError('INVALID_INPUT', 'la cuota del backend no es válida');
    this.readAccessMode = options.readAccessMode;
    if (!['opaque-url', 'bearer'].includes(this.readAccessMode))
      throw serviceError('INVALID_INPUT', 'la política de lectura no está aprobada');
    this.tokens = new Map(Object.entries(options.authTokens || {}).map(([token, accountId]) => [String(token), textHeader(accountId, 'accountId')]));
    if (!this.tokens.size) throw serviceError('INVALID_INPUT', 'no hay credenciales del backend configuradas');
    this.index = { assets: {}, idempotency: {} };
    this.lock = Promise.resolve();
  }

  async initialize() {
    await fsp.mkdir(this.tempDir, { recursive: true, mode: 0o700 });
    try {
      const parsed = JSON.parse(await fsp.readFile(this.indexPath, 'utf8'));
      if (parsed && typeof parsed === 'object' && parsed.assets && parsed.idempotency) this.index = parsed;
    } catch (error) {
      if (error.code !== 'ENOENT') throw serviceError('STORAGE_FAILED', 'no se pudo abrir el índice del backend', 500);
    }
    await this.pruneExpired();
  }

  authenticate(request) {
    const token = readAuthToken(request);
    return token ? this.tokens.get(token) : undefined;
  }

  async withLock(operation) {
    const previous = this.lock;
    let release;
    this.lock = new Promise((resolve) => { release = resolve; });
    await previous;
    try { return await operation(); } finally { release(); }
  }

  async persistIndex() {
    const temporary = `${this.indexPath}.${crypto.randomUUID()}.tmp`;
    await fsp.writeFile(temporary, JSON.stringify(this.index), { mode: 0o600, flag: 'wx' });
    await fsp.rename(temporary, this.indexPath);
  }

  assetPath(assetId) { return path.join(this.root, `${assetId}.bin`); }

  assetResult(asset) {
    return {
      providerId: this.providerId,
      storageOrigin: this.publicOrigin,
      assetId: asset.assetId,
      remoteUrl: `${this.publicOrigin}/v1/assets/${asset.assetId}`,
      mimeType: asset.mimeType,
      sizeBytes: String(asset.sizeBytes),
      width: asset.width,
      height: asset.height,
      hashAlgorithm: 'sha-256',
      hashValue: asset.hashValue,
      availability: asset.expiresAt && Date.parse(asset.expiresAt) <= Date.now() ? 'expired' : 'available',
      expiresAt: asset.expiresAt,
    };
  }

  async uploadFile(accountId, idempotencyKey, metadata, temporaryPath) {
    return this.withLock(async () => {
      const identity = `${accountId}|${idempotencyKey}`;
      const existingId = this.index.idempotency[identity];
      if (existingId) {
        const existing = this.index.assets[existingId];
        if (!existing || existing.hashValue !== metadata.hashValue || existing.sizeBytes !== metadata.sizeBytes)
          throw serviceError('CONFLICT', 'la idempotencia ya pertenece a otro contenido', 409);
        await fsp.rm(temporaryPath, { force: true });
        return this.assetResult(existing);
      }
      const bytes = await fsp.readFile(temporaryPath);
      validateImage(bytes, metadata);
      const duplicate = Object.values(this.index.assets).find((asset) => asset.accountId === accountId && asset.hashValue === metadata.hashValue && asset.sizeBytes === metadata.sizeBytes);
      if (duplicate) {
        this.index.idempotency[identity] = duplicate.assetId;
        await this.persistIndex();
        await fsp.rm(temporaryPath, { force: true });
        return this.assetResult(duplicate);
      }
      const currentBytes = Object.values(this.index.assets).filter((asset) => asset.accountId === accountId).reduce((total, asset) => total + asset.sizeBytes, 0);
      if (currentBytes + metadata.sizeBytes > this.maxStorageBytesPerAccount)
        throw serviceError('RESOURCE_CONSTRAINT', 'se alcanzó la cuota del backend', 429);
      const assetId = crypto.randomBytes(32).toString('base64url');
      const asset = {
        assetId, accountId, idempotencyKey, ...metadata,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + this.retentionSeconds * 1000).toISOString(),
      };
      await fsp.rename(temporaryPath, this.assetPath(assetId));
      this.index.assets[assetId] = asset;
      this.index.idempotency[identity] = assetId;
      await this.persistIndex();
      return this.assetResult(asset);
    });
  }

  getCapabilities() {
    return {
      providerId: this.providerId,
      storageOrigins: [this.publicOrigin],
      uploadSupported: true,
      downloadSupported: true,
      maxFileSize: String(MAX_STICKER_BYTES),
      retentionSeconds: this.retentionSeconds,
      readAccessMode: this.readAccessMode,
    };
  }

  authorizeRead(request, asset) {
    if (this.readAccessMode === 'opaque-url') return true;
    const accountId = this.authenticate(request);
    return Boolean(accountId);
  }

  resolve(assetId, request) {
    const asset = this.index.assets[assetId];
    if (!asset) throw serviceError('MEDIA_PREVIEW_UNAVAILABLE', 'el asset no está disponible', 404);
    if (!this.authorizeRead(request, asset)) throw serviceError('UNAUTHORIZED', 'la descarga no está autorizada', 401);
    if (Date.parse(asset.expiresAt) <= Date.now()) throw serviceError('MEDIA_PREVIEW_UNAVAILABLE', 'el asset expiró', 410);
    return asset;
  }

  async pruneExpired(now = Date.now()) {
    return this.withLock(async () => {
      const expired = Object.values(this.index.assets).filter((asset) => Date.parse(asset.expiresAt) <= now);
      for (const asset of expired) {
        await fsp.rm(this.assetPath(asset.assetId), { force: true });
        delete this.index.assets[asset.assetId];
        for (const [identity, assetId] of Object.entries(this.index.idempotency)) if (assetId === asset.assetId) delete this.index.idempotency[identity];
      }
      if (expired.length) await this.persistIndex();
      return expired.length;
    });
  }
}

function sendJson(response, statusCode, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' });
  response.end(body);
}

function readBodyToFile(request, target, maxBytes) {
  return new Promise((resolve, reject) => {
    const contentLength = Number(request.headers['content-length']);
    if (Number.isSafeInteger(contentLength) && contentLength > maxBytes) {
      request.resume();
      reject(serviceError('MEDIA_SIZE_EXCEEDED', 'el sticker supera 2 MiB', 413));
      return;
    }
    const output = fs.createWriteStream(target, { flags: 'wx', mode: 0o600 });
    let total = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      output.destroy();
      reject(error);
    };
    request.on('data', (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        request.destroy();
        fail(serviceError('MEDIA_SIZE_EXCEEDED', 'el sticker supera 2 MiB', 413));
        return;
      }
      output.write(chunk);
    });
    request.on('end', () => {
      if (settled) return;
      output.end(() => { settled = true; resolve({ bytes: total }); });
    });
    request.on('aborted', () => fail(serviceError('TRANSPORT_FAILED', 'la subida fue cancelada', 499)));
    request.on('error', fail);
    output.on('error', fail);
  });
}

function createStickerStorageRequestHandler(repository) {
  return async function handle(request, response) {
    try {
      const url = new URL(request.url, 'https://internal.invalid');
      if (request.method === 'GET' && url.pathname === '/v1/capabilities') {
        sendJson(response, 200, repository.getCapabilities());
        return;
      }
      const assetMatch = /^\/v1\/assets\/([A-Za-z0-9_-]{32,64})$/.exec(url.pathname);
      if ((request.method === 'HEAD' || request.method === 'GET') && assetMatch) {
        const asset = repository.resolve(assetMatch[1], request);
        const headers = {
          'content-type': asset.mimeType,
          'content-length': String(asset.sizeBytes),
          'cache-control': 'private, max-age=0',
          'x-atomic-provider-id': repository.providerId,
          'x-atomic-storage-origin': repository.publicOrigin,
          'x-atomic-asset-id': asset.assetId,
          'x-atomic-sha256': asset.hashValue,
          'x-atomic-width': String(asset.width),
          'x-atomic-height': String(asset.height),
          'x-atomic-expires-at': asset.expiresAt,
        };
        response.writeHead(200, headers);
        if (request.method === 'HEAD') { response.end(); return; }
        fs.createReadStream(repository.assetPath(asset.assetId)).on('error', () => response.destroy()).pipe(response);
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/assets') {
        const accountId = repository.authenticate(request);
        if (!accountId) throw serviceError('UNAUTHORIZED', 'la subida no está autorizada', 401);
        const idempotencyKey = textHeader(request.headers['x-atomic-client-message-id'], 'clientMessageId');
        const metadata = metadataFromHeaders(request.headers);
        const temporaryPath = path.join(repository.tempDir, `${crypto.randomUUID()}.upload`);
        try {
          await readBodyToFile(request, temporaryPath, MAX_STICKER_BYTES);
          const result = await repository.uploadFile(accountId, idempotencyKey, metadata, temporaryPath);
          sendJson(response, 200, result);
        } finally {
          await fsp.rm(temporaryPath, { force: true });
        }
        return;
      }
      throw serviceError('MEDIA_PREVIEW_UNAVAILABLE', 'recurso no disponible', 404);
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      sendJson(response, error.statusCode || 500, { code: error.code || 'INTERNAL', message: error.message || 'error interno' });
    }
  };
}

async function createStickerStorageService(options) {
  const repository = new StickerStorageRepository(options);
  await repository.initialize();
  return {
    repository,
    handler: createStickerStorageRequestHandler(repository),
    createHttpServer: () => http.createServer(createStickerStorageRequestHandler(repository)),
    createHttpsServer: (tlsOptions) => https.createServer(tlsOptions, createStickerStorageRequestHandler(repository)),
  };
}

module.exports = {
  MAX_STICKER_BYTES,
  StickerStorageRepository,
  createStickerStorageRequestHandler,
  createStickerStorageService,
  inspectImage,
};
