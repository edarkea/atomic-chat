const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const {
  inspectStaticImage,
  MAX_PREVIEW_BYTES,
} = require('./preview-image.cjs');

const MEDIA_DIRECTORY_NAME = 'media';
const SAFE_READ_FLAGS =
  process.platform === 'win32'
    ? 'r'
    : fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);

function fileMetadata(stats) {
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

class MediaStore {
  constructor(userDataPath, persistence, nativeImage) {
    this.persistence = persistence;
    this.nativeImage = nativeImage;
    this.directory = path.join(userDataPath, MEDIA_DIRECTORY_NAME);
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    try {
      fs.chmodSync(this.directory, 0o700);
    } catch {
      /* Windows ACLs are managed by the userData directory. */
    }
    this.listeners = new Set();
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async persistTransfer(record, direction) {
    if (record?.state !== 'completed' || !record.offer?.accountId || !record.offer.transferId)
      return null;
    const existing = this.persistence.getMediaByTransfer(
      record.offer.accountId,
      record.offer.transferId,
    );
    if (existing?.availability === 'available' && existing.storageKey) {
      if (await this.storageFileExists(existing.storageKey)) return this.publicRecord(existing);
      this.persistence.updateMediaAvailability(existing.accountId, existing.mediaId, 'missing');
    }
    const sourcePath = direction === 'incoming' ? record.destination : record.sourcePath;
    if (typeof sourcePath !== 'string' || !sourcePath.trim()) return null;
    let inspected;
    try {
      inspected = await this.readAndInspect(sourcePath);
    } catch {
      return null;
    }
    const mediaId = this.mediaId(record.offer.accountId, record.offer.transferId);
    const storageKey = `${mediaId}.bin`;
    const temporaryDirectory = await fsp.mkdtemp(path.join(this.directory, '.tmp-'));
    const temporaryPath = path.join(temporaryDirectory, `${crypto.randomUUID()}.bin`);
    const targetPath = this.storagePath(storageKey);
    try {
      await fsp.writeFile(temporaryPath, inspected.data, { flag: 'wx', mode: 0o600 });
      const temporaryHandle = await fsp.open(temporaryPath, 'r+');
      try {
        await temporaryHandle.sync();
      } finally {
        await temporaryHandle.close().catch(() => undefined);
      }
      await fsp.rename(temporaryPath, targetPath);
      const publicRecord = {
        mediaId,
        transferId: record.offer.transferId,
        accountId: record.offer.accountId,
        conversationId: record.offer.conversationId,
        direction,
        senderJid: record.offer.senderJid,
        originalName: record.offer.name,
        mimeType: inspected.image.mimeType,
        sizeBytes: inspected.image.sizeBytes,
        width: inspected.image.width,
        height: inspected.image.height,
        createdAt: record.offer.offeredAt,
        availability: 'available',
      };
      const saved = this.persistence.upsertMedia(publicRecord, storageKey);
      const result = this.publicRecord(saved || publicRecord);
      this.emit(result, record.ownerSenderId);
      return result;
    } catch {
      await fsp.rm(targetPath, { force: true }).catch(() => undefined);
      return null;
    } finally {
      await fsp.rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  list(accountId, conversationId) {
    if (typeof this.persistence.listMedia !== 'function') return [];
    return this.persistence
      .listMedia(accountId, conversationId)
      .map((record) => this.publicRecord(record));
  }

  async resolveForPreview(senderId, input) {
    if (
      !Number.isInteger(senderId) ||
      typeof input?.mediaId !== 'string' ||
      !input.mediaId.trim() ||
      typeof input.conversationId !== 'string' ||
      !input.conversationId.trim()
    )
      throw this.error('UNAUTHORIZED', 'la referencia multimedia no está autorizada');
    const record = this.persistence.getMedia?.(input.accountId, input.mediaId);
    if (
      !record ||
      record.transferId !== input.transferId ||
      record.conversationId !== input.conversationId ||
      record.availability !== 'available' ||
      typeof record.storageKey !== 'string'
    )
      throw this.error('UNAUTHORIZED', 'la referencia multimedia no está autorizada');
    const storageKey = path.basename(record.storageKey);
    if (storageKey !== record.storageKey || !/^[a-z0-9_-]+\.bin$/i.test(storageKey))
      throw this.error('STORAGE_FAILED', 'el asset multimedia no es válido');
    const filePath = this.storagePath(storageKey);
    let stats;
    try {
      stats = await fsp.lstat(filePath);
    } catch {
      this.persistence.updateMediaAvailability(record.accountId, record.mediaId, 'missing');
      throw this.error('STORAGE_FAILED', 'el asset multimedia no está disponible');
    }
    if (!stats.isFile() || stats.size > MAX_PREVIEW_BYTES)
      throw this.error('STORAGE_FAILED', 'el asset multimedia no es regular');
    return {
      path: filePath,
      metadata: fileMetadata(stats),
      mediaId: record.mediaId,
      conversationId: record.conversationId,
    };
  }

  async reconcile() {
    if (typeof this.persistence.listAllMedia !== 'function') return;
    for (const record of this.persistence.listAllMedia()) {
      if (record.availability !== 'available' || !record.storageKey) continue;
      if (!(await this.storageFileExists(record.storageKey)))
        this.persistence.updateMediaAvailability(record.accountId, record.mediaId, 'missing');
    }
  }

  async readAndInspect(sourcePath) {
    const stats = await fsp.lstat(sourcePath);
    if (stats.isSymbolicLink() || !stats.isFile() || stats.size > MAX_PREVIEW_BYTES)
      throw this.error('MEDIA_SIZE_EXCEEDED', 'el archivo multimedia no cumple los límites');
    const resolvedPath = await fsp.realpath(sourcePath);
    const handle = await fsp.open(resolvedPath, SAFE_READ_FLAGS);
    try {
      const openedStats = await handle.stat();
      if (!sameMetadata(fileMetadata(stats), fileMetadata(openedStats)))
        throw this.error('STORAGE_FAILED', 'el archivo multimedia cambió');
      const data = await handle.readFile();
      const finalStats = await handle.stat();
      if (
        !sameMetadata(fileMetadata(openedStats), fileMetadata(finalStats)) ||
        data.length !== Number(finalStats.size) ||
        data.length > MAX_PREVIEW_BYTES
      )
        throw this.error('STORAGE_FAILED', 'el archivo multimedia cambió durante la lectura');
      const image = inspectStaticImage(data, this.nativeImage);
      return { data, image };
    } finally {
      await handle.close().catch(() => undefined);
    }
  }

  async storageFileExists(storageKey) {
    try {
      const stats = await fsp.lstat(this.storagePath(storageKey));
      return stats.isFile() && stats.size <= MAX_PREVIEW_BYTES;
    } catch {
      return false;
    }
  }

  storagePath(storageKey) {
    return path.join(this.directory, path.basename(storageKey));
  }

  mediaId(accountId, transferId) {
    return `media_${crypto.createHash('sha256').update(`${accountId}\0${transferId}`).digest('hex')}`;
  }

  publicRecord(record) {
    if (!record) return null;
    const { storageKey: _storageKey, ...publicValue } = record;
    return publicValue;
  }

  emit(record, targetSenderId) {
    this.listeners.forEach((listener) =>
      listener({ type: 'media.available', payload: record, targetSenderId }),
    );
  }

  error(code, message) {
    const error = new Error(message);
    error.code = code;
    return error;
  }
}

module.exports = { MediaStore };
