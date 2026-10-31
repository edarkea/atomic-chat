const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const https = require('node:https');
const dns = require('node:dns').promises;
const { inspectStaticImage } = require('./preview-image.cjs');
const { isPrivateAddress, validateHttpsUrl } = require('./xmpp-stickers.cjs');

const MAX_BYTES = 2 * 1024 * 1024;

function storeError(code, message) {
  const cause = new Error(message);
  cause.code = code;
  return cause;
}

function validHttps(value) {
  try { return new URL(validateHttpsUrl(value)); }
  catch (cause) { throw storeError(cause?.code || 'UNSUPPORTED', 'la fuente remota no es segura'); }
}

async function downloadHttps(url, options = {}) {
  const target = validHttps(url);
  const addresses = await (options.lookup || dns.lookup)(target.hostname, { all: true });
  if (!addresses?.length || addresses.some((entry) => isPrivateAddress(entry.address)))
    throw storeError('UNSUPPORTED', 'la fuente remota no es segura');
  const selected = addresses[0];
  return new Promise((resolve, reject) => {
    const request = https.get(target, {
      rejectUnauthorized: true,
      timeout: options.timeoutMs || 15000,
      lookup: (_hostname, _lookupOptions, callback) => callback(null, selected.address, selected.family),
    }, (response) => {
      if ((response.statusCode || 0) < 200 || (response.statusCode || 0) >= 300) {
        response.resume();
        reject(storeError('TRANSPORT_FAILED', 'la descarga del sticker fue rechazada'));
        return;
      }
      const announced = Number(response.headers['content-length']);
      if (Number.isSafeInteger(announced) && announced > MAX_BYTES) {
        response.destroy();
        reject(storeError('MEDIA_SIZE_EXCEEDED', 'el sticker remoto supera el límite permitido'));
        return;
      }
      const chunks = [];
      let total = 0;
      response.on('data', (chunk) => {
        total += chunk.length;
        if (total > MAX_BYTES) {
          response.destroy(storeError('MEDIA_SIZE_EXCEEDED', 'el sticker remoto supera el límite permitido'));
          return;
        }
        chunks.push(chunk);
      });
      response.once('error', reject);
      response.once('end', () => resolve(Buffer.concat(chunks)));
    });
    request.once('error', reject);
    request.once('timeout', () => request.destroy(storeError('TIMEOUT', 'la descarga del sticker expiró')));
  });
}

