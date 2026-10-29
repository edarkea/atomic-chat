const fsp = require('node:fs/promises');
const path = require('node:path');
const { transferError } = require('./file-transfer-utils.cjs');

const DEFAULT_MAX_REFERENCES = 256;
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

function localActionError(code, message, reason) {
  const error = transferError(code, message);
  error.reason = reason;
  return error;
}

class FileLocalActionRegistry {
  constructor(options = {}) {
    this.shell = options.shell;
    this.lstat = options.lstat || ((filePath) => fsp.lstat(filePath));
    this.maxReferences = options.maxReferences ?? DEFAULT_MAX_REFERENCES;
    this.references = new Map();
    this.sequence = 0;
  }

  async register(record, direction) {
    if (
      record?.state !== 'completed' ||
      !record.offer?.transferId ||
      !record.offer?.accountId ||
      !Number.isInteger(record.ownerSenderId)
    )
      return false;
    const localPath = direction === 'incoming' ? record.destination : record.sourcePath;
    if (typeof localPath !== 'string' || !localPath.trim()) return false;
    try {
      const sourcePath = path.resolve(localPath);
      const stats = await this.inspect(sourcePath);
      this.references.set(record.offer.transferId, {
        transferId: record.offer.transferId,
        accountId: record.offer.accountId,
        ownerSenderId: record.ownerSenderId,
        direction,
        path: sourcePath,
        metadata: fileMetadata(stats),
        sequence: ++this.sequence,
      });
      this.trim();
      return true;
    } catch {
      return false;
    }
  }

  clearSender(senderId) {
    for (const [transferId, reference] of this.references)
      if (reference.ownerSenderId === senderId) this.references.delete(transferId);
  }

  clearAccount(accountId) {
    for (const [transferId, reference] of this.references)
      if (reference.accountId === accountId) this.references.delete(transferId);
  }

  async open(senderId, input) {
    const reference = await this.resolve(senderId, input);
    this.assertSafeToOpen(reference);
    if (!this.shell || typeof this.shell.openPath !== 'function')
      throw transferError('UNSUPPORTED', 'abrir archivos no está disponible');
    const failure = await this.shell.openPath(reference.path);
    if (failure)
      throw localActionError(
        'STORAGE_FAILED',
        'no fue posible abrir el archivo',
        'shell_open_failed',
      );
  }

  async reveal(senderId, input) {
    const reference = await this.resolve(senderId, input);
    this.assertSafeToOpen(reference);
    if (this.shell && typeof this.shell.showItemInFolder === 'function') {
      try {
        this.shell.showItemInFolder(reference.path);
      } catch {
        throw localActionError(
          'STORAGE_FAILED',
          'no fue posible mostrar el archivo en su carpeta',
          'shell_reveal_failed',
        );
      }
      return;
    }
    if (!this.shell || typeof this.shell.openPath !== 'function')
      throw transferError('UNSUPPORTED', 'abrir carpetas no está disponible');
    const failure = await this.shell.openPath(path.dirname(reference.path));
    if (failure)
      throw localActionError(
        'STORAGE_FAILED',
        'no fue posible abrir la carpeta',
        'shell_reveal_failed',
      );
  }

  async resolve(senderId, input) {
    if (
      !Number.isInteger(senderId) ||
      !input ||
      typeof input.accountId !== 'string' ||
      typeof input.transferId !== 'string'
    )
      throw transferError('INVALID_INPUT', 'la solicitud de archivo no es válida');
    const reference = this.references.get(input.transferId);
    if (
      !reference ||
      reference.accountId !== input.accountId ||
      reference.ownerSenderId !== senderId
    )
      throw transferError('UNAUTHORIZED', 'la transferencia no está autorizada');
    const stats = await this.inspect(reference.path);
    if (!sameMetadata(reference.metadata, fileMetadata(stats)))
      throw localActionError(
        'STORAGE_FAILED',
        'el archivo ya no coincide con la transferencia',
        'metadata_mismatch',
      );
    reference.sequence = ++this.sequence;
    return reference;
  }

  async inspect(filePath) {
    let stats;
    try {
      stats = await this.lstat(filePath);
    } catch {
      throw localActionError(
        'STORAGE_FAILED',
        'el archivo ya no está disponible',
        'file_unavailable',
      );
    }
    if (stats.isSymbolicLink() || !stats.isFile())
      throw localActionError(
        'STORAGE_FAILED',
        'la referencia no es un archivo regular',
        'file_type_invalid',
      );
    return stats;
  }

  assertSafeToOpen(reference) {
    const extension = path.extname(reference.path).toLowerCase();
    if (DANGEROUS_EXTENSIONS.has(extension))
      throw transferError('UNSUPPORTED', 'por seguridad no se puede abrir este tipo de archivo');
  }

  trim() {
    while (this.references.size > this.maxReferences) {
      const oldest = [...this.references.entries()].sort(
        (left, right) => left[1].sequence - right[1].sequence,
      )[0];
      if (!oldest) return;
      this.references.delete(oldest[0]);
    }
  }
}

module.exports = { FileLocalActionRegistry };
