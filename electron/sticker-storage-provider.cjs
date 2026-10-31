const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const { isPrivateAddress, validateHttpsUrl, MAX_STICKER_BYTES, MAX_DIMENSION } = require('./xmpp-stickers.cjs');

const MIME_TYPES = new Set(['image/png', 'image/jpeg']);
const KNOWN_CODES = new Set([
  'INVALID_INPUT', 'UNAUTHORIZED', 'TIMEOUT', 'TRANSPORT_FAILED', 'UNSUPPORTED',
  'MEDIA_SIZE_EXCEEDED', 'MEDIA_DIMENSIONS_INVALID', 'MEDIA_DECODE_FAILED',
  'RESOURCE_CONSTRAINT', 'STORAGE_FAILED',
]);

function storageError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function requireText(value, code = 'INVALID_INPUT') {
  if (typeof value !== 'string' || !value.trim() || value.length > 512) throw storageError(code, 'el valor de almacenamiento no es válido');
  return value.trim();
}

function validateMetadata(value) {
  if (!value || !MIME_TYPES.has(value.mimeType)) throw storageError('MEDIA_TYPE_UNSUPPORTED', 'solo se permiten PNG/JPEG estáticos');
  const sizeBytes = Number(value.sizeBytes);
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 1 || sizeBytes > MAX_STICKER_BYTES)
    throw storageError('MEDIA_SIZE_EXCEEDED', 'el sticker supera el límite permitido');
  const width = Number(value.width);
  const height = Number(value.height);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION)
    throw storageError('MEDIA_DIMENSIONS_INVALID', 'las dimensiones del sticker no están permitidas');
  const hashValue = String(value.hashValue || '').toLowerCase();
  if (value.hashAlgorithm !== 'sha-256' || !/^[a-f0-9]{64}$/.test(hashValue))
    throw storageError('MEDIA_DECODE_FAILED', 'el hash del sticker no es válido');
  return { mimeType: value.mimeType, sizeBytes: String(sizeBytes), width, height, hashAlgorithm: 'sha-256', hashValue };
}

function validatePersistentUrl(value) {
  let parsed;
  try { parsed = new URL(validateHttpsUrl(value)); } catch (cause) {
    throw storageError(cause?.code || 'UNSUPPORTED', 'la fuente remota no es segura');
  }
  if (parsed.search || parsed.hash || parsed.username || parsed.password || isPrivateAddress(parsed.hostname))
    throw storageError('UNSUPPORTED', 'la fuente remota no es persistente o no está permitida');
  return parsed.toString();
}

async function assertPublicPersistentUrl(value, lookup) {
  const remoteUrl = validatePersistentUrl(value);
  const hostname = new URL(remoteUrl).hostname;
  const addresses = await lookup(hostname, { all: true });
  if (!addresses?.length || addresses.some((entry) => isPrivateAddress(entry.address)))
    throw storageError('UNSUPPORTED', 'la fuente remota no está permitida');
  return remoteUrl;
}

function validateExpiration(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || Date.parse(value) <= Date.now())
    throw storageError('UNSUPPORTED', 'el asset remoto ya no tiene una retención válida');
  return value;
}

async function validateAsset(value, expected, lookup) {
  if (!value || typeof value !== 'object') throw storageError('TRANSPORT_FAILED', 'el proveedor no devolvió un asset válido');
  const metadata = validateMetadata(value);
  if (expected && (
    metadata.mimeType !== expected.mimeType || metadata.sizeBytes !== String(expected.sizeBytes) ||
    metadata.width !== Number(expected.width) || metadata.height !== Number(expected.height) ||
    metadata.hashValue !== String(expected.hashValue).toLowerCase()
  )) throw storageError('MEDIA_DECODE_FAILED', 'el asset remoto no coincide con la metadata');
  if (typeof value.assetId !== 'string' || !value.assetId.trim() || value.assetId.length > 512)
    throw storageError('TRANSPORT_FAILED', 'el proveedor no devolvió una identidad de asset válida');
  if (value.availability !== 'available') throw storageError(value.availability === 'expired' ? 'MEDIA_PREVIEW_UNAVAILABLE' : 'UNSUPPORTED', 'el asset remoto no está disponible');
  return {
    ...metadata,
    assetId: value.assetId.trim(),
    remoteUrl: await assertPublicPersistentUrl(value.remoteUrl, lookup),
    availability: 'available',
    ...(validateExpiration(value.expiresAt) ? { expiresAt: value.expiresAt } : {}),
  };
}

