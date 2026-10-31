const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { inspectStaticImage } = require('./preview-image.cjs');

const MAX_STICKER_BYTES = 2 * 1024 * 1024;
const MAX_STICKER_DIMENSION = 1024;
const MAX_STICKERS_PER_ACCOUNT = 250;
const MAX_STORAGE_BYTES_PER_ACCOUNT = 128 * 1024 * 1024;
const ORPHAN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const SAFE_READ_FLAGS = process.platform === 'win32' ? 'r' : fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);

function error(code, message) {
  const cause = new Error(message);
  cause.code = code;
  return cause;
}

function historicalStickerId(refId) {
  return `sticker_saved_${crypto.createHash('sha256').update(refId).digest('hex').slice(0, 32)}`;
}

function metadata(stats) {
  return {
    dev: String(stats.dev),
    ino: String(stats.ino),
    size: String(stats.size),
    mtimeMs: String(stats.mtimeMs),
    birthtimeMs: String(stats.birthtimeMs),
  };
}

function sameMetadata(left, right) {
  return ['dev', 'ino', 'size', 'mtimeMs', 'birthtimeMs'].every((key) => left[key] === right[key]);
}

class StickerStore {
  constructor(userDataPath, persistence, nativeImage, options = {}) {
    this.persistence = persistence;
    this.nativeImage = nativeImage;
    this.directory = path.join(userDataPath, 'sticker-assets');
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    try { fs.chmodSync(this.directory, 0o700); } catch { /* Windows ACLs are inherited. */ }
    this.locks = new Map();
    this.activeGrantChecker = () => false;
    this.removeFile = options.removeFile || ((filePath, removeOptions) => fsp.rm(filePath, removeOptions));
  }

  setActiveGrantChecker(checker) {
    this.activeGrantChecker = checker;
  }

  withAccountLock(accountId, operation) {
    const previous = this.locks.get(accountId) || Promise.resolve();
    const tracked = previous.catch(() => undefined).then(operation).finally(() => {
      if (this.locks.get(accountId) === tracked) this.locks.delete(accountId);
    });
    this.locks.set(accountId, tracked);
    return tracked;
  }

  async importFile(accountId, sourcePath, isAuthorized = () => true) {
    if (typeof accountId !== 'string' || !accountId.trim() || typeof sourcePath !== 'string' || !sourcePath.trim())
      throw error('INVALID_INPUT', 'la fuente de sticker no es válida');
    return this.withAccountLock(accountId, () => this.importLocked(accountId, sourcePath, isAuthorized));
  }

