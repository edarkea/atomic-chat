const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');

const DANGEROUS_EXTENSIONS = new Set([
  '.app',
  '.appimage',
  '.bat',
  '.cmd',
  '.com',
  '.exe',
  '.msi',
  '.ps1',
  '.scr',
  '.sh',
]);

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
  return ['dev', 'ino', 'size', 'mtimeMs', 'birthtimeMs'].every(
    (key) => left[key] === right[key],
  );
}

function fileError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

class FileHistoryStore {
  constructor(persistence, shell, options = {}) {
    this.persistence = persistence;
    this.shell = shell;
    this.lstat = options.lstat || ((filePath) => fsp.lstat(filePath, { bigint: true }));
    this.persistLocks = new Map();
  }

  persistTransfer(record, direction) {
    if (record?.state !== 'completed' || !record.offer?.accountId || !record.offer.transferId)
      return Promise.resolve(null);
    const lockKey = `${record.offer.accountId}\0${record.offer.transferId}`;
    const previous = this.persistLocks.get(lockKey) || Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(() => this.persistTransferLocked(record, direction));
    const tracked = operation.finally(() => {
      if (this.persistLocks.get(lockKey) === tracked) this.persistLocks.delete(lockKey);
    });
    this.persistLocks.set(lockKey, tracked);
    return tracked;
  }

  async persistTransferLocked(record, direction) {
    const sourcePath = direction === 'incoming' ? record.destination : record.sourcePath;
    if (typeof sourcePath !== 'string' || !sourcePath.trim()) return null;
    let inspected;
    try {
      inspected = await this.inspectPath(sourcePath);
      const fileId = this.fileId(record.offer.accountId, record.offer.transferId);
      const saved = this.persistence.upsertFileAsset({
        fileId,
        accountId: record.offer.accountId,
        conversationId: record.offer.conversationId,
        transferId: record.offer.transferId,
        direction,
        senderJid: record.offer.senderJid,
        originalName: record.offer.name,
        sizeBytes: inspected.metadata.size,
        ...(record.offer.mimeType ? { mimeType: record.offer.mimeType } : {}),
        localPath: path.resolve(sourcePath),
        createdAt: record.updatedAt || record.offer.offeredAt,
        availability: 'available',
        metadata: inspected.metadata,
      });
      return this.publicRecord(saved);
    } catch {
      return null;
    }
  }

  async refreshTimeline(items) {
    return Promise.all(
      items.map(async (item) => {
        if (item.kind !== 'file') return item;
        const refreshed = await this.refreshFile(item.file.accountId, item.file.fileId);
        return refreshed
          ? { ...item, file: refreshed }
          : { ...item, file: { ...item.file, availability: 'missing' } };
      }),
    );
  }

  async refreshFile(accountId, fileId) {
    const record = this.persistence.getFileAsset(accountId, fileId);
    if (!record) return null;
    let availability = 'missing';
    try {
      const current = await this.inspectPath(record.localPath);
      availability = sameMetadata(
        this.metadataFromRecord(record),
        current.metadata,
      )
        ? 'available'
        : 'changed';
    } catch (error) {
      availability = error?.code === 'FILE_TYPE_INVALID' ? 'blocked' : 'missing';
    }
    if (record.availability !== availability)
      this.persistence.updateFileAssetAvailability(accountId, fileId, availability);
    return this.publicRecord({ ...record, availability });
  }

  async open(accountId, conversationId, fileId, isAuthorized) {
    const record = await this.resolve(accountId, conversationId, fileId);
    this.assertSafeToOpen(record);
    await this.revalidateBeforeAction(record);
    this.assertAuthorized(isAuthorized);
    if (!this.shell || typeof this.shell.openPath !== 'function')
      throw fileError('UNSUPPORTED', 'abrir archivos no está disponible');
    const failure = await this.shell.openPath(record.localPath);
    if (failure) throw fileError('STORAGE_FAILED', 'no fue posible abrir el archivo');
  }