class StickerMessageStore {
  constructor(userDataPath, persistence, nativeImage, options = {}) {
    this.persistence = persistence;
    this.nativeImage = nativeImage;
    this.directory = path.join(userDataPath, 'sticker-message-assets');
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(this.directory, 0o700); } catch { /* Windows ACLs are inherited. */ }
    this.download = options.download || downloadHttps;
    this.assetStore = options.assetStore;
    this.stickerStore = options.stickerStore;
    this.locks = new Map();
  }

  withAccountLock(accountId, operation) {
    const previous = this.locks.get(accountId) || Promise.resolve();
    const tracked = previous.catch(() => undefined).then(operation).finally(() => {
      if (this.locks.get(accountId) === tracked) this.locks.delete(accountId);
    });
    this.locks.set(accountId, tracked);
    return tracked;
  }

  save(ref) {
    return this.publicRef(this.persistence.upsertStickerMessageRef(ref));
  }

  get(accountId, refId) {
    const ref = this.persistence.getStickerMessageRef(accountId, refId);
    return ref ? this.publicRef(ref) : null;
  }

  async load(accountId, refId, isAuthorized = () => true) {
    return this.withAccountLock(accountId, async () => {
      const current = this.persistence.getStickerMessageRef(accountId, refId);
      if (!current) throw storeError('MEDIA_PREVIEW_UNAVAILABLE', 'el sticker no está disponible');
      if (!isAuthorized()) throw storeError('UNAUTHORIZED', 'la operación ya no está autorizada');
      if (current.availability === 'available' && current.storageKey) return this.publicRef(current);
      if (!current.remoteUrl) throw storeError('MEDIA_PREVIEW_UNAVAILABLE', 'el sticker no tiene una fuente disponible');
      if (!isAuthorized()) throw storeError('UNAUTHORIZED', 'la operación ya no está autorizada');
      const bytes = await this.download(current.remoteUrl);
      if (!isAuthorized()) throw storeError('UNAUTHORIZED', 'la operación ya no está autorizada');
      const image = inspectStaticImage(bytes, this.nativeImage);
      const hashValue = crypto.createHash('sha256').update(bytes).digest('hex');
      if (image.mimeType !== current.mimeType || String(bytes.length) !== String(current.sizeBytes) || image.width !== current.width || image.height !== current.height || hashValue !== current.hashValue)
        throw storeError('MEDIA_DECODE_FAILED', 'el contenido remoto no coincide con la metadata');
      if (this.stickerStore) {
        const asset = await this.stickerStore.storeHistoricalAsset(accountId, bytes, {
          mimeType: current.mimeType, sizeBytes: current.sizeBytes, width: current.width, height: current.height, hashValue: current.hashValue,
        }, isAuthorized);
        const updated = this.persistence.markStickerMessageAvailable(accountId, refId, {
          storageKey: asset.storageKey, localAssetId: asset.assetId, availability: 'available', updatedAt: new Date().toISOString(),
        });
        if (current.storageKey && path.basename(current.storageKey) === current.storageKey)
          await fsp.rm(path.join(this.directory, current.storageKey), { force: true }).catch(() => undefined);
        return this.publicRef(updated);
      }
      const storageKey = `${current.refId}_${crypto.randomUUID()}.bin`;
      const target = path.join(this.directory, storageKey);
      const temporaryDirectory = await fsp.mkdtemp(path.join(this.directory, '.tmp-'));
      const temporaryPath = path.join(temporaryDirectory, `${crypto.randomUUID()}.bin`);
      try {
        await fsp.writeFile(temporaryPath, bytes, { flag: 'wx', mode: 0o600 });
        await fsp.rename(temporaryPath, target);
        if (!isAuthorized()) {
          await fsp.rm(target, { force: true }).catch(() => undefined);
          throw storeError('UNAUTHORIZED', 'la operación ya no está autorizada');
        }
        const updated = this.persistence.markStickerMessageAvailable(accountId, refId, {
          storageKey,
          localAssetId: current.localAssetId || `sticker_message_asset_${crypto.randomUUID()}`,
          availability: 'available',
          updatedAt: new Date().toISOString(),
        });
        return this.publicRef(updated);
      } catch (cause) {
        await fsp.rm(target, { force: true }).catch(() => undefined);
        throw cause?.code ? cause : storeError('STORAGE_FAILED', 'no se pudo guardar el sticker remoto');
      } finally {
        await fsp.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
      }
    });
  }

  resolveForPreview(accountId, previewId) {
    const prefix = 'message:';
    if (typeof previewId !== 'string' || !previewId.startsWith(prefix)) throw storeError('MEDIA_PREVIEW_UNAVAILABLE', 'el sticker no está disponible');
    const ref = this.persistence.getStickerMessageRef(accountId, previewId.slice(prefix.length));
    if (!ref || ref.availability !== 'available')
      throw storeError('MEDIA_PREVIEW_UNAVAILABLE', 'el sticker no está disponible');
    if (ref.localAssetId && this.assetStore) {
      try { return this.assetStore.resolveAssetForPreview(accountId, ref.localAssetId, previewId); } catch { /* fall through to historical bytes */ }
    }
    if (!ref.storageKey || path.basename(ref.storageKey) !== ref.storageKey)
      throw storeError('MEDIA_PREVIEW_UNAVAILABLE', 'el sticker no está disponible');
    return {
      accountId,
      stickerId: previewId,
      assetId: ref.localAssetId || ref.refId,
      path: path.join(this.directory, ref.storageKey),
      mimeType: ref.mimeType,
      sizeBytes: ref.sizeBytes,
      width: ref.width,
      height: ref.height,
      hashValue: ref.hashValue,
    };
  }

  publicRef(ref) {
    return {
      refId: ref.refId,
      previewStickerId: ref.previewStickerId,
      accountId: ref.accountId,
      conversationId: ref.conversationId,
      clientMessageId: ref.clientMessageId,
      ...(ref.stanzaId ? { stanzaId: ref.stanzaId } : {}),
      ...(ref.originId ? { originId: ref.originId } : {}),
      direction: ref.direction,
      ...(ref.senderJid ? { senderJid: ref.senderJid } : {}),
      ...(ref.sourceStickerId ? { sourceStickerId: ref.sourceStickerId } : {}),
      ...(ref.name ? { name: ref.name } : {}),
      ...(ref.altText ? { altText: ref.altText } : {}),
      ...(ref.fallbackText ? { fallbackText: ref.fallbackText } : {}),
      mimeType: ref.mimeType,
      sizeBytes: String(ref.sizeBytes),
      width: ref.width,
      height: ref.height,
      hashAlgorithm: 'sha-256',
      hashValue: ref.hashValue,
      ...(ref.localAssetId ? { localAssetId: ref.localAssetId } : {}),
      transportStatus: ref.transportStatus,
      availability: ref.availability,
      ...(ref.errorCode ? { errorCode: ref.errorCode } : {}),
      createdAt: ref.createdAt,
      updatedAt: ref.updatedAt,
    };
  }
}

module.exports = { StickerMessageStore, MAX_BYTES, downloadHttps };