async function callTransport(operation, callback) {
  try { return await callback(); } catch (cause) {
    if (KNOWN_CODES.has(cause?.code)) throw cause;
    throw storageError('TRANSPORT_FAILED', `falló la operación ${operation} del proveedor`);
  }
}

function createStickerStorageProvider(transport, options = {}) {
  if (!transport || typeof transport !== 'object') throw storageError('INVALID_INPUT', 'falta el transporte del proveedor');
  for (const method of ['getCapabilities', 'uploadSticker', 'resolveSticker', 'downloadSticker'])
    if (typeof transport[method] !== 'function') throw storageError('INVALID_INPUT', `falta la operación ${method} del proveedor`);
  if (typeof options.authorizeAccount !== 'function') throw storageError('INVALID_INPUT', 'falta la autorización del proveedor');
  const lookup = options.lookup || dns.lookup;
  const authorizeAccount = options.authorizeAccount;
  async function assertAuthorized(accountId) {
    if (!(await authorizeAccount(accountId))) throw storageError('UNAUTHORIZED', 'la cuenta no está autorizada para el proveedor');
  }

  return {
    async getCapabilities(input) {
      const accountId = requireText(input?.accountId);
      await assertAuthorized(accountId);
      const value = await callTransport('getCapabilities', () => transport.getCapabilities({ accountId }));
      if (!value || typeof value.providerId !== 'string' || !value.providerId.trim() ||
          value.uploadSupported !== true || value.downloadSupported !== true)
        throw storageError('UNSUPPORTED', 'el proveedor no ofrece subida y recuperación persistentes');
      if (value.maxFileSize !== undefined && (!Number.isSafeInteger(Number(value.maxFileSize)) || Number(value.maxFileSize) < 1))
        throw storageError('UNSUPPORTED', 'el límite del proveedor no es válido');
      return {
        providerId: value.providerId.trim(), uploadSupported: true, downloadSupported: true,
        ...(value.maxFileSize !== undefined ? { maxFileSize: String(value.maxFileSize) } : {}),
        ...(value.retentionSeconds !== undefined ? { retentionSeconds: Number(value.retentionSeconds) } : {}),
      };
    },
    async uploadSticker(input) {
      const accountId = requireText(input?.accountId);
      await assertAuthorized(accountId);
      const idempotencyKey = requireText(input?.idempotencyKey);
      const metadata = validateMetadata(input?.metadata);
      const bytes = Buffer.from(input?.bytes || []);
      if (bytes.length !== Number(metadata.sizeBytes)) throw storageError('MEDIA_DECODE_FAILED', 'los bytes no coinciden con la metadata');
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== metadata.hashValue)
        throw storageError('MEDIA_DECODE_FAILED', 'la integridad del asset no coincide');
      const result = await callTransport('uploadSticker', () => transport.uploadSticker({ accountId, idempotencyKey, metadata, bytes }));
      return validateAsset(result, metadata, lookup);
    },
    async resolveSticker(input) {
      const accountId = requireText(input?.accountId);
      await assertAuthorized(accountId);
      const remoteUrl = await assertPublicPersistentUrl(input?.remoteUrl, lookup);
      const expected = validateMetadata(input?.expected);
      const result = await callTransport('resolveSticker', () => transport.resolveSticker({
        accountId, ...(input?.assetId ? { assetId: requireText(input.assetId) } : {}), remoteUrl, expected,
      }));
      return validateAsset(result, expected, lookup);
    },
    async downloadSticker(input) {
      const accountId = requireText(input?.accountId);
      await assertAuthorized(accountId);
      const remoteUrl = await assertPublicPersistentUrl(input?.remoteUrl, lookup);
      const expected = validateMetadata(input?.expected);
      const result = await callTransport('downloadSticker', () => transport.downloadSticker({
        accountId, ...(input?.assetId ? { assetId: requireText(input.assetId) } : {}), remoteUrl, expected,
      }));
      const bytes = Buffer.from(result || []);
      if (bytes.length !== Number(expected.sizeBytes) || crypto.createHash('sha256').update(bytes).digest('hex') !== expected.hashValue)
        throw storageError('MEDIA_DECODE_FAILED', 'la descarga no coincide con el hash esperado');
      return bytes;
    },
  };
}

module.exports = { createStickerStorageProvider, storageError, validateMetadata, validatePersistentUrl, assertPublicPersistentUrl };