  async reveal(accountId, conversationId, fileId, isAuthorized) {
    const record = await this.resolve(accountId, conversationId, fileId);
    this.assertSafeToOpen(record);
    await this.revalidateBeforeAction(record);
    this.assertAuthorized(isAuthorized);
    if (this.shell && typeof this.shell.showItemInFolder === 'function') {
      try {
        this.shell.showItemInFolder(record.localPath);
      } catch {
        throw fileError('STORAGE_FAILED', 'no fue posible mostrar el archivo en su carpeta');
      }
      return;
    }
    if (!this.shell || typeof this.shell.openPath !== 'function')
      throw fileError('UNSUPPORTED', 'abrir carpetas no está disponible');
    const failure = await this.shell.openPath(path.dirname(record.localPath));
    if (failure) throw fileError('STORAGE_FAILED', 'no fue posible abrir la carpeta');
  }

  async resolve(accountId, conversationId, fileId) {
    if (
      typeof accountId !== 'string' ||
      !accountId.trim() ||
      typeof conversationId !== 'string' ||
      !conversationId.trim() ||
      typeof fileId !== 'string' ||
      !fileId.trim()
    )
      throw fileError('INVALID_INPUT', 'la referencia histórica no es válida');
    const record = this.persistence.getFileAsset(accountId, fileId);
    if (!record || record.conversationId !== conversationId)
      throw fileError('UNAUTHORIZED', 'el archivo histórico no está autorizado');
    const refreshed = await this.refreshFile(accountId, fileId);
    if (!refreshed || refreshed.availability !== 'available')
      throw fileError('STORAGE_FAILED', 'el archivo histórico ya no está disponible');
    return { ...record, availability: 'available' };
  }

  async inspectPath(filePath) {
    const resolvedPath = path.resolve(filePath);
    let stats;
    try {
      stats = await this.lstat(resolvedPath);
    } catch {
      throw fileError('FILE_UNAVAILABLE', 'el archivo histórico ya no está disponible');
    }
    if (stats.isSymbolicLink() || !stats.isFile())
      throw fileError('FILE_TYPE_INVALID', 'la referencia histórica no es un archivo regular');
    return { path: resolvedPath, metadata: metadata(stats) };
  }

  async revalidateBeforeAction(record) {
    try {
      const current = await this.inspectPath(record.localPath);
      if (!sameMetadata(this.metadataFromRecord(record), current.metadata))
        throw fileError('STORAGE_FAILED', 'el archivo histórico cambió');
    } catch (error) {
      if (error?.code === 'FILE_TYPE_INVALID')
        throw fileError('STORAGE_FAILED', 'el archivo histórico ya no es regular');
      if (error?.code === 'FILE_UNAVAILABLE')
        throw fileError('STORAGE_FAILED', 'el archivo histórico ya no está disponible');
      throw error;
    }
  }

  assertAuthorized(isAuthorized) {
    if (typeof isAuthorized === 'function' && !isAuthorized())
      throw fileError('UNAUTHORIZED', 'la ventana o la cuenta ya no están autorizadas');
  }

  assertSafeToOpen(record) {
    const extensions = [path.extname(record.localPath), path.extname(record.originalName)]
      .map((extension) => extension.toLowerCase());
    if (extensions.some((extension) => DANGEROUS_EXTENSIONS.has(extension)))
      throw fileError('UNSUPPORTED', 'por seguridad no se puede abrir este tipo de archivo');
  }

  metadataFromRecord(record) {
    return {
      dev: record.metadataDev,
      ino: record.metadataIno,
      size: record.metadataSize,
      mtimeMs: record.metadataMtimeMs,
      birthtimeMs: record.metadataBirthtimeMs,
    };
  }

  fileId(accountId, transferId) {
    return `file_${crypto.createHash('sha256').update(`${accountId}\0${transferId}`).digest('hex')}`;
  }

  publicRecord(record) {
    if (!record) return null;
    return {
      fileId: record.fileId,
      accountId: record.accountId,
      conversationId: record.conversationId,
      transferId: record.transferId,
      direction: record.direction,
      senderJid: record.senderJid,
      originalName: record.originalName,
      sizeBytes: record.sizeBytes,
      ...(record.mimeType ? { mimeType: record.mimeType } : {}),
      createdAt: record.createdAt,
      availability: record.availability,
    };
  }
}

module.exports = { FileHistoryStore };