  async importLocked(accountId, sourcePath, isAuthorized = () => true) {
    const inspected = await this.readAndInspect(sourcePath);
    const hashValue = crypto.createHash('sha256').update(inspected.data).digest('hex');
    if (!isAuthorized()) throw error('UNAUTHORIZED', 'la cuenta o ventana ya no está autorizada');
    const existing = this.persistence.getStickerAssetByHash(accountId, hashValue);
    if (existing) {
      const count = this.persistence.countStickers(accountId);
      if (count >= MAX_STICKERS_PER_ACCOUNT) throw error('RESOURCE_CONSTRAINT', 'se alcanzó el límite de stickers');
      const now = new Date().toISOString();
      const sticker = {
        stickerId: `sticker_${crypto.randomUUID()}`,
        accountId,
        assetId: existing.assetId,
        name: path.basename(sourcePath),
        altText: path.basename(sourcePath),
        sortKey: `${now}_${crypto.randomUUID()}`,
        availability: existing.availability === 'available' ? 'available' : existing.availability,
        createdAt: now,
        updatedAt: now,
      };
      const usable = existing.availability === 'available' && await this.isManagedAssetValid(existing);
      if (usable) {
        if (!isAuthorized()) throw error('UNAUTHORIZED', 'la cuenta o ventana ya no está autorizada');
        const reference = this.persistence.insertStickerReference({
          stickerId: sticker.stickerId,
          accountId,
          assetId: existing.assetId,
          name: sticker.name,
          altText: sticker.altText,
          sortKey: sticker.sortKey,
          availability: 'available',
          createdAt: sticker.createdAt,
          updatedAt: sticker.updatedAt,
        });
        return { sticker: this.publicSticker(reference), asset: this.publicAsset({ ...existing, availability: 'available' }), deduplicated: true };
      }
      if (!isAuthorized()) throw error('UNAUTHORIZED', 'la cuenta o ventana ya no está autorizada');
      const published = await this.publishBytes(existing.assetId, inspected.data);
      try {
        if (!isAuthorized()) throw error('UNAUTHORIZED', 'la cuenta o ventana ya no está autorizada');
        const recovered = this.persistence.recoverStickerAssetAndSticker(
          { accountId, assetId: existing.assetId, mimeType: inspected.image.mimeType, sizeBytes: String(inspected.data.length), width: inspected.image.width, height: inspected.image.height, storageKey: published.storageKey, updatedAt: now },
          { ...sticker, availability: 'available' },
        );
        if (existing.storageKey && existing.storageKey !== published.storageKey)
          await fsp.rm(path.join(this.directory, existing.storageKey), { force: true }).catch(() => undefined);
        return { sticker: this.publicSticker(recovered.sticker), asset: this.publicAsset(recovered.asset), deduplicated: true };
      } catch (cause) {
        await fsp.rm(published.targetPath, { force: true }).catch(() => undefined);
        if (cause?.code === 'UNAUTHORIZED') throw cause;
        throw error(cause?.code === 'SQLITE_FULL' ? 'STORAGE_FAILED' : 'STORAGE_FAILED', 'no se pudo recuperar el asset');
      }
    }
    if (this.persistence.countStickers(accountId) >= MAX_STICKERS_PER_ACCOUNT)
      throw error('RESOURCE_CONSTRAINT', 'se alcanzó el límite de stickers');
    const used = Number(this.persistence.sumStickerStorage(accountId));
    if (used + inspected.data.length > MAX_STORAGE_BYTES_PER_ACCOUNT)
      throw error('RESOURCE_CONSTRAINT', 'se alcanzó el límite de almacenamiento de stickers');
    if (!isAuthorized()) throw error('UNAUTHORIZED', 'la cuenta o ventana ya no está autorizada');
    const now = new Date().toISOString();
    const assetId = `sticker_asset_${crypto.randomUUID()}`;
    const storageKey = `${assetId}.bin`;
    const targetPath = path.join(this.directory, storageKey);
    const temporaryDirectory = await fsp.mkdtemp(path.join(this.directory, '.tmp-'));
    const temporaryPath = path.join(temporaryDirectory, `${crypto.randomUUID()}.bin`);
    let published = false;
    try {
      await fsp.writeFile(temporaryPath, inspected.data, { flag: 'wx', mode: 0o600 });
      const handle = await fsp.open(temporaryPath, 'r+');
      try { await handle.sync(); } finally { await handle.close().catch(() => undefined); }
      await fsp.rename(temporaryPath, targetPath);
      published = true;
      const asset = {
        assetId, accountId, hashValue, mimeType: inspected.image.mimeType,
        sizeBytes: String(inspected.data.length), width: inspected.image.width, height: inspected.image.height,
        storageKey, availability: 'available', createdAt: now, updatedAt: now,
      };
      const sticker = {
        stickerId: `sticker_${crypto.randomUUID()}`, accountId, assetId, name: path.basename(sourcePath),
        altText: path.basename(sourcePath), sortKey: `${now}_${crypto.randomUUID()}`,
        availability: 'available', createdAt: now, updatedAt: now,
      };
      if (!isAuthorized()) throw error('UNAUTHORIZED', 'la cuenta o ventana ya no está autorizada');
      try {
        const saved = this.persistence.createStickerAssetAndSticker(asset, sticker);
        return { sticker: this.publicSticker(saved.sticker), asset: this.publicAsset(saved.asset), deduplicated: false };
      } catch (cause) {
        throw error(cause?.code === 'SQLITE_FULL' ? 'STORAGE_FAILED' : 'STORAGE_FAILED', 'no se pudo confirmar el sticker');
      }
    } catch (cause) {
      if (published) await fsp.rm(targetPath, { force: true }).catch(() => undefined);
      throw cause?.code ? cause : error('STORAGE_FAILED', 'no se pudo importar el sticker');
    } finally {
      await fsp.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async isManagedAssetValid(asset) {
    const targetPath = path.join(this.directory, asset.storageKey);
    let initial;
    try { initial = await fsp.lstat(targetPath); } catch { return false; }
    if (initial.isSymbolicLink() || !initial.isFile() || String(initial.size) !== String(asset.sizeBytes)) return false;
    const handle = await fsp.open(targetPath, SAFE_READ_FLAGS).catch(() => null);
    if (!handle) return false;
    const digest = crypto.createHash('sha256');
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || !sameMetadata(metadata(initial), metadata(opened))) return false;
      const buffer = Buffer.alloc(64 * 1024);
      let offset = 0;
      while (offset < Number(asset.sizeBytes)) {
        const result = await handle.read(buffer, 0, Math.min(buffer.length, Number(asset.sizeBytes) - offset), offset);
        if (!result.bytesRead) return false;
        digest.update(buffer.subarray(0, result.bytesRead));
        offset += result.bytesRead;
      }
      const final = await handle.stat();
      return sameMetadata(metadata(opened), metadata(final)) && digest.digest('hex') === asset.hashValue;
    } catch { return false; }
    finally { await handle.close().catch(() => undefined); }
  }

