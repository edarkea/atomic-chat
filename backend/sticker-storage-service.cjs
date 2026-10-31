const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const https = require('node:https');
const path = require('node:path');

const MAX_STICKER_BYTES = 2 * 1024 * 1024;
const MAX_DIMENSION = 1024;
const MIME_TYPES = new Set(['image/png', 'image/jpeg']);
const ASSET_ID_PATTERN = /^[A-Za-z0-9_-]{32,64}$/;
const SAFE_ERROR_MESSAGES = new Map([
  ['INVALID_INPUT', 'la solicitud no es válida'],
  ['UNAUTHORIZED', 'la operación no está autorizada'],
  ['CONFLICT', 'la operación entra en conflicto con un recurso existente'],
  ['MEDIA_TYPE_UNSUPPORTED', 'el tipo de imagen no está permitido'],
  ['MEDIA_SIZE_EXCEEDED', 'el sticker supera el límite permitido'],
  ['MEDIA_DIMENSIONS_INVALID', 'las dimensiones de la imagen no están permitidas'],
  ['MEDIA_DECODE_FAILED', 'el contenido de la imagen no es válido'],
  ['MEDIA_PREVIEW_UNAVAILABLE', 'el recurso no está disponible'],
  ['RESOURCE_CONSTRAINT', 'se alcanzó el límite de almacenamiento'],
  ['STORAGE_FAILED', 'el almacenamiento no está disponible'],
  ['INTERNAL', 'la operación no está disponible'],
]);

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

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
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
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(pngSignature)) {
    let offset = 8;
    let header;
    let hasData = false;
    let hasEnd = false;
    while (offset < bytes.length) {
      if (offset + 12 > bytes.length) throw serviceError('MEDIA_DECODE_FAILED', 'el PNG está truncado');
      const length = bytes.readUInt32BE(offset);
      const type = bytes.subarray(offset + 4, offset + 8).toString('ascii');
      const chunkEnd = offset + 12 + length;
      if (chunkEnd > bytes.length || !/^[A-Za-z]{4}$/.test(type))
        throw serviceError('MEDIA_DECODE_FAILED', 'la estructura PNG no es válida');
      const data = bytes.subarray(offset + 8, offset + 8 + length);
      const expectedCrc = bytes.readUInt32BE(offset + 8 + length);
      const actualCrc = crc32(bytes.subarray(offset + 4, offset + 8 + length));
      if (expectedCrc !== actualCrc) throw serviceError('MEDIA_DECODE_FAILED', 'la integridad PNG no es válida');
      if (!header) {
        if (type !== 'IHDR' || length !== 13) throw serviceError('MEDIA_DECODE_FAILED', 'falta la cabecera PNG');
        const width = data.readUInt32BE(0);
        const height = data.readUInt32BE(4);
        const bitDepth = data[8];
        const colorType = data[9];
        const validBitDepths = {
          0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16],
        };
        if (!width || !height || !validBitDepths[colorType]?.includes(bitDepth) || data[10] !== 0 || data[11] !== 0 || data[12] !== 0)
          throw serviceError('MEDIA_DECODE_FAILED', 'los metadatos PNG no son válidos');
        header = { mimeType: 'image/png', width, height };
      } else if (type === 'IHDR') {
        throw serviceError('MEDIA_DECODE_FAILED', 'el PNG contiene varias cabeceras');
      }
      if (type === 'IDAT') hasData = true;
      if (type === 'IEND') {
        if (length !== 0 || !hasData) throw serviceError('MEDIA_DECODE_FAILED', 'el PNG está incompleto');
        hasEnd = true;
        offset = chunkEnd;
        break;
      }
      offset = chunkEnd;
    }
    if (!header || !hasEnd || offset !== bytes.length) throw serviceError('MEDIA_DECODE_FAILED', 'el PNG está truncado');
    return header;
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    let header;
    let hasScan = false;
    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) throw serviceError('MEDIA_DECODE_FAILED', 'la estructura JPEG no es válida');
      while (bytes[offset] === 0xff) offset += 1;
      if (offset >= bytes.length) throw serviceError('MEDIA_DECODE_FAILED', 'el JPEG está truncado');
      const marker = bytes[offset++];
      if (marker === 0xd9) {
        if (!header || !hasScan || offset !== bytes.length) throw serviceError('MEDIA_DECODE_FAILED', 'el JPEG está incompleto');
        return header;
      }
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) continue;
      if (offset + 2 > bytes.length) throw serviceError('MEDIA_DECODE_FAILED', 'el JPEG está truncado');
      const segmentLength = bytes.readUInt16BE(offset);
      if (segmentLength < 2 || offset + segmentLength > bytes.length)
        throw serviceError('MEDIA_DECODE_FAILED', 'el segmento JPEG está truncado');
      const progressive = marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
      if (progressive) {
        if (segmentLength < 8) throw serviceError('MEDIA_DECODE_FAILED', 'la cabecera JPEG no es válida');
        const height = bytes.readUInt16BE(offset + 3);
        const width = bytes.readUInt16BE(offset + 5);
        const components = bytes[offset + 7];
        if (!width || !height || !components || segmentLength !== 8 + components * 3)
          throw serviceError('MEDIA_DECODE_FAILED', 'los metadatos JPEG no son válidos');
        header = { mimeType: 'image/jpeg', width, height };
      }
      offset += segmentLength;
      if (marker === 0xda) {
        if (!header) throw serviceError('MEDIA_DECODE_FAILED', 'falta la cabecera JPEG');
        hasScan = true;
        while (offset < bytes.length) {
          if (bytes[offset] !== 0xff) { offset += 1; continue; }
          let markerOffset = offset;
          while (bytes[offset] === 0xff) offset += 1;
          if (offset >= bytes.length) throw serviceError('MEDIA_DECODE_FAILED', 'el JPEG está truncado');
          const scanMarker = bytes[offset];
          if (scanMarker === 0x00 || (scanMarker >= 0xd0 && scanMarker <= 0xd7)) { offset += 1; continue; }
          offset = markerOffset;
          break;
        }
      }
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

