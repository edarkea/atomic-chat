const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  TERMINAL_STATES: TERMINAL,
  transferError,
  transferView: buildTransferView,
} = require('./file-transfer-utils.cjs');
const { normalizeTransferTimeout } = require('./transfer-timeout.cjs');
const error = transferError;

const ACTIVE_PER_ACCOUNT = 2;
const ACTIVE_GLOBAL = 4;
const OFFER_LIMIT = 8;
const PROGRESS_INTERVAL_MS = 250;
function transferView(record) {
  return buildTransferView(record, 'incoming');
}

class FileTransferCoordinator {
  constructor(options = {}) {
    this.root = options.root || path.join(os.tmpdir(), 'atomic-chat-transfers');
    this.instanceId = crypto.randomUUID();
    this.records = new Map();
    this.ownedTemporaries = new Set();
    this.listeners = new Set();
    this.selectDestination = options.selectDestination || (async () => null);
    this.getDefaultDirectory =
      typeof options.getDefaultDirectory === 'function' ? options.getDefaultDirectory : undefined;
    this.selectDefaultDestination =
      typeof options.selectDefaultDestination === 'function'
        ? options.selectDefaultDestination
        : undefined;
    this.beforePublish = options.beforePublish;
    this.publish =
      options.publish || ((temporary, destination) => fsp.link(temporary, destination));
    this.removeTemporary =
      options.removeTemporary || ((record) => this.removeTemporaryFiles(record));
    this.scheduleTimeout =
      options.scheduleTimeout || ((callback, milliseconds) => setTimeout(callback, milliseconds));
    this.cancelTimeout = options.cancelTimeout || ((timer) => clearTimeout(timer));
    this.now = options.now || (() => Date.now());
    this.cleanupRetryLimit = options.cleanupRetryLimit ?? 3;
    this.cleanupRetryDelay = options.cleanupRetryDelay ?? 1000;
    this.unrefCleanupTimers = options.unrefCleanupTimers ?? true;
    this.cleanupJobs = new Map();
    this.resourceLimiter = options.resourceLimiter;
    this.onCompleted = options.onCompleted;
    this.getTimeoutSeconds =
      typeof options.getTimeoutSeconds === 'function' ? options.getTimeoutSeconds : undefined;
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(record, type = 'file.stateChanged') {
    const payload = type === 'file.offerReceived' ? record.offer : transferView(record);
    this.listeners.forEach((listener) =>
      listener({ type, payload, targetSenderId: record.ownerSenderId }),
    );
  }

  counts(accountId) {
    const values = [...this.records.values()];
    return {
      account: values.filter(
        (record) =>
          record.offer.accountId === accountId &&
          !TERMINAL.has(record.state) &&
          (record.state !== 'offered' || record.accepting),
      ).length,
      global: values.filter(
        (record) => !TERMINAL.has(record.state) && (record.state !== 'offered' || record.accepting),
      ).length,
      offers: values.filter(
        (record) => record.offer.accountId === accountId && record.state === 'offered',
      ).length,
    };
  }

  add(input) {
    const counts = this.counts(input.offer.accountId);
    if (counts.offers >= OFFER_LIMIT)
      throw error('RESOURCE_CONSTRAINT', 'pending offer capacity exceeded');
    const record = {
      ...input,
      state: 'offered',
      bytes: 0n,
      queue: Promise.resolve(),
      updatedAt: new Date().toISOString(),
      timer: undefined,
      progressTimer: undefined,
      progressTimerToken: undefined,
      progressPending: false,
      progressLastEmittedAt: undefined,
      terminalResponsePending: 0,
      cleanupReady: false,
      timeoutSeconds: this.getTimeoutSeconds
        ? normalizeTransferTimeout(this.getTimeoutSeconds())
        : undefined,
    };
    this.records.set(input.offer.transferId, record);
    this.armTimer(
      record,
      'offer',
      this.timeoutMilliseconds(record, 60000),
      'timed_out',
      'cancelled',
    );
    this.emit(record, 'file.offerReceived');
    return record;
  }

  enqueue(id, operation) {
    let record;
    try {
      record = this.get(id);
    } catch (cause) {
      return Promise.reject(cause);
    }
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
    return [...this.records.values()]
      .filter((record) => record.offer.accountId === accountId && !TERMINAL.has(record.state))
      .map(transferView);
  }

  async ensureTemporaryRoot(destinationDirectory) {
    const temporaryRoot = path.join(destinationDirectory, '.atomic-chat-transfers');
    try {
      await fsp.mkdir(temporaryRoot, { mode: 0o700 });
    } catch (cause) {
      if (cause.code !== 'EEXIST')
        throw error('STORAGE_FAILED', 'cannot prepare private transfer directory');
    }
    let information;
    try {
      information = await fsp.lstat(temporaryRoot);
    } catch {
      throw error('STORAGE_FAILED', 'cannot inspect private transfer directory');
    }
    if (!information.isDirectory() || information.isSymbolicLink())
      throw error('STORAGE_FAILED', 'private transfer directory is not trusted');
    if (process.platform !== 'win32' && (information.mode & 0o077) !== 0)
      throw error('STORAGE_FAILED', 'private transfer directory permissions are too broad');
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
      throw error('STORAGE_FAILED', 'cannot inspect transfer cleanup directory');
    }
    if (!rootInformation.isDirectory() || rootInformation.isSymbolicLink())
      throw error('STORAGE_FAILED', 'private transfer directory is not trusted');
    let entries;
    try {
      entries = await fsp.readdir(temporaryRoot, { withFileTypes: true });
    } catch (cause) {
      if (cause.code === 'ENOENT') return;
      throw error('STORAGE_FAILED', 'cannot inspect transfer cleanup directory');
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

  markTerminal(record, state, reason) {
    if (TERMINAL.has(record.state)) return false;
    this.clearTimer(record);
    this.clearProgressTimer(record);
    record.terminalRequested = true;
    record.state = state;
    record.endReason = reason;
    if (state === 'failed')
      record.errorCode = reason === 'storage_failed' ? 'STORAGE_FAILED' : 'TRANSPORT_FAILED';
    record.updatedAt = new Date().toISOString();
    this.emit(record);
    return true;
  }

  async terminate(id, state, reason) {
    const record = this.get(id);
    if (record.publicationState === 'publishing') {
      await record.queue;
      record.cleanupReady = true;
      return transferView(record);
    }
    if (TERMINAL.has(record.state)) {
      await record.queue;
      record.cleanupReady = true;
      return transferView(record);
    }
    this.markTerminal(record, state, reason);
    const cleanup = record.queue.then(() => this.cleanup(record));
    record.queue = cleanup.catch(() => undefined);
    await cleanup;
    record.cleanupReady = true;
    return transferView(record);
  }

  async accept(id, ownerSenderId) {
    const record = this.get(id);
    if (
      record.ownerSenderId !== ownerSenderId ||
      record.state !== 'offered' ||
      record.accepting ||
      record.terminalRequested
    )
      throw error('CONFLICT', 'transfer is not available');
    if (this.resourceLimiter)
      this.resourceLimiter.reserve(record.offer.transferId, record.offer.accountId, 'incoming');
    else {
      const counts = this.counts(record.offer.accountId);
      if (counts.account >= ACTIVE_PER_ACCOUNT || counts.global >= ACTIVE_GLOBAL)
        throw error('RESOURCE_CONSTRAINT', 'active transfer capacity exceeded');
    }
    record.accepting = true;
    try {
      const defaultDirectory = this.getDefaultDirectory?.();
      const destination =
        defaultDirectory && this.selectDefaultDestination
          ? await this.selectDefaultDestination(defaultDirectory, record.offer)
          : await this.selectDestination(record.offer);
      if (record.terminalRequested || record.state !== 'offered') return transferView(record);
      if (!destination) return this.reject(id, 'user_rejected');
      const destinationPath = path.resolve(String(destination));
      const destinationDirectory = path.dirname(destinationPath);
      const temporaryRoot = await this.ensureTemporaryRoot(destinationDirectory);
      await this.cleanupAbandoned(temporaryRoot);
      if (record.terminalRequested || record.state !== 'offered') return transferView(record);
      const temporary = path.join(
        temporaryRoot,
        `atomic-${process.pid}-${this.instanceId}-${crypto.randomUUID()}.part`,
      );
      const handle = await fsp.open(temporary, 'wx', 0o600);
      if (record.terminalRequested || record.state !== 'offered') {
        await handle.close().catch(() => undefined);
        await fsp.rm(temporary, { force: true }).catch(() => undefined);
        return transferView(record);
      }
      const ownerMarker = `${temporary}.owner`;
      try {
        await fsp.writeFile(
          ownerMarker,
          JSON.stringify({
            file: path.basename(temporary),
            pid: process.pid,
            instanceId: this.instanceId,
          }),
          { flag: 'wx', mode: 0o600 },
        );
      } catch (cause) {
        await handle.close().catch(() => undefined);
        await fsp.rm(temporary, { force: true }).catch(() => undefined);
        throw cause;
      }
      record.destination = destinationPath;
      record.temporary = temporary;
      record.ownerMarker = ownerMarker;
      this.ownedTemporaries.add(temporary);
      record.handle = handle;
      record.state = 'accepted';
      this.armTimer(record, 'open', 30000, 'timed_out', 'failed');
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
      if (
        !TERMINAL.has(record.state) &&
        !record.terminalRequested &&
        !['CONFLICT', 'RESOURCE_CONSTRAINT'].includes(cause?.code)
      )
        await this.fail(id, 'storage_failed').catch(() => undefined);
      throw cause;
    } finally {
      record.accepting = false;
    }
  }

  async reject(id, reason = 'user_rejected') {
    const record = this.get(id);
    if (TERMINAL.has(record.state)) return transferView(record);
    const onRejected = record.onRejected;
    if (onRejected) record.terminalResponsePending += 1;
    const result = await this.terminate(id, 'cancelled', reason);
    try {
      await onRejected?.(reason);
    } catch {
      /* terminal state and cleanup are already committed */
    } finally {
      if (onRejected) record.terminalResponsePending -= 1;
      this.releaseTerminalRecord(record);
    }
    return result;
  }

  cancel(id) {
    return this.reject(id, 'cancelled_by_receiver');
  }

  async fail(id, reason = 'storage_failed') {
    const result = await this.terminate(id, 'failed', reason);
    this.releaseTerminalRecord(this.records.get(id));
    return result;
  }

  async cleanup(record) {
    try {
      await record.handle?.close();
    } catch {
      /* cleanup remains best effort */
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

  clearTimer(record) {
    if (record.timer !== undefined) this.cancelTimeout(record.timer);
    record.timer = undefined;
    record.timerPhase = undefined;
    record.timerToken = undefined;
  }

  clearProgressTimer(record) {
    if (record.progressTimer !== undefined) this.cancelTimeout(record.progressTimer);
    record.progressTimer = undefined;
    record.progressTimerToken = undefined;
    record.progressPending = false;
  }

  requestProgress(record) {
    record.progressPending = true;
    if (record.progressTimer !== undefined) return;
    const elapsed =
      record.progressLastEmittedAt === undefined
        ? 0
        : Math.max(0, this.now() - record.progressLastEmittedAt);
    const delay = Math.max(0, PROGRESS_INTERVAL_MS - elapsed);
    const token = Symbol('progress');
    record.progressTimerToken = token;
    record.progressTimer = this.scheduleTimeout(() => {
      if (record.progressTimerToken !== token) return;
      record.progressTimer = undefined;
      record.progressTimerToken = undefined;
      if (!record.progressPending || record.terminalRequested || TERMINAL.has(record.state)) {
        record.progressPending = false;
        return;
      }
      record.progressPending = false;
      record.progressLastEmittedAt = this.now();
      this.emit(record);
    }, delay);
    record.progressTimer?.unref?.();
  }

  armTimer(record, phase, milliseconds, reason, terminalState) {
    this.clearTimer(record);
    const token = Symbol(phase);
    record.timerPhase = phase;
    record.timer = this.scheduleTimeout(() => {
      if (record.timerToken !== token || TERMINAL.has(record.state)) return;
      record.timer = undefined;
      record.timerPhase = undefined;
      record.timerToken = undefined;
      void (
        terminalState === 'cancelled'
          ? this.reject(record.offer.transferId, reason)
          : this.fail(record.offer.transferId, reason)
      ).catch(() => undefined);
    }, milliseconds);
    record.timerToken = token;
    record.timer?.unref?.();
  }

  timeoutMilliseconds(record, fallback) {
    return record.timeoutSeconds ? record.timeoutSeconds * 1000 : fallback;
  }

  async cancelAccount(accountId) {
    await Promise.all(
      [...this.records.values()]
        .filter((record) => record.offer.accountId === accountId && !TERMINAL.has(record.state))
        .map((record) => this.reject(record.offer.transferId, 'network_lost')),
    );
  }

  append(id, bytes) {
    return this.enqueue(id, async (record) => {
      try {
        if (record.terminalRequested || TERMINAL.has(record.state))
          throw error('CONFLICT', 'transfer is terminal');
        if (!record.handle || !['accepted', 'transferring'].includes(record.state))
          throw error('CONFLICT', 'transfer is not writable');
        const next = record.bytes + BigInt(bytes.length);
        if (next > BigInt(record.offer.sizeBytes))
          throw error('INVALID_INPUT', 'received bytes exceed offer');
        let offset = 0;
        while (offset < bytes.length) {
          if (record.terminalRequested) throw error('CONFLICT', 'transfer was cancelled');
          const result = await record.handle.write(bytes, offset, bytes.length - offset);
          if (record.terminalRequested) throw error('CONFLICT', 'transfer was cancelled');
          if (!result || result.bytesWritten <= 0 || result.bytesWritten > bytes.length - offset)
            throw error('STORAGE_FAILED', 'incomplete file write');
          offset += result.bytesWritten;
        }
        if (record.terminalRequested) throw error('CONFLICT', 'transfer was cancelled');
        record.bytes = next;
        record.state = 'transferring';
        this.armTimer(
          record,
          'close',
          this.timeoutMilliseconds(record, 30000),
          'timed_out',
          'failed',
        );
        if (next < BigInt(record.offer.sizeBytes))
          this.armTimer(
            record,
            'idle',
            this.timeoutMilliseconds(record, 60000),
            'timed_out',
            'failed',
          );
        record.updatedAt = new Date().toISOString();
        this.requestProgress(record);
        return transferView(record);
      } catch (cause) {
        if (
          !record.terminalRequested &&
          !TERMINAL.has(record.state) &&
          cause?.code === 'STORAGE_FAILED'
        )
          await this.failCurrent(record, 'storage_failed');
        throw cause;
      }
    });
  }

  async failCurrent(record, reason) {
    if (!this.markTerminal(record, 'failed', reason)) return;
    await this.cleanup(record);
    record.cleanupReady = true;
    this.releaseTerminalRecord(record);
  }

  complete(id) {
    return this.enqueue(id, async (record) => {
      try {
        if (
          record.terminalRequested ||
          TERMINAL.has(record.state) ||
          record.state !== 'transferring'
        )
          throw error('CONFLICT', 'transfer is not ready to close');
        if (!record.handle || record.bytes !== BigInt(record.offer.sizeBytes))
          throw error('INVALID_INPUT', 'size mismatch');
        this.clearTimer(record);
        await record.handle.sync();
        if (record.terminalRequested) throw error('CONFLICT', 'transfer was cancelled');
        await record.handle.close();
        record.handle = undefined;
        if (record.terminalRequested) throw error('CONFLICT', 'transfer was cancelled');
        await this.beforePublish?.(record);
        if (record.terminalRequested) throw error('CONFLICT', 'transfer was cancelled');
        record.publicationState = 'publishing';
        await this.publish(record.temporary, record.destination);
        record.publicationState = 'published';
        record.state = 'completed';
        record.terminalRequested = true;
        try {
          if (await this.onCompleted?.(record, 'incoming'))
            record.localActions = { open: true, reveal: true };
        } catch {
          record.localActions = undefined;
        }
        this.clearProgressTimer(record);
        record.updatedAt = new Date().toISOString();
        this.emit(record);
        await this.requestTemporaryCleanup(record);
        record.cleanupReady = true;
        const result = transferView(record);
        this.releaseTerminalRecord(record);
        return result;
      } catch (cause) {
        if (record.publicationState === 'publishing') record.publicationState = undefined;
        if (!record.publicationState && !record.terminalRequested && !TERMINAL.has(record.state))
          await this.failCurrent(
            record,
            cause?.code === 'INVALID_INPUT' ? 'integrity_failed' : 'storage_failed',
          );
        throw cause;
      }
    });
  }

  open(id) {
    return this.enqueue(id, async (record) => {
      if (record.terminalRequested || record.state !== 'accepted')
        throw error('CONFLICT', 'transfer is not accepted');
      record.state = 'transferring';
      this.armTimer(record, 'idle', this.timeoutMilliseconds(record, 60000), 'timed_out', 'failed');
      if (record.bytes === BigInt(record.offer.sizeBytes))
        this.armTimer(
          record,
          'close',
          this.timeoutMilliseconds(record, 30000),
          'timed_out',
          'failed',
        );
      record.updatedAt = new Date().toISOString();
      this.emit(record);
      return transferView(record);
    });
  }

  releaseTerminalRecord(record) {
    if (
      !record ||
      !record.offer ||
      !TERMINAL.has(record.state) ||
      !record.cleanupReady ||
      record.terminalResponsePending > 0
    )
      return;
    if (this.records.get(record.offer.transferId) === record)
      this.records.delete(record.offer.transferId);
    this.clearTimer(record);
    this.clearProgressTimer(record);
    record.handle = undefined;
    record.queue = Promise.resolve();
    record.accepting = false;
    record.iq = undefined;
    record.session = undefined;
    record.onAccepted = undefined;
    record.onRejected = undefined;
    record.destination = undefined;
    record.publicationState = undefined;
    if (!record.cleanupPending) {
      record.temporary = undefined;
      record.ownerMarker = undefined;
    }
    this.resourceLimiter?.release(record.offer.transferId);
  }
}

module.exports = { FileTransferCoordinator, transferView };