  async publishBytes(assetId, data) {
    const storageKey = `${assetId}_${crypto.randomUUID()}.bin`;
    const targetPath = path.join(this.directory, storageKey);
    const temporaryDirectory = await fsp.mkdtemp(path.join(this.directory, '.tmp-'));
    const temporaryPath = path.join(temporaryDirectory, `${crypto.randomUUID()}.bin`);
    try {
      await fsp.writeFile(temporaryPath, data, { flag: 'wx', mode: 0o600 });
      const handle = await fsp.open(temporaryPath, 'r+');
      try { await handle.sync(); } finally { await handle.close().catch(() => undefined); }
      await fsp.rename(temporaryPath, targetPath);
      return { storageKey, targetPath };
    } catch (cause) {
      await fsp.rm(targetPath, { force: true }).catch(() => undefined);
      throw cause;
    } finally { await fsp.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined); }
  }

  async storeHistoricalAsset(accountId, data, expected, isAuthorized = () => true) {
    return this.withAccountLock(accountId, async () => {
      if (!Buffer.isBuffer(data) || data.length < 1 || data.length > MAX_STICKER_BYTES)
        throw error('MEDIA_SIZE_EXCEEDED', 'el sticker supera 2 MiB');
      const inspected = inspectStaticImage(data, this.nativeImage);
      const hashValue = crypto.createHash('sha256').update(data).digest('hex');
      if (hashValue !== String(expected.hashValue).toLowerCase() || inspected.mimeType !== expected.mimeType ||
          data.length !== Number(expected.sizeBytes) || inspected.width !== Number(expected.width) || inspected.height !== Number(expected.height))
        throw error('MEDIA_DECODE_FAILED', 'el contenido histórico no coincide con su metadata');
      if (!isAuthorized()) throw error('UNAUTHORIZED', 'la cuenta o ventana ya no está autorizada');
      let asset = this.persistence.getStickerAssetByHash(accountId, hashValue);
      if (asset?.availability === 'available' && await this.isManagedAssetValid(asset)) return asset;
      if (!asset && this.persistence.sumStickerStorage(accountId) + data.length > MAX_STORAGE_BYTES_PER_ACCOUNT)
        throw error('RESOURCE_CONSTRAINT', 'se alcanzó el límite de almacenamiento de stickers');
      const assetId = asset?.assetId || `sticker_asset_${crypto.randomUUID()}`;
      const published = await this.publishBytes(assetId, data);
      try {
        if (!isAuthorized()) throw error('UNAUTHORIZED', 'la cuenta o ventana ya no está autorizada');
        asset = asset
          ? this.persistence.updateStickerAsset({ accountId, assetId, mimeType: inspected.mimeType, sizeBytes: data.length, width: inspected.width, height: inspected.height, storageKey: published.storageKey, updatedAt: new Date().toISOString() })
          : this.persistence.insertStickerAsset({ accountId, assetId, hashValue, mimeType: inspected.mimeType, sizeBytes: String(data.length), width: inspected.width, height: inspected.height, storageKey: published.storageKey, availability: 'available', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        return asset;
      } catch (cause) {
        await fsp.rm(published.targetPath, { force: true }).catch(() => undefined);
        throw cause?.code ? cause : error('STORAGE_FAILED', 'no se pudo guardar el asset histórico');
      }
    });
  }

  async readAndInspect(sourcePath) {
    let initial;
    try { initial = await fsp.lstat(sourcePath); } catch { throw error('STORAGE_FAILED', 'el archivo no está disponible'); }
    if (initial.isSymbolicLink() || !initial.isFile()) throw error('STORAGE_FAILED', 'el archivo no es regular');
    if (initial.size > MAX_STICKER_BYTES) throw error('MEDIA_SIZE_EXCEEDED', 'el sticker supera 2 MiB');
    let resolved;
    try { resolved = await fsp.realpath(sourcePath); } catch { throw error('STORAGE_FAILED', 'el archivo no está disponible'); }
    const handle = await fsp.open(resolved, SAFE_READ_FLAGS).catch(() => { throw error('STORAGE_FAILED', 'no se pudo abrir el sticker'); });
    try {
      const opened = await handle.stat();
      if (!opened.isFile() || !sameMetadata(metadata(initial), metadata(opened))) throw error('STORAGE_FAILED', 'el archivo cambió');
      if (opened.size > MAX_STICKER_BYTES) throw error('MEDIA_SIZE_EXCEEDED', 'el sticker supera 2 MiB');
      const data = await handle.readFile();
      const final = await handle.stat();
      if (!sameMetadata(metadata(opened), metadata(final)) || data.length !== Number(final.size)) throw error('STORAGE_FAILED', 'el archivo cambió durante la lectura');
      const image = inspectStaticImage(data, this.nativeImage);
      if (image.width > MAX_STICKER_DIMENSION || image.height > MAX_STICKER_DIMENSION)
        throw error('MEDIA_DIMENSIONS_INVALID', 'las dimensiones del sticker no están permitidas');
      return { data, image };
    } finally { await handle.close().catch(() => undefined); }
  }

  list(accountId, query = '', limit = MAX_STICKERS_PER_ACCOUNT, packId) {
    const bounded = Math.max(1, Math.min(MAX_STICKERS_PER_ACCOUNT, Number(limit) || MAX_STICKERS_PER_ACCOUNT));
    return this.persistence.listStickers(accountId, query, bounded, packId).map((sticker) => ({
      ...this.publicSticker(sticker),
      availability: this.persistence.getStickerAsset(accountId, sticker.assetId)?.availability || 'missing',
    }));
  }

  async delete(accountId, stickerId) {
    return this.withAccountLock(accountId, async () => {
      const sticker = this.persistence.deleteSticker(accountId, stickerId);
      if (sticker) await this.cleanupAccountOrphans(accountId);
    });
  }

  async saveHistoricalMessage(accountId, source, message, isAuthorized = () => true) {
    return this.withAccountLock(accountId, async () => {
      if (!source?.path || source.accountId !== accountId || !message?.refId)
        throw error('INVALID_INPUT', 'la referencia histórica no es válida');
      const stickerId = historicalStickerId(message.refId);
      const existingSticker = this.persistence.getSticker(accountId, stickerId);
      if (existingSticker) return this.publicSticker(existingSticker);
      if (this.persistence.countStickers(accountId) >= MAX_STICKERS_PER_ACCOUNT)
        throw error('RESOURCE_CONSTRAINT', 'se alcanzó el límite de stickers');
      if (!isAuthorized()) throw error('UNAUTHORIZED', 'la cuenta o ventana ya no está autorizada');
      const inspected = await this.readAndInspect(source.path);
      const hashValue = crypto.createHash('sha256').update(inspected.data).digest('hex');
      if (hashValue !== String(message.hashValue).toLowerCase() || inspected.image.mimeType !== message.mimeType ||
          inspected.data.length !== Number(message.sizeBytes) || inspected.image.width !== Number(message.width) ||
          inspected.image.height !== Number(message.height))
        throw error('MEDIA_DECODE_FAILED', 'el contenido histórico no coincide con su metadata');
      if (!isAuthorized()) throw error('UNAUTHORIZED', 'la cuenta o ventana ya no está autorizada');
      const now = new Date().toISOString();
      let asset = this.persistence.getStickerAssetByHash(accountId, hashValue);
      let published;
      let createdAsset = false;
      if (!asset || asset.availability !== 'available') {
        if (!asset && this.persistence.sumStickerStorage(accountId) + inspected.data.length > MAX_STORAGE_BYTES_PER_ACCOUNT)
          throw error('RESOURCE_CONSTRAINT', 'se alcanzó el límite de almacenamiento de stickers');
        const assetId = asset?.assetId || `sticker_asset_${crypto.randomUUID()}`;
        createdAsset = !asset;
        published = await this.publishBytes(assetId, inspected.data);
        try {
          if (!isAuthorized()) throw error('UNAUTHORIZED', 'la cuenta o ventana ya no está autorizada');
          asset = asset
            ? this.persistence.updateStickerAsset({ accountId, assetId, mimeType: inspected.image.mimeType, sizeBytes: inspected.data.length, width: inspected.image.width, height: inspected.image.height, storageKey: published.storageKey, updatedAt: now })
            : this.persistence.insertStickerAsset({ accountId, assetId, hashValue, mimeType: inspected.image.mimeType, sizeBytes: String(inspected.data.length), width: inspected.image.width, height: inspected.image.height, storageKey: published.storageKey, availability: 'available', createdAt: now, updatedAt: now });
        } catch (cause) {
          await fsp.rm(published.targetPath, { force: true }).catch(() => undefined);
          throw cause?.code ? cause : error('STORAGE_FAILED', 'no se pudo guardar el asset histórico');
        }
      }
      if (!isAuthorized()) throw error('UNAUTHORIZED', 'la cuenta o ventana ya no está autorizada');
      try {
        return this.publicSticker(this.persistence.insertStickerReference({
          stickerId, accountId, assetId: asset.assetId, name: message.name || 'sticker',
          altText: message.altText || message.fallbackText || 'sticker', sortKey: `${now}_${stickerId}`,
          availability: 'available', createdAt: now, updatedAt: now,
        }));
      } catch (cause) {
        if (published && createdAsset) {
          this.persistence.deleteStickerAsset(accountId, asset.assetId);
          await fsp.rm(published.targetPath, { force: true }).catch(() => undefined);
        }
        throw cause?.code ? cause : error('STORAGE_FAILED', 'no se pudo guardar el sticker histórico');
      }
    });
  }

  resolveForPreview(accountId, stickerId) {
    const sticker = this.persistence.getSticker(accountId, stickerId);
    const asset = sticker && this.persistence.getStickerAsset(accountId, sticker.assetId);
    if (!sticker || !asset || asset.availability !== 'available') throw error('MEDIA_PREVIEW_UNAVAILABLE', 'el sticker no está disponible');
    return {
      accountId, stickerId, assetId: asset.assetId, path: path.join(this.directory, asset.storageKey),
      mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, width: asset.width, height: asset.height, hashValue: asset.hashValue,
    };
  }

  async resolveForSend(accountId, stickerId) {
    const source = this.resolveForPreview(accountId, stickerId);
    const inspected = await this.readAndInspect(source.path);
    if (inspected.image.width === 512 && inspected.image.height === 512)
      return { ...source, bytes: inspected.data };
    if (!this.nativeImage || typeof this.nativeImage.createFromBuffer !== 'function')
      throw error('MEDIA_DECODE_FAILED', 'no hay transformador de imágenes disponible');
    const image = this.nativeImage.createFromBuffer(inspected.data);
    if (!image || image.isEmpty() || typeof image.resize !== 'function')
      throw error('MEDIA_DECODE_FAILED', 'no se pudo normalizar el sticker');
    if (typeof image.getSize !== 'function' || typeof image.toBitmap !== 'function' || typeof this.nativeImage.createFromBitmap !== 'function')
      throw error('MEDIA_DECODE_FAILED', 'no se pudo construir el lienzo del sticker');
    const originalSize = image.getSize();
    const scale = Math.min(512 / originalSize.width, 512 / originalSize.height);
    const contentWidth = Math.max(1, Math.round(originalSize.width * scale));
    const contentHeight = Math.max(1, Math.round(originalSize.height * scale));
    const resized = image.resize({ width: contentWidth, height: contentHeight, quality: 'best' });
    const bitmap = resized.toBitmap();
    const canvas = Buffer.alloc(512 * 512 * 4);
    const left = Math.floor((512 - contentWidth) / 2);
    const top = Math.floor((512 - contentHeight) / 2);
    for (let row = 0; row < contentHeight; row += 1)
      bitmap.copy(canvas, ((top + row) * 512 + left) * 4, row * contentWidth * 4, (row + 1) * contentWidth * 4);
    const square = this.nativeImage.createFromBitmap(canvas, { width: 512, height: 512, scaleFactor: 1 });
    const bytes = inspected.image.mimeType === 'image/png' ? square.toPNG() : square.toJPEG(90);
    const normalized = inspectStaticImage(bytes, this.nativeImage);
    if (normalized.width !== 512 || normalized.height !== 512 || bytes.length > MAX_STICKER_BYTES)
      throw error('MEDIA_DECODE_FAILED', 'la normalización no produjo un lienzo 512x512');
    return {
      ...source,
      bytes,
      mimeType: normalized.mimeType,
      sizeBytes: String(bytes.length),
      width: normalized.width,
      height: normalized.height,
      hashValue: crypto.createHash('sha256').update(bytes).digest('hex'),
    };
  }

  resolveAssetForPreview(accountId, assetId, stickerId = assetId) {
    const asset = this.persistence.getStickerAsset(accountId, assetId);
    if (!asset || asset.availability !== 'available' || path.basename(asset.storageKey) !== asset.storageKey)
      throw error('MEDIA_PREVIEW_UNAVAILABLE', 'el sticker no está disponible');
    return {
      accountId, stickerId, assetId: asset.assetId, path: path.join(this.directory, asset.storageKey),
      mimeType: asset.mimeType, sizeBytes: asset.sizeBytes, width: asset.width, height: asset.height, hashValue: asset.hashValue,
    };
  }

  savedStickerIdForMessage(accountId, refId) {
    const stickerId = historicalStickerId(refId);
    return this.persistence.getSticker(accountId, stickerId) ? stickerId : undefined;
  }

  async reconcile() {
    const accounts = new Set(this.persistence.listStickerAssets().map((asset) => asset.accountId));
    for (const accountId of accounts)
      await this.withAccountLock(accountId, () => this.reconcileAccount(accountId));
    await this.cleanupOrphans();
  }

  async reconcileAccount(accountId) {
    for (const snapshot of this.persistence.listStickerAssets(accountId)) {
      const currentBeforeRead = this.persistence.getStickerAsset(accountId, snapshot.assetId);
      if (!this.sameAssetSnapshot(snapshot, currentBeforeRead)) continue;
      let availability = 'missing';
      try {
        const stats = await fsp.lstat(path.join(this.directory, snapshot.storageKey));
        if (!stats.isSymbolicLink() && stats.isFile() && String(stats.size) === String(snapshot.sizeBytes))
          availability = await this.isManagedAssetValid(snapshot) ? 'available' : 'invalid';
        else availability = 'invalid';
      } catch { availability = 'missing'; }
      const currentAfterRead = this.persistence.getStickerAsset(accountId, snapshot.assetId);
      if (this.sameAssetSnapshot(snapshot, currentAfterRead))
        this.persistence.markStickerAssetAvailability(accountId, snapshot.assetId, availability);
    }
  }

  sameAssetSnapshot(snapshot, current) {
    return Boolean(current && current.accountId === snapshot.accountId && current.assetId === snapshot.assetId && current.storageKey === snapshot.storageKey && current.updatedAt === snapshot.updatedAt && current.availability === snapshot.availability);
  }

  async cleanupOrphans(now = Date.now()) {
    const accounts = new Set(this.persistence.listStickerAssets().map((asset) => asset.accountId));
    await Promise.all([...accounts].map((accountId) => this.withAccountLock(accountId, () => this.cleanupAccountOrphans(accountId, now))));
  }

  async cleanupAccountOrphans(accountId, now = Date.now()) {
    for (const candidate of this.persistence.listStickerAssets(accountId)) {
      if (!candidate.orphanedAt || now - Date.parse(candidate.orphanedAt) < ORPHAN_RETENTION_MS) continue;
      const asset = this.persistence.getStickerAsset(accountId, candidate.assetId);
      if (!asset?.orphanedAt || this.persistence.hasStickerReferences(asset.assetId) || this.activeGrantChecker(accountId, asset.assetId)) continue;
      const filePath = path.join(this.directory, asset.storageKey);
      try {
        await this.removeFile(filePath, { force: true });
      } catch (cause) {
        if (cause?.code !== 'ENOENT') continue;
      }
      try {
        await fsp.lstat(filePath);
        continue;
      } catch (cause) {
        if (cause?.code !== 'ENOENT') continue;
      }
      const current = this.persistence.getStickerAsset(accountId, asset.assetId);
      if (current?.orphanedAt && !this.persistence.hasStickerReferences(asset.assetId) && !this.activeGrantChecker(accountId, asset.assetId))
        this.persistence.deleteStickerAsset(accountId, asset.assetId);
    }
  }

  publicAsset(asset) {
    return {
      assetId: asset.assetId, accountId: asset.accountId, kind: 'static-image', mimeType: asset.mimeType,
      hash: { algorithm: 'sha-256', value: asset.hashValue }, sizeBytes: String(asset.sizeBytes),
      width: asset.width, height: asset.height, availability: asset.availability,
      createdAt: asset.createdAt, updatedAt: asset.updatedAt,
    };
  }

  publicSticker(sticker) {
    return {
      stickerId: sticker.stickerId, accountId: sticker.accountId, assetId: sticker.assetId,
      ...(sticker.name ? { name: sticker.name } : {}), ...(sticker.altText ? { altText: sticker.altText } : {}),
      sortKey: sticker.sortKey, availability: sticker.availability, createdAt: sticker.createdAt, updatedAt: sticker.updatedAt,
    };
  }
}

module.exports = {
  StickerStore,
  MAX_STICKER_BYTES,
  MAX_STICKER_DIMENSION,
  MAX_STICKERS_PER_ACCOUNT,
  MAX_STORAGE_BYTES_PER_ACCOUNT,
  ORPHAN_RETENTION_MS,
};
