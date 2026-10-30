const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  inspectStaticImage,
  MAX_PREVIEW_BYTES,
  PREVIEW_CHUNK_SIZE,
  previewError,
} = require('./preview-image.cjs');

const TTL_MS = 5 * 60 * 1000;
const MAX_GRANTS_PER_SENDER = 8;
const MAX_GRANTS = 32;
const MAX_REQUESTS = 128;
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
    this.openFile = options.openFile || ((filePath) => fsp.open(filePath, SAFE_READ_FLAGS));
    this.grants = new Map();
    this.revoked = new Map();
    this.requests = new Map();
    this.senderEpochs = new Map();
    this.accountEpochs = new Map();
  }

  async get(senderId, input) {
    this.prune();
    const senderEpoch = this.currentEpoch(this.senderEpochs, senderId);
    const accountEpoch = this.currentEpoch(this.accountEpochs, input.accountId);
    const requestKey = `${senderId}:${input.requestId}`;
    const fingerprint = `${input.accountId}:${input.transferId}`;
    const previous = this.requests.get(requestKey);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw previewError('CONFLICT', 'requestId reutilizado');
      if (previous.value.state === 'ready' && !this.grants.has(previous.value.previewId)) {
        previous.value = {
          state: 'revoked',
          accountId: input.accountId,
          transferId: input.transferId,
          reasonCode: 'MEDIA_REFERENCE_REVOKED',
        };
      }
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
        if (openedStats.size > MAX_PREVIEW_BYTES)
          throw previewError('MEDIA_SIZE_EXCEEDED', 'la imagen supera el tamaño permitido');
        data = await handle.readFile();
        const finalStats = await handle.stat();
        if (!sameMetadata(fileMetadata(openedStats), fileMetadata(finalStats)))
          throw previewError('STORAGE_FAILED', 'el archivo cambió durante la lectura');
        if (Number(finalStats.size) !== data.length)
          throw previewError('STORAGE_FAILED', 'el tamaño del archivo cambió durante la lectura');
        if (data.length > MAX_PREVIEW_BYTES)
          throw previewError('MEDIA_SIZE_EXCEEDED', 'la imagen supera el tamaño permitido');
      } finally {
        await handle.close().catch(() => undefined);
      }
      const image = inspectStaticImage(data, this.decoder);
      this.assertGetStillAuthorized(senderId, input.accountId, senderEpoch, accountEpoch);
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
    if (grant.streams.size >= 1 || grant.opening)
      throw previewError('RESOURCE_CONSTRAINT', 'la previsualización ya tiene un stream abierto');
    const opening = { cancelled: false };
    grant.opening = opening;
    let opened;
    let handle;
    let published = false;
    try {
      await this.assertGrantActive(grant);
      await this.assertGrantSource(grant);
      await this.assertGrantActive(grant);
      opened = await this.openGrantHandle(grant);
      handle = opened.handle;
      opening.handle = handle;
      opening.cleanupPath = opened.cleanupPath;
      opening.cleanupDirectory = opened.cleanupDirectory;
      await this.assertGrantActive(grant);
      const stats = await handle.stat();
      await this.assertGrantActive(grant);
      if (process.platform !== 'win32' && !sameMetadata(grant.metadata, fileMetadata(stats)))
        throw previewError('STORAGE_FAILED', 'el archivo cambió');
      if (Number(stats.size) !== Number(grant.sizeBytes))
        throw previewError('STORAGE_FAILED', 'el tamaño del archivo cambió');
      await this.assertGrantActive(grant);
      const streamId = crypto.randomUUID();
      grant.streams.set(streamId, {
        handle,
        cleanupPath: opened.cleanupPath,
        cleanupDirectory: opened.cleanupDirectory,
        offset: 0,
        sequence: 0,
        done: false,
      });
      grant.opening = undefined;
      published = true;
      return {
        previewId: grant.previewId,
        streamId,
        expiresAt: new Date(grant.expiresAtMs).toISOString(),
        chunkSize: PREVIEW_CHUNK_SIZE,
      };
    } catch (error) {
      if (handle) await handle.close().catch(() => undefined);
      await this.removePrivateCopy(opened?.cleanupPath, opened?.cleanupDirectory);
      throw error;
    } finally {
      if (!published && grant.opening === opening) grant.opening = undefined;
    }
  }

  async read(senderId, input) {
    const grant = this.authorizeGrant(senderId, input);
    const stream = grant.streams.get(input.streamId);
    if (!stream) throw previewError('UNAUTHORIZED', 'el stream no está autorizado');
    if (stream.reading) throw previewError('CONFLICT', 'ya hay una lectura pendiente en el stream');
    if (input.sequence !== stream.sequence) throw previewError('CONFLICT', 'secuencia de stream inválida');
    if (stream.done) throw previewError('CONFLICT', 'el stream ya terminó');
    const reading = this.readChunk(grant, stream, input);
    stream.reading = reading;
    try {
      return await reading;
    } finally {
      if (stream.reading === reading) stream.reading = undefined;
    }
  }

  async readChunk(grant, stream, input) {
    await this.assertReadable(grant, stream, input.streamId);
    const before = await stream.handle.stat();
    await this.assertReadable(grant, stream, input.streamId);
    if (!this.isStreamIdentityValid(grant, before)) {
      await this.revokeGrant(grant);
      throw previewError('STORAGE_FAILED', 'el archivo cambió durante la lectura');
    }
    const remaining = Number(grant.sizeBytes) - stream.offset;
    if (remaining <= 0) throw previewError('CONFLICT', 'el stream superó el tamaño validado');
    const buffer = Buffer.alloc(Math.min(PREVIEW_CHUNK_SIZE, remaining));
    const result = await stream.handle.read(buffer, 0, buffer.length, stream.offset);
    if (
      !Number.isInteger(result.bytesRead) ||
      result.bytesRead <= 0 ||
      result.bytesRead > buffer.length ||
      result.bytesRead > remaining
    ) {
      await this.revokeGrant(grant);
      throw previewError('STORAGE_FAILED', 'la lectura devolvió un tamaño inválido');
    }
    await this.assertReadable(grant, stream, input.streamId);
    const after = await stream.handle.stat();
    await this.assertReadable(grant, stream, input.streamId);
    if (!this.isStreamIdentityValid(grant, after)) {
      await this.revokeGrant(grant);
      throw previewError('STORAGE_FAILED', 'el archivo cambió durante la lectura');
    }
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

  isStreamIdentityValid(grant, stats) {
    return process.platform === 'win32'
      ? stats.isFile() && Number(stats.size) === Number(grant.sizeBytes)
      : sameMetadata(grant.metadata, fileMetadata(stats));
  }

  async close(senderId, input) {
    const grant = this.grants.get(input.previewId);
    if (!grant) {
      if (this.isRevokedOwner(senderId, input)) return;
      throw previewError('UNAUTHORIZED', 'la referencia no está autorizada');
    }
    if (grant.senderId !== senderId || grant.accountId !== input.accountId || grant.transferId !== input.transferId)
      throw previewError('UNAUTHORIZED', 'la referencia no está autorizada');
    const stream = grant.streams.get(input.streamId);
    if (!stream) return;
    stream.closed = true;
    grant.streams.delete(input.streamId);
    await stream.handle.close().catch(() => undefined);
    await this.removePrivateCopy(stream.cleanupPath, stream.cleanupDirectory);
  }

  async revoke(senderId, input) {
    const grant = this.grants.get(input.previewId);
    const revoked = this.revoked.get(input.previewId);
    if (revoked) {
      if (
        revoked.senderId === senderId &&
        revoked.accountId === input.accountId &&
        revoked.transferId === input.transferId
      )
        return;
      throw previewError('UNAUTHORIZED', 'la referencia no está autorizada');
    }
    if (!grant) throw previewError('UNAUTHORIZED', 'la referencia no está autorizada');
    if (grant.senderId !== senderId || grant.accountId !== input.accountId || grant.transferId !== input.transferId)
      throw previewError('UNAUTHORIZED', 'la referencia no está autorizada');
    await this.revokeGrant(grant);
  }

  clearSender(senderId) {
    this.bumpEpoch(this.senderEpochs, senderId);
    for (const grant of [...this.grants.values()]) if (grant.senderId === senderId) void this.revokeGrant(grant);
    for (const key of this.requests.keys()) if (key.startsWith(`${senderId}:`)) this.requests.delete(key);
  }

  clearAccount(accountId) {
    this.bumpEpoch(this.accountEpochs, accountId);
    for (const grant of [...this.grants.values()]) if (grant.accountId === accountId) void this.revokeGrant(grant);
  }

  async revokeGrant(grant) {
    if (grant.revoking) return;
    grant.revoking = true;
    if (grant.opening) grant.opening.cancelled = true;
    if (grant.expiryTimer) clearTimeout(grant.expiryTimer);
    this.revoked.set(grant.previewId, {
      senderId: grant.senderId,
      accountId: grant.accountId,
      transferId: grant.transferId,
      expiresAtMs: Date.now() + TTL_MS,
    });
    this.grants.delete(grant.previewId);
    const opening = grant.opening;
    if (opening?.handle) await opening.handle.close().catch(() => undefined);
    await this.removePrivateCopy(opening?.cleanupPath, opening?.cleanupDirectory);
    for (const stream of grant.streams.values()) {
      await stream.handle.close().catch(() => undefined);
      await this.removePrivateCopy(stream.cleanupPath, stream.cleanupDirectory);
    }
    grant.streams.clear();
    grant.opening = undefined;
    while (this.revoked.size > MAX_REQUESTS) this.revoked.delete(this.revoked.keys().next().value);
  }

  async assertGrantActive(grant) {
    if (
      grant.revoking ||
      this.grants.get(grant.previewId) !== grant ||
      Date.now() >= grant.expiresAtMs
    ) {
      await this.revokeGrant(grant);
      throw previewError('MEDIA_REFERENCE_REVOKED', 'la referencia expiró o fue revocada');
    }
  }

  async assertReadable(grant, stream, streamId) {
    if (
      grant.revoking ||
      this.grants.get(grant.previewId) !== grant ||
      Date.now() >= grant.expiresAtMs
    ) {
      await this.revokeGrant(grant);
      throw previewError('MEDIA_REFERENCE_REVOKED', 'la referencia expiró o fue revocada');
    }
    if (grant.streams.get(streamId) !== stream || stream.closed)
      throw previewError('CONFLICT', 'el stream ya no está abierto');
  }

  isRevokedOwner(senderId, input) {
    const revoked = this.revoked.get(input.previewId);
    return Boolean(
      revoked &&
        revoked.senderId === senderId &&
        revoked.accountId === input.accountId &&
        revoked.transferId === input.transferId,
    );
  }

  assertGetStillAuthorized(senderId, accountId, senderEpoch, accountEpoch) {
    if (
      this.currentEpoch(this.senderEpochs, senderId) !== senderEpoch ||
      this.currentEpoch(this.accountEpochs, accountId) !== accountEpoch
    )
      throw previewError('UNAUTHORIZED', 'la cuenta o ventana ya no está autorizada');
  }

  currentEpoch(epochs, key) {
    return epochs.get(key) || 0;
  }

  bumpEpoch(epochs, key) {
    epochs.set(key, this.currentEpoch(epochs, key) + 1);
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
    if (stats.size > MAX_PREVIEW_BYTES)
      throw previewError('MEDIA_SIZE_EXCEEDED', 'la imagen supera el tamaño permitido');
    return stats;
  }

  async assertGrantSource(grant) {
    const stats = await this.lstat(grant.path);
    if (stats.isSymbolicLink() || !stats.isFile()) throw previewError('STORAGE_FAILED', 'el archivo no es regular');
    if (!sameMetadata(grant.metadata, fileMetadata(stats))) throw previewError('STORAGE_FAILED', 'el archivo cambió');
    if ((await this.realpath(grant.path)) !== grant.resolvedPath) throw previewError('STORAGE_FAILED', 'la ruta del archivo cambió');
  }

  async openGrantHandle(grant) {
    if (process.platform !== 'win32') return { handle: await this.openFile(grant.resolvedPath) };
    const sourceHandle = await this.openFile(grant.resolvedPath);
    let directory;
    let privatePath;
    try {
      const sourceStats = await sourceHandle.stat();
      if (!sameMetadata(grant.metadata, fileMetadata(sourceStats)))
        throw previewError('STORAGE_FAILED', 'el archivo cambió antes de la copia');
      if (sourceStats.size > MAX_PREVIEW_BYTES)
        throw previewError('MEDIA_SIZE_EXCEEDED', 'la imagen supera el tamaño permitido');
      const data = await sourceHandle.readFile();
      if (data.length !== Number(grant.sizeBytes))
        throw previewError('STORAGE_FAILED', 'el tamaño del archivo cambió');
      const finalSourceStats = await sourceHandle.stat();
      if (!sameMetadata(grant.metadata, fileMetadata(finalSourceStats)))
        throw previewError('STORAGE_FAILED', 'el archivo cambió durante la copia');
      directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'atomic-chat-preview-'));
      privatePath = path.join(directory, crypto.randomUUID());
      await fsp.writeFile(privatePath, data, { flag: 'wx', mode: 0o600 });
      const privateHandle = await this.openFile(privatePath);
      const privateStats = await privateHandle.stat();
      if (Number(privateStats.size) !== data.length || !privateStats.isFile()) {
        await privateHandle.close().catch(() => undefined);
        throw previewError('STORAGE_FAILED', 'la copia privada no es válida');
      }
      return { handle: privateHandle, cleanupPath: privatePath, cleanupDirectory: directory };
    } catch (error) {
      await this.removePrivateCopy(privatePath, directory);
      throw error;
    } finally {
      await sourceHandle.close().catch(() => undefined);
    }
  }

  async removePrivateCopy(privatePath, directory) {
    if (privatePath) await fsp.rm(privatePath, { force: true }).catch(() => undefined);
    if (directory) await fsp.rm(directory, { recursive: true, force: true }).catch(() => undefined);
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
    for (const [previewId, revoked] of this.revoked)
      if (revoked.expiresAtMs <= now) this.revoked.delete(previewId);
  }
}

module.exports = { PreviewGrantRegistry, TTL_MS, MAX_GRANTS_PER_SENDER, MAX_GRANTS };
