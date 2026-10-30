const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  TERMINAL_STATES: TERMINAL,
  transferError,
  transferView: buildTransferView,
} = require('./file-transfer-utils.cjs');
const { normalizeTransferTimeout } = require('./transfer-timeout.cjs');

const PROGRESS_INTERVAL_MS = 250;
const DEFAULT_BLOCK_SIZE = 61440;
const MAX_BLOCK_SIZE = 65535;
function transferView(record) {
  return buildTransferView(record, 'outgoing');
}

class OutgoingFileTransferCoordinator {
  constructor(options = {}) {
    this.records = new Map();
    this.listeners = new Set();
    this.resourceLimiter = options.resourceLimiter;
    this.onCompleted = options.onCompleted;
    this.scheduleTimeout =
      options.scheduleTimeout || ((callback, milliseconds) => setTimeout(callback, milliseconds));
    this.cancelTimeout = options.cancelTimeout || ((timer) => clearTimeout(timer));
    this.scheduleProgressTimeout = options.scheduleProgressTimeout || this.scheduleTimeout;
    this.cancelProgressTimeout = options.cancelProgressTimeout || this.cancelTimeout;
    this.now = options.now || (() => Date.now());
    this.blockSize = Math.max(1, Math.min(options.blockSize ?? DEFAULT_BLOCK_SIZE, MAX_BLOCK_SIZE));
    this.initialSequence = (((options.initialSequence ?? 0) % 65536) + 65536) % 65536;
    this.siTimeout = options.siTimeout ?? 30000;
    this.iqTimeout = options.iqTimeout ?? 30000;
    this.getTimeoutSeconds =
      typeof options.getTimeoutSeconds === 'function' ? options.getTimeoutSeconds : undefined;
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(record) {
    this.listeners.forEach((listener) =>
      listener({
        type: 'file.stateChanged',
        payload: transferView(record),
        targetSenderId: record.ownerSenderId,
      }),
    );
  }

  get(id) {
    const record = this.records.get(id);
    if (!record) throw transferError('UNAUTHORIZED', 'transfer not found');
    return record;
  }

  list(accountId) {
    return [...this.records.values()]
      .filter((record) => record.offer.accountId === accountId && !TERMINAL.has(record.state))
      .map(transferView);
  }

  async inspectSource(filePath) {
    if (typeof filePath !== 'string' || !filePath.trim())
      throw transferError('INVALID_INPUT', 'file path is unavailable');
    const sourcePath = path.resolve(filePath);
    let handle;
    try {
      handle = await fsp.open(sourcePath, 'r');
    } catch {
      throw transferError('STORAGE_FAILED', 'cannot open source file');
    }
    try {
      const stats = await handle.stat({ bigint: true });
      if (!stats.isFile()) throw transferError('INVALID_INPUT', 'source is not a regular file');
      if (stats.size > BigInt(Number.MAX_SAFE_INTEGER))
        throw transferError('INVALID_INPUT', 'source file is too large');
      return { sourcePath, handle, stats };
    } catch (cause) {
      await handle.close().catch(() => undefined);
      if (cause?.code) throw cause;
      throw transferError('STORAGE_FAILED', 'cannot inspect source file');
    }
  }

  async start(input) {
    const source = await this.inspectSource(input.filePath);
    const transferId = input.offer.transferId;
    if (this.records.has(transferId)) {
      await source.handle.close().catch(() => undefined);
      throw transferError('CONFLICT', 'transfer id is already active');
    }
    try {
      this.resourceLimiter?.reserve(transferId, input.offer.accountId, 'outgoing');
    } catch (cause) {
      await source.handle.close().catch(() => undefined);
      throw cause;
    }
    const record = {
      offer: { ...input.offer, sizeBytes: source.stats.size.toString() },
      ownerSenderId: input.ownerSenderId,
      sourcePath: source.sourcePath,
      handle: source.handle,
      sourceStats: source.stats,
      transport: input.transport,
      siSessionId: input.siSessionId,
      direction: 'outgoing',
      state: 'offering',
      bytes: 0n,
      updatedAt: new Date().toISOString(),
      progressTimer: undefined,
      progressTimerToken: undefined,
      progressPending: false,
      progressLastEmittedAt: undefined,
      terminalRequested: false,
      cleanupReady: false,
      timeoutSeconds: this.getTimeoutSeconds
        ? normalizeTransferTimeout(this.getTimeoutSeconds())
        : undefined,
    };
    this.records.set(transferId, record);
    this.emit(record);
    const operation = this.run(record);
    record.operation = operation;
    return operation;
  }

  async run(record) {
    try {
      await this.withTimeout(
        () => record.transport.sendOffer(record),
        this.timeoutMilliseconds(record, this.siTimeout),
        'SI acceptance timed out',
      );
      if (record.terminalRequested) return transferView(record);
      record.state = 'accepted';
      record.updatedAt = new Date().toISOString();
      this.emit(record);
      await this.withTimeout(
        () => record.transport.sendOpen(record, this.blockSize),
        this.timeoutMilliseconds(record, this.iqTimeout),
        'IBB open timed out',
      );
      if (record.terminalRequested) return transferView(record);
      record.state = 'transferring';
      record.updatedAt = new Date().toISOString();
      this.emit(record);
      const buffer = Buffer.allocUnsafe(this.blockSize);
      let sequence = this.initialSequence;
      while (record.bytes < BigInt(record.offer.sizeBytes)) {
        if (record.terminalRequested) return transferView(record);
        const remaining = BigInt(record.offer.sizeBytes) - record.bytes;
        const requested = Math.min(this.blockSize, Number(remaining));
        let read;
        try {
          read = await record.handle.read(buffer, 0, requested, Number(record.bytes));
        } catch {
          throw transferError('STORAGE_FAILED', 'source read failed');
        }
        if (!read || read.bytesRead !== requested)
          throw transferError('STORAGE_FAILED', 'source changed while reading');
        const block = buffer.subarray(0, read.bytesRead);
        await this.withTimeout(
          () => record.transport.sendData(record, block, sequence),
          this.timeoutMilliseconds(record, this.iqTimeout),
          'IBB data acknowledgement timed out',
        );
        if (record.terminalRequested) return transferView(record);
        record.bytes += BigInt(read.bytesRead);
        record.updatedAt = new Date().toISOString();
        this.requestProgress(record);
        sequence = (sequence + 1) % 65536;
      }
      const finalStats = await record.handle.stat({ bigint: true });
      if (
        finalStats.size !== record.sourceStats.size ||
        finalStats.mtimeNs !== record.sourceStats.mtimeNs ||
        finalStats.dev !== record.sourceStats.dev ||
        finalStats.ino !== record.sourceStats.ino
      )
        throw transferError('INTEGRITY_FAILED', 'source changed while sending');
      await this.withTimeout(
        () => record.transport.sendClose(record),
        this.timeoutMilliseconds(record, this.iqTimeout),
        'IBB close acknowledgement timed out',
      );
      if (record.terminalRequested) return transferView(record);
      record.state = 'completed';
      record.terminalRequested = true;
      // El remitente conserva el archivo original; las acciones locales solo
      // se publican para archivos recibidos y guardados por Atomic Chat.
      record.localActions = undefined;
      this.clearProgressTimer(record);
      record.updatedAt = new Date().toISOString();
      this.emit(record);
      return transferView(record);
    } catch (cause) {
      if (!record.terminalRequested) this.markTerminal(record, this.reasonFor(cause), cause);
      return transferView(record);
    } finally {
      await this.cleanup(record);
    }
  }

  reasonFor(cause) {
    if (cause?.code === 'TIMEOUT') return 'timed_out';
    if (cause?.code === 'INTEGRITY_FAILED') return 'integrity_failed';
    if (cause?.code === 'STORAGE_FAILED') return 'storage_failed';
    if (cause?.code === 'UNSUPPORTED_METHOD') return 'unsupported_method';
    if (cause?.code === 'NOT_CONNECTED' || cause?.code === 'RECIPIENT_UNAVAILABLE')
      return 'network_lost';
    if (cause?.code === 'REMOTE_REJECTED') return 'cancelled_by_sender';
    return 'network_lost';
  }

  markTerminal(record, reason, cause) {
    if (TERMINAL.has(record.state)) return false;
    this.clearProgressTimer(record);
    record.terminalRequested = true;
    record.state = reason === 'cancelled_by_sender' ? 'cancelled' : 'failed';
    record.endReason = reason;
    if (record.state === 'failed')
      record.errorCode =
        reason === 'storage_failed' || reason === 'integrity_failed'
          ? 'STORAGE_FAILED'
          : 'TRANSPORT_FAILED';
    record.failureMessage = cause?.message;
    record.updatedAt = new Date().toISOString();
    this.emit(record);
    return true;
  }

  cancel(id) {
    const record = this.get(id);
    if (!TERMINAL.has(record.state)) this.markTerminal(record, 'cancelled_by_sender');
    return record.operation.then(() => transferView(record));
  }

  async cancelAccount(accountId) {
    await Promise.all(
      [...this.records.values()]
        .filter((record) => record.offer.accountId === accountId && !TERMINAL.has(record.state))
        .map((record) => this.cancel(record.offer.transferId)),
    );
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
    record.progressTimer = this.scheduleProgressTimeout(() => {
      if (record.progressTimerToken !== token) return;
      record.progressTimer = undefined;
      record.progressTimerToken = undefined;
      if (!record.progressPending || record.terminalRequested) {
        record.progressPending = false;
        return;
      }
      record.progressPending = false;
      record.progressLastEmittedAt = this.now();
      this.emit(record);
    }, delay);
    record.progressTimer?.unref?.();
  }

  clearProgressTimer(record) {
    if (record.progressTimer !== undefined) this.cancelProgressTimeout(record.progressTimer);
    record.progressTimer = undefined;
    record.progressTimerToken = undefined;
    record.progressPending = false;
  }

  async cleanup(record) {
    this.clearProgressTimer(record);
    try {
      await record.handle?.close();
    } catch {
      /* descriptor cleanup is best effort */
    }
    record.handle = undefined;
    record.cleanupReady = true;
    this.records.delete(record.offer.transferId);
    this.resourceLimiter?.release(record.offer.transferId);
    delete record.operation;
    delete record.transport;
    delete record.sourcePath;
    delete record.sourceStats;
  }

  withTimeout(operation, milliseconds, message) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const timer = this.scheduleTimeout(() => {
        if (settled) return;
        settled = true;
        reject(transferError('TIMEOUT', message));
      }, milliseconds);
      timer?.unref?.();
      Promise.resolve()
        .then(operation)
        .then(
          (value) => {
            if (settled) return;
            settled = true;
            this.cancelTimeout(timer);
            resolve(value);
          },
          (cause) => {
            if (settled) return;
            settled = true;
            this.cancelTimeout(timer);
            reject(cause);
          },
        );
    });
  }

  timeoutMilliseconds(record, fallback) {
    return record.timeoutSeconds ? record.timeoutSeconds * 1000 : fallback;
  }
}

module.exports = { OutgoingFileTransferCoordinator, transferView };
