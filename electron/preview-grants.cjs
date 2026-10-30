const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const { inspectStaticImage, PREVIEW_CHUNK_SIZE, previewError } = require('./preview-image.cjs');

const TTL_MS = 5 * 60 * 1000;
const MAX_GRANTS_PER_SENDER = 8;
const MAX_GRANTS = 32;
const MAX_REQUESTS = 128;

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

function failureState(code) {
  if (code === 'MEDIA_TYPE_UNSUPPORTED') return 'unsupported';
  if (code === 'MEDIA_REFERENCE_REVOKED') return 'revoked';
  return 'failed';
}

class PreviewGrantRegistry {
  constructor(options = {}) {
    this.resolveSource = options.resolveSource;
    this.decoder = options.nativeImage;
    this.lstat = options.lstat || ((filePath) => fsp.lstat(filePath));
    this.realpath = options.realpath || ((filePath) => fsp.realpath(filePath));
    this.openFile = options.openFile || ((filePath) => fsp.open(filePath, 'r'));
    this.grants = new Map();
    this.requests = new Map();
  }

  async get(senderId, input) {
    this.prune();
    const requestKey = `${senderId}:${input.requestId}`;
    const fingerprint = `${input.accountId}:${input.transferId}`;
    const previous = this.requests.get(requestKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw previewError('CONFLICT', 'requestId reutilizado');
      return previous.value;
    }
    let source;
    try {
      source = await this.resolveSource(senderId, input);
      const stats = await this.inspectSource(source);
      const resolvedPath = await this.realpath(source.path);
      const handle = await this.openFile(resolvedPath);
      let data;
      try {
        const openedStats = await handle.stat();
        if (!sameMetadata(fileMetadata(stats), fileMetadata(openedStats)))
          throw previewError('STORAGE_FAILED', 'el archivo cambió');
        data = await handle.readFile();
      } finally {
        await handle.close().catch(() => undefined);
      }
      const image = inspectStaticImage(data, this.decoder);
      this.assertGrantCapacity(senderId);
      const previewId = crypto.randomUUID();
      const grant = {
        previewId,
        senderId,
        accountId: input.accountId,
        transferId: input.transferId,
        path: source.path,
        resolvedPath,
        metadata: fileMetadata(stats),
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        width: image.width,
        height: image.height,
        expiresAtMs: Date.now() + TTL_MS,
        streams: new Map(),
      };
      this.grants.set(previewId, grant);
      grant.expiryTimer = setTimeout(() => void this.revokeGrant(grant), TTL_MS);
      const value = {
        state: 'ready',
        previewId,
        accountId: input.accountId,
        transferId: input.transferId,
        mimeType: image.mimeType,
        sizeBytes: image.sizeBytes,
        width: image.width,
        height: image.height,
        expiresAt: new Date(grant.expiresAtMs).toISOString(),
      };
      this.rememberRequest(requestKey, fingerprint, value);
      return value;
    } catch (error) {
      if (
        error?.code === 'UNAUTHORIZED' ||
        error?.code === 'CONFLICT' ||
        error?.code === 'RESOURCE_CONSTRAINT'
      )
        throw error;
      const code = error?.code === 'STORAGE_FAILED' ? 'MEDIA_PREVIEW_UNAVAILABLE' : error?.code || 'MEDIA_DECODE_FAILED';
      const value = {
        state: code === 'MEDIA_PREVIEW_UNAVAILABLE' ? 'unavailable' : failureState(code),
        accountId: input.accountId,
        transferId: input.transferId,
        reasonCode: code,
      };
      this.rememberRequest(requestKey, fingerprint, value);
      return value;
    }
  }

  async open(senderId, input) {
    const grant = this.authorizeGrant(senderId, input);
    if (grant.streams.size >= 1) throw previewError('RESOURCE_CONSTRAINT', 'la previsualización ya tiene un stream abierto');
    await this.assertGrantSource(grant);
    const handle = await this.openFile(grant.resolvedPath);
    try {
      const stats = await handle.stat();
      if (!sameMetadata(grant.metadata, fileMetadata(stats))) throw previewError('STORAGE_FAILED', 'el archivo cambió');
      const streamId = crypto.randomUUID();
      grant.streams.set(streamId, { handle, offset: 0, sequence: 0, done: false });
      return {
        previewId: grant.previewId,
        streamId,
        expiresAt: new Date(grant.expiresAtMs).toISOString(),
        chunkSize: PREVIEW_CHUNK_SIZE,
      };
    } catch (error) {
      await handle.close().catch(() => undefined);
      throw error;
    }
  }

