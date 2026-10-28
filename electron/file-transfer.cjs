const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const ACTIVE_PER_ACCOUNT = 2;
const ACTIVE_GLOBAL = 4;
const OFFER_LIMIT = 8;
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

function error(code, message) {
  const result = new Error(message);
  result.code = code;
  return result;
}

function transferView(record) {
  return {
    offer: record.offer,
    direction: 'incoming',
    state: record.state,
    bytesTransferred: record.bytes.toString(),
    ...(record.endReason ? { endReason: record.endReason } : {}),
    ...(record.errorCode ? { errorCode: record.errorCode } : {}),
    updatedAt: record.updatedAt,
  };
}

class FileTransferCoordinator {
  constructor(options = {}) {
    this.root = options.root || path.join(os.tmpdir(), 'atomic-chat-transfers');
    this.records = new Map();
    this.listeners = new Set();
    this.selectDestination = options.selectDestination || (async () => null);
    this.beforePublish = options.beforePublish;
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(record, type = 'file.stateChanged') {
    const payload = type === 'file.offerReceived' ? record.offer : transferView(record);
    this.listeners.forEach((listener) => listener({ type, payload, targetSenderId: record.ownerSenderId }));
  }

  counts(accountId) {
    const values = [...this.records.values()];
    return {
      account: values.filter((record) => record.offer.accountId === accountId && !TERMINAL.has(record.state) && (record.state !== 'offered' || record.accepting)).length,
      global: values.filter((record) => !TERMINAL.has(record.state) && (record.state !== 'offered' || record.accepting)).length,
      offers: values.filter((record) => record.offer.accountId === accountId && record.state === 'offered').length,
    };
  }

  add(input) {
    const counts = this.counts(input.offer.accountId);
    if (counts.account >= ACTIVE_PER_ACCOUNT || counts.global >= ACTIVE_GLOBAL || counts.offers >= OFFER_LIMIT) throw error('RESOURCE_CONSTRAINT', 'transfer capacity exceeded');
    const record = {
      ...input,
      state: 'offered',
      bytes: 0n,
      queue: Promise.resolve(),
      updatedAt: new Date().toISOString(),
      timer: setTimeout(() => { void this.reject(input.offer.transferId, 'timed_out').catch(() => undefined); }, 60000),
    };
    this.records.set(input.offer.transferId, record);
    this.emit(record, 'file.offerReceived');
    return record;
  }

  enqueue(id, operation) {
    const record = this.get(id);
    const task = record.queue.then(() => operation(record));
    record.queue = task.catch(() => undefined);
    return task;
  }

  get(id) {
    const record = this.records.get(id);
    if (!record) throw error('UNAUTHORIZED', 'transfer not found');
    return record;
  }

  list(accountId) {
    return [...this.records.values()].filter((record) => record.offer.accountId === accountId && !TERMINAL.has(record.state)).map(transferView);
  }

  async ensureTemporaryRoot(destinationDirectory) {
    const temporaryRoot = path.join(destinationDirectory, '.atomic-chat-transfers');
    try {
      await fsp.mkdir(temporaryRoot, { mode: 0o700 });
    } catch (cause) {
      if (cause.code !== 'EEXIST') throw error('STORAGE_FAILED', 'cannot prepare private transfer directory');
    }
    let information;
    try {
      information = await fsp.lstat(temporaryRoot);
    } catch {
      throw error('STORAGE_FAILED', 'cannot inspect private transfer directory');
    }
    if (!information.isDirectory() || information.isSymbolicLink()) throw error('STORAGE_FAILED', 'private transfer directory is not trusted');
    if (process.platform !== 'win32' && (information.mode & 0o077) !== 0) throw error('STORAGE_FAILED', 'private transfer directory permissions are too broad');
    return temporaryRoot;
  }

  async cleanupAbandoned(destinationDirectory) {
    const temporaryRoot = path.join(destinationDirectory, '.atomic-chat-transfers');
    let entries;
    try {
      entries = await fsp.readdir(temporaryRoot, { withFileTypes: true });
    } catch (cause) {
      if (cause.code === 'ENOENT') return;
      throw error('STORAGE_FAILED', 'cannot inspect transfer cleanup directory');
    }
    const active = new Set([...this.records.values()].map((record) => record.temporary).filter(Boolean));
    await Promise.all(entries.filter((entry) => entry.name.endsWith('.part')).map(async (entry) => {
      const candidate = path.join(temporaryRoot, entry.name);
      if (!active.has(candidate)) await fsp.rm(candidate, { force: true });
    }));
  }

  markTerminal(record, state, reason) {
    if (TERMINAL.has(record.state)) return false;
    clearTimeout(record.timer);
    record.timer = undefined;
    record.terminalRequested = true;
    record.state = state;
    record.endReason = reason;
    if (state === 'failed') record.errorCode = reason === 'storage_failed' ? 'STORAGE_FAILED' : 'TRANSPORT_FAILED';
    record.updatedAt = new Date().toISOString();
    this.emit(record);
    return true;
  }

  async terminate(id, state, reason) {
    const record = this.get(id);
    if (TERMINAL.has(record.state)) {
      await record.queue;
      return transferView(record);
    }
    this.markTerminal(record, state, reason);
    const cleanup = record.queue.then(() => this.cleanup(record));
    record.queue = cleanup.catch(() => undefined);
    await cleanup;
    return transferView(record);
  }

  async accept(id, ownerSenderId) {
    const record = this.get(id);
    if (record.ownerSenderId !== ownerSenderId || record.state !== 'offered' || record.accepting || record.terminalRequested) throw error('CONFLICT', 'transfer is not available');
    const counts = this.counts(record.offer.accountId);
    if (counts.account >= ACTIVE_PER_ACCOUNT || counts.global >= ACTIVE_GLOBAL) throw error('RESOURCE_CONSTRAINT', 'active transfer capacity exceeded');
    record.accepting = true;
    try {
      const destination = await this.selectDestination(record.offer);
      if (record.terminalRequested || record.state !== 'offered') return transferView(record);
      if (!destination) return this.reject(id, 'user_rejected');
      const destinationPath = path.resolve(String(destination));
      const destinationDirectory = path.dirname(destinationPath);
      await this.cleanupAbandoned(destinationDirectory);
      const temporaryRoot = await this.ensureTemporaryRoot(destinationDirectory);
      if (record.terminalRequested || record.state !== 'offered') return transferView(record);
      const temporary = path.join(temporaryRoot, `${crypto.randomUUID()}.part`);
      const handle = await fsp.open(temporary, 'wx', 0o600);
      if (record.terminalRequested || record.state !== 'offered') {
        await handle.close().catch(() => undefined);
        await fsp.rm(temporary, { force: true }).catch(() => undefined);
        return transferView(record);
      }
      record.destination = destinationPath;
      record.temporary = temporary;
      record.handle = handle;
      clearTimeout(record.timer);
      record.timer = setTimeout(() => { void this.fail(id, 'timed_out').catch(() => undefined); }, 30000);
      record.state = 'accepted';
      record.updatedAt = new Date().toISOString();
      this.emit(record);
      try {
        if (record.onAccepted) await record.onAccepted(record);
      } catch (cause) {
        await this.fail(id, 'network_lost').catch(() => undefined);
        throw cause;
      }
      return transferView(record);
    } catch (cause) {
      if (!TERMINAL.has(record.state) && !record.terminalRequested && !['CONFLICT', 'RESOURCE_CONSTRAINT'].includes(cause?.code)) await this.fail(id, 'storage_failed').catch(() => undefined);
      throw cause;
    } finally {
      record.accepting = false;
    }
  }

  async reject(id, reason = 'user_rejected') {
    const record = this.get(id);
    if (TERMINAL.has(record.state)) return transferView(record);
    const result = await this.terminate(id, 'cancelled', reason);
    try { await record.onRejected?.(reason); } catch { /* terminal state and cleanup are already committed */ }
    return result;
  }

  cancel(id) {
    return this.reject(id, 'cancelled_by_receiver');
  }

  async fail(id, reason = 'storage_failed') {
    return this.terminate(id, 'failed', reason);
  }

  async cleanup(record) {
    try { await record.handle?.close(); } catch { /* cleanup remains best effort */ }
    record.handle = undefined;
    if (record.temporary) await fsp.rm(record.temporary, { force: true }).catch(() => undefined);
  }

  async cancelAccount(accountId) {
    await Promise.all([...this.records.values()].filter((record) => record.offer.accountId === accountId && !TERMINAL.has(record.state)).map((record) => this.reject(record.offer.transferId, 'network_lost')));
  }

  append(id, bytes) {
    return this.enqueue(id, async (record) => {
      try {
        if (record.terminalRequested || TERMINAL.has(record.state)) throw error('CONFLICT', 'transfer is terminal');
        if (!record.handle || !['accepted', 'transferring'].includes(record.state)) throw error('CONFLICT', 'transfer is not writable');
        const next = record.bytes + BigInt(bytes.length);
        if (next > BigInt(record.offer.sizeBytes)) throw error('INVALID_INPUT', 'received bytes exceed offer');
        let offset = 0;
        while (offset < bytes.length) {
          if (record.terminalRequested) throw error('CONFLICT', 'transfer was cancelled');
          const result = await record.handle.write(bytes, offset, bytes.length - offset);
          if (record.terminalRequested) throw error('CONFLICT', 'transfer was cancelled');
          if (!result || result.bytesWritten <= 0 || result.bytesWritten > bytes.length - offset) throw error('STORAGE_FAILED', 'incomplete file write');
          offset += result.bytesWritten;
        }
        if (record.terminalRequested) throw error('CONFLICT', 'transfer was cancelled');
        clearTimeout(record.timer);
        record.timer = setTimeout(() => { void this.fail(id, 'timed_out').catch(() => undefined); }, 60000);
        record.bytes = next;
        record.state = 'transferring';
        record.updatedAt = new Date().toISOString();
        this.emit(record);
        return transferView(record);
      } catch (cause) {
        if (!record.terminalRequested && !TERMINAL.has(record.state) && cause?.code === 'STORAGE_FAILED') await this.failCurrent(record, 'storage_failed');
        throw cause;
      }
    });
  }

  async failCurrent(record, reason) {
    if (!this.markTerminal(record, 'failed', reason)) return;
    await this.cleanup(record);
  }

  complete(id) {
    return this.enqueue(id, async (record) => {
      try {
        if (record.terminalRequested || TERMINAL.has(record.state) || record.state !== 'transferring') throw error('CONFLICT', 'transfer is not ready to close');
        if (!record.handle || record.bytes !== BigInt(record.offer.sizeBytes)) throw error('INVALID_INPUT', 'size mismatch');
        clearTimeout(record.timer);
        record.timer = undefined;
        await record.handle.sync();
        if (record.terminalRequested) throw error('CONFLICT', 'transfer was cancelled');
        await record.handle.close();
        record.handle = undefined;
        if (record.terminalRequested) throw error('CONFLICT', 'transfer was cancelled');
        await this.beforePublish?.(record);
        if (record.terminalRequested) throw error('CONFLICT', 'transfer was cancelled');
        await fsp.link(record.temporary, record.destination);
        await fsp.rm(record.temporary, { force: true });
        record.state = 'completed';
        record.terminalRequested = true;
        record.updatedAt = new Date().toISOString();
        this.emit(record);
        return transferView(record);
      } catch (cause) {
        if (!record.terminalRequested && !TERMINAL.has(record.state)) await this.failCurrent(record, cause?.code === 'INVALID_INPUT' ? 'integrity_failed' : 'storage_failed');
        throw cause;
      }
    });
  }
}

module.exports = { FileTransferCoordinator, transferView };