function cloneIndex(index) {
  return { assets: { ...index.assets }, idempotency: { ...index.idempotency } };
}

async function syncFile(filePath) {
  const handle = await fsp.open(filePath, 'r+');
  try { await handle.sync(); } finally { await handle.close(); }
}

async function syncDirectory(directory) {
  try {
    const handle = await fsp.open(directory, 'r');
    try { await handle.sync(); } finally { await handle.close(); }
  } catch (error) {
    if (!['EINVAL', 'ENOTSUP', 'EPERM', 'EISDIR'].includes(error.code)) throw error;
  }
}

function isStoredAsset(asset, assetId) {
  return Boolean(asset && typeof asset === 'object' && asset.assetId === assetId && ASSET_ID_PATTERN.test(assetId) &&
    typeof asset.accountId === 'string' && asset.accountId.length > 0 && typeof asset.idempotencyKey === 'string' &&
    MIME_TYPES.has(asset.mimeType) && Number.isSafeInteger(asset.sizeBytes) && asset.sizeBytes > 0 && asset.sizeBytes <= MAX_STICKER_BYTES &&
    Number.isInteger(asset.width) && asset.width > 0 && asset.width <= MAX_DIMENSION && Number.isInteger(asset.height) && asset.height > 0 && asset.height <= MAX_DIMENSION &&
    /^[a-f0-9]{64}$/.test(asset.hashValue) && typeof asset.expiresAt === 'string' && Number.isFinite(Date.parse(asset.expiresAt)) &&
    Array.isArray(asset.readerAccounts) && asset.readerAccounts.every((value) => typeof value === 'string' && value.length > 0));
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
    if (options.readPolicyApproved !== true)
      throw serviceError('INVALID_INPUT', 'la política de lectura requiere aprobación explícita');
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
      else throw serviceError('STORAGE_FAILED', 'el índice del backend no tiene un formato válido', 500);
    } catch (error) {
      if (error.code !== 'ENOENT') throw serviceError('STORAGE_FAILED', 'no se pudo abrir el índice del backend', 500);
    }
    await this.reconcile();
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

  async persistIndex(index = this.index) {
    const temporary = `${this.indexPath}.${crypto.randomUUID()}.tmp`;
    let renamed = false;
    try {
      await fsp.writeFile(temporary, JSON.stringify(index), { mode: 0o600, flag: 'wx' });
      await syncFile(temporary);
      await fsp.rename(temporary, this.indexPath);
      renamed = true;
      await syncDirectory(this.root);
    } finally {
      if (!renamed) await fsp.rm(temporary, { force: true });
    }
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

  async uploadFile(accountId, idempotencyKey, metadata, temporaryPath, readerAccounts = [accountId]) {
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
        const nextIndex = cloneIndex(this.index);
        nextIndex.idempotency[identity] = duplicate.assetId;
        await this.persistIndex(nextIndex);
        this.index = nextIndex;
        await fsp.rm(temporaryPath, { force: true });
        return this.assetResult(duplicate);
      }
      const currentBytes = Object.values(this.index.assets).filter((asset) => asset.accountId === accountId).reduce((total, asset) => total + asset.sizeBytes, 0);
      if (currentBytes + metadata.sizeBytes > this.maxStorageBytesPerAccount)
        throw serviceError('RESOURCE_CONSTRAINT', 'se alcanzó la cuota del backend', 429);
      const assetId = crypto.randomBytes(32).toString('base64url');
      const asset = {
        assetId, accountId, idempotencyKey, ...metadata,
        readerAccounts: [...new Set(readerAccounts)],
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + this.retentionSeconds * 1000).toISOString(),
      };
      await fsp.rename(temporaryPath, this.assetPath(assetId));
      const nextIndex = cloneIndex(this.index);
      nextIndex.assets[assetId] = asset;
      nextIndex.idempotency[identity] = assetId;
      try {
        await this.persistIndex(nextIndex);
      } catch (error) {
        await fsp.rm(this.assetPath(assetId), { force: true });
        throw error;
      }
      this.index = nextIndex;
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
      readPolicy: this.readAccessMode === 'opaque-url' ? 'opaque-url-capability' : 'account-allowlist',
    };
  }

  authorizeRead(request, asset) {
    if (this.readAccessMode === 'opaque-url') return true;
    const accountId = this.authenticate(request);
    return Boolean(accountId && asset.readerAccounts.includes(accountId));
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
      if (!expired.length) return 0;
      const nextIndex = cloneIndex(this.index);
      for (const asset of expired) {
        delete nextIndex.assets[asset.assetId];
        for (const [identity, assetId] of Object.entries(nextIndex.idempotency)) if (assetId === asset.assetId) delete nextIndex.idempotency[identity];
      }
      await this.persistIndex(nextIndex);
      this.index = nextIndex;
      for (const asset of expired) await fsp.rm(this.assetPath(asset.assetId), { force: true });
      return expired.length;
    });
  }

  async reconcile() {
    return this.withLock(async () => {
      const nextIndex = cloneIndex(this.index);
      let changed = false;
      for (const [assetId, asset] of Object.entries(nextIndex.assets)) {
        if (asset && asset.readerAccounts === undefined && typeof asset.accountId === 'string') {
          asset.readerAccounts = [asset.accountId];
          changed = true;
        }
        let valid = isStoredAsset(asset, assetId);
        if (valid) {
          try {
            const stat = await fsp.stat(this.assetPath(assetId));
            valid = stat.isFile() && stat.size === asset.sizeBytes;
          } catch (error) {
            if (error.code !== 'ENOENT') throw serviceError('STORAGE_FAILED', 'no se pudo revisar el almacenamiento', 500);
            valid = false;
          }
        }
        if (!valid) {
          delete nextIndex.assets[assetId];
          changed = true;
        }
      }
      for (const [identity, assetId] of Object.entries(nextIndex.idempotency)) {
        if (typeof identity !== 'string' || !nextIndex.assets[assetId]) {
          delete nextIndex.idempotency[identity];
          changed = true;
        }
      }
      const entries = await fsp.readdir(this.root, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.bin')) continue;
        const assetId = entry.name.slice(0, -4);
        if (!nextIndex.assets[assetId]) {
          await fsp.rm(path.join(this.root, entry.name), { force: true });
          changed = true;
        }
      }
      const temporaryEntries = await fsp.readdir(this.tempDir, { withFileTypes: true });
      for (const entry of temporaryEntries) await fsp.rm(path.join(this.tempDir, entry.name), { recursive: true, force: true });
      if (changed) {
        await this.persistIndex(nextIndex);
        this.index = nextIndex;
      }
      return changed;
    });
  }
}