  async read(senderId, input) {
    const grant = this.authorizeGrant(senderId, input);
    const stream = grant.streams.get(input.streamId);
    if (!stream) throw previewError('UNAUTHORIZED', 'el stream no está autorizado');
    if (input.sequence !== stream.sequence) throw previewError('CONFLICT', 'secuencia de stream inválida');
    if (stream.done) throw previewError('CONFLICT', 'el stream ya terminó');
    const buffer = Buffer.alloc(PREVIEW_CHUNK_SIZE);
    const result = await stream.handle.read(buffer, 0, buffer.length, stream.offset);
    if (result.bytesRead === 0) throw previewError('STORAGE_FAILED', 'el archivo terminó antes de tiempo');
    stream.offset += result.bytesRead;
    stream.sequence += 1;
    stream.done = stream.offset >= Number(grant.sizeBytes);
    return {
      previewId: grant.previewId,
      streamId: input.streamId,
      sequence: input.sequence,
      bytes: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + result.bytesRead),
      done: stream.done,
    };
  }

  async close(senderId, input) {
    const grant = this.authorizeGrant(senderId, input, true);
    const stream = grant.streams.get(input.streamId);
    if (!stream) return;
    grant.streams.delete(input.streamId);
    await stream.handle.close().catch(() => undefined);
  }

  async revoke(senderId, input) {
    const grant = this.grants.get(input.previewId);
    if (!grant) return;
    if (grant.senderId !== senderId || grant.accountId !== input.accountId || grant.transferId !== input.transferId)
      throw previewError('UNAUTHORIZED', 'la referencia no está autorizada');
    await this.revokeGrant(grant);
  }

  clearSender(senderId) {
    for (const grant of [...this.grants.values()]) if (grant.senderId === senderId) void this.revokeGrant(grant);
    for (const key of this.requests.keys()) if (key.startsWith(`${senderId}:`)) this.requests.delete(key);
  }

  clearAccount(accountId) {
    for (const grant of [...this.grants.values()]) if (grant.accountId === accountId) void this.revokeGrant(grant);
  }

  async revokeGrant(grant) {
    if (grant.expiryTimer) clearTimeout(grant.expiryTimer);
    for (const stream of grant.streams.values()) await stream.handle.close().catch(() => undefined);
    grant.streams.clear();
    this.grants.delete(grant.previewId);
  }

  authorizeGrant(senderId, input, allowExpired = false) {
    this.prune();
    const grant = this.grants.get(input.previewId);
    if (!grant || grant.senderId !== senderId || grant.accountId !== input.accountId || grant.transferId !== input.transferId)
      throw previewError('UNAUTHORIZED', 'la referencia no está autorizada');
    if (!allowExpired && Date.now() >= grant.expiresAtMs) throw previewError('MEDIA_REFERENCE_REVOKED', 'la referencia expiró');
    return grant;
  }

  async inspectSource(source) {
    let stats;
    try {
      stats = await this.lstat(source.path);
    } catch {
      throw previewError('STORAGE_FAILED', 'el archivo no está disponible');
    }
    if (stats.isSymbolicLink() || !stats.isFile()) throw previewError('STORAGE_FAILED', 'el archivo no es regular');
    if (String(stats.size) !== String(source.metadata?.size)) throw previewError('STORAGE_FAILED', 'el archivo cambió');
    return stats;
  }

  async assertGrantSource(grant) {
    const stats = await this.lstat(grant.path);
    if (stats.isSymbolicLink() || !stats.isFile()) throw previewError('STORAGE_FAILED', 'el archivo no es regular');
    if (!sameMetadata(grant.metadata, fileMetadata(stats))) throw previewError('STORAGE_FAILED', 'el archivo cambió');
    if ((await this.realpath(grant.path)) !== grant.resolvedPath) throw previewError('STORAGE_FAILED', 'la ruta del archivo cambió');
  }

  assertGrantCapacity(senderId) {
    const senderCount = [...this.grants.values()].filter((grant) => grant.senderId === senderId).length;
    if (senderCount >= MAX_GRANTS_PER_SENDER || this.grants.size >= MAX_GRANTS)
      throw previewError('RESOURCE_CONSTRAINT', 'se alcanzó el límite de previews');
  }

  rememberRequest(key, fingerprint, value) {
    this.requests.set(key, { fingerprint, value });
    while (this.requests.size > MAX_REQUESTS) this.requests.delete(this.requests.keys().next().value);
  }

  prune() {
    const now = Date.now();
    for (const grant of [...this.grants.values()]) if (grant.expiresAtMs <= now) void this.revokeGrant(grant);
  }
}

module.exports = { PreviewGrantRegistry, TTL_MS, MAX_GRANTS_PER_SENDER, MAX_GRANTS };
