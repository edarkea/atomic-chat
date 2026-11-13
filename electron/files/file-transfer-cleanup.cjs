const fsp = require('node:fs/promises');
const path = require('node:path');

const { transferError } = require('./file-transfer-utils.cjs');

class FileTransferCleanup {
  constructor(options = {}) {
    this.records = options.records || new Map();
    this.ownedTemporaries = options.ownedTemporaries || new Set();
    this.removeTemporary =
      options.removeTemporary || ((record) => this.removeTemporaryFiles(record));
    this.scheduleTimeout =
      options.scheduleTimeout || ((callback, milliseconds) => setTimeout(callback, milliseconds));
    this.cancelTimeout = options.cancelTimeout || ((timer) => clearTimeout(timer));
    this.cleanupRetryLimit = options.cleanupRetryLimit ?? 3;
    this.cleanupRetryDelay = options.cleanupRetryDelay ?? 1000;
    this.unrefCleanupTimers = options.unrefCleanupTimers ?? true;
    this.cleanupJobs = new Map();
  }

  async ensureTemporaryRoot(destinationDirectory) {
    const temporaryRoot = path.join(destinationDirectory, '.atomic-chat-transfers');
    try {
      await fsp.mkdir(temporaryRoot, { mode: 0o700 });
    } catch (cause) {
      if (cause.code !== 'EEXIST')
        throw transferError('STORAGE_FAILED', 'cannot prepare private transfer directory');
    }
    let information;
    try {
      information = await fsp.lstat(temporaryRoot);
    } catch {
      throw transferError('STORAGE_FAILED', 'cannot inspect private transfer directory');
    }
    if (!information.isDirectory() || information.isSymbolicLink())
      throw transferError('STORAGE_FAILED', 'private transfer directory is not trusted');
    if (process.platform !== 'win32' && (information.mode & 0o077) !== 0)
      throw transferError('STORAGE_FAILED', 'private transfer directory permissions are too broad');
    return temporaryRoot;
  }

  async processExists(pid) {
    try {
      process.kill(pid, 0);
      return true;
    } catch (cause) {
      return cause.code === 'EPERM';
    }
  }

  async cleanupAbandoned(temporaryRoot) {
    let rootInformation;
    try {
      rootInformation = await fsp.lstat(temporaryRoot);
    } catch (cause) {
      if (cause.code === 'ENOENT') return;
      throw transferError('STORAGE_FAILED', 'cannot inspect transfer cleanup directory');
    }
    if (!rootInformation.isDirectory() || rootInformation.isSymbolicLink())
      throw transferError('STORAGE_FAILED', 'private transfer directory is not trusted');
    let entries;
    try {
      entries = await fsp.readdir(temporaryRoot, { withFileTypes: true });
    } catch (cause) {
      if (cause.code === 'ENOENT') return;
      throw transferError('STORAGE_FAILED', 'cannot inspect transfer cleanup directory');
    }
    const active = new Set(
      [...this.ownedTemporaries, ...this.records.values()]
        .map((record) => (typeof record === 'string' ? record : record.temporary))
        .filter(Boolean),
    );
    await Promise.all(
      entries
        .filter((entry) => entry.name.endsWith('.part') && entry.name.startsWith('atomic-'))
        .map(async (entry) => {
          const candidate = path.join(temporaryRoot, entry.name);
          if (active.has(candidate)) return;
          const marker = `${candidate}.owner`;
          try {
            const [partInformation, markerInformation, metadata] = await Promise.all([
              fsp.lstat(candidate),
              fsp.lstat(marker),
              fsp.readFile(marker, 'utf8'),
            ]);
            if (
              !partInformation.isFile() ||
              partInformation.isSymbolicLink() ||
              !markerInformation.isFile() ||
              markerInformation.isSymbolicLink()
            )
              return;
            const owner = JSON.parse(metadata);
            if (
              owner.file !== entry.name ||
              !Number.isInteger(owner.pid) ||
              (await this.processExists(owner.pid))
            )
              return;
            const latestRootInformation = await fsp.lstat(temporaryRoot);
            if (
              !latestRootInformation.isDirectory() ||
              latestRootInformation.isSymbolicLink() ||
              latestRootInformation.dev !== rootInformation.dev ||
              latestRootInformation.ino !== rootInformation.ino
            )
              return;
            await fsp.rm(candidate, { force: true });
            await fsp.rm(marker, { force: true });
          } catch {
            // Unknown, malformed, active, or racing files are preserved fail-closed.
          }
        }),
    );
  }

  async cleanup(record) {
    try {
      await record.handle?.close();
    } catch {
      // cleanup remains best effort
    }
    record.handle = undefined;
    await this.requestTemporaryCleanup(record);
  }

  async removeTemporaryFiles(record) {
    const failures = [];
    for (const candidate of [record.temporary, record.ownerMarker]) {
      if (!candidate) continue;
      try {
        await fsp.rm(candidate, { force: true });
      } catch (cause) {
        failures.push(cause);
      }
    }
    if (failures.length) throw failures[0];
  }

  async requestTemporaryCleanup(record, attempt = 0) {
    if (!record.temporary) return;
    try {
      await this.removeTemporary(record);
      this.ownedTemporaries.delete(record.temporary);
      record.cleanupPending = false;
    } catch {
      record.cleanupPending = true;
      this.scheduleCleanupRetry(record, attempt + 1);
    }
  }

  scheduleCleanupRetry(record, attempt) {
    const temporary = record.temporary;
    if (!temporary || attempt > this.cleanupRetryLimit || this.cleanupJobs.has(temporary)) return;
    const timer = this.scheduleTimeout(() => {
      this.cleanupJobs.delete(temporary);
      void this.requestTemporaryCleanup(record, attempt).catch(() => undefined);
    }, this.cleanupRetryDelay);
    if (this.unrefCleanupTimers) timer?.unref?.();
    this.cleanupJobs.set(temporary, timer);
  }
}

module.exports = { FileTransferCleanup };