function sendJson(response, statusCode, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8', 'content-length': body.length, 'cache-control': 'no-store' });
  response.end(body);
}

function readerAccountsFromHeaders(headers, owner, readAccessMode) {
  if (readAccessMode !== 'bearer') return [owner];
  const raw = headers['x-atomic-reader-accounts'];
  if (raw === undefined) return [owner];
  const accounts = String(raw).split(',').map((value) => textHeader(value.trim(), 'readerAccount', 256));
  return [...new Set([owner, ...accounts])];
}

function publicHttpError(error) {
  const code = SAFE_ERROR_MESSAGES.has(error?.code) ? error.code : 'INTERNAL';
  const statusByCode = {
    INVALID_INPUT: 400, UNAUTHORIZED: 401, CONFLICT: 409, MEDIA_TYPE_UNSUPPORTED: 415,
    MEDIA_SIZE_EXCEEDED: 413, MEDIA_DIMENSIONS_INVALID: 400, MEDIA_DECODE_FAILED: 422,
    MEDIA_PREVIEW_UNAVAILABLE: Number.isInteger(error?.statusCode) && error.statusCode === 410 ? 410 : 404,
    RESOURCE_CONSTRAINT: 429, STORAGE_FAILED: 500, INTERNAL: 500,
  };
  return { statusCode: statusByCode[code], body: { code, message: SAFE_ERROR_MESSAGES.get(code) } };
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
      output.end(async () => {
        if (settled) return;
        try {
          await syncFile(target);
          settled = true;
          resolve({ bytes: total });
        } catch (error) {
          fail(error);
        }
      });
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
        const readerAccounts = readerAccountsFromHeaders(request.headers, accountId, repository.readAccessMode);
        const temporaryPath = path.join(repository.tempDir, `${crypto.randomUUID()}.upload`);
        try {
          await readBodyToFile(request, temporaryPath, MAX_STICKER_BYTES);
          const result = await repository.uploadFile(accountId, idempotencyKey, metadata, temporaryPath, readerAccounts);
          sendJson(response, 200, result);
        } finally {
          await fsp.rm(temporaryPath, { force: true });
        }
        return;
      }
      throw serviceError('MEDIA_PREVIEW_UNAVAILABLE', 'recurso no disponible', 404);
    } catch (error) {
      if (response.headersSent) { response.destroy(); return; }
      const safe = publicHttpError(error);
      sendJson(response, safe.statusCode, safe.body);
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
