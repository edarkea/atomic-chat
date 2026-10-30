const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const TTL_MS = 60 * 1000;
const CHUNK_SIZE = 64 * 1024;
const MAX_GRANTS_PER_SENDER = 16;
const MAX_GRANTS = 64;
const SAFE_READ_FLAGS = process.platform === 'win32' ? 'r' : fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);

function grantError(code, message) {
  const cause = new Error(message);
  cause.code = code;
  return cause;
}

function fileIdentity(stats) {
  return {
    dev: String(stats.dev), ino: String(stats.ino), size: String(stats.size),
    mtimeMs: String(stats.mtimeMs), birthtimeMs: String(stats.birthtimeMs),
  };
}

function sameIdentity(left, right) {
  return ['dev', 'ino', 'size', 'mtimeMs', 'birthtimeMs'].every((key) => left[key] === right[key]);
}

class StickerGrantRegistry {
  constructor(options = {}) {
    this.resolveSource = options.resolveSource;
    this.openFile = options.openFile || ((filePath) => fsp.open(filePath, SAFE_READ_FLAGS));
    this.grants = new Map();
    this.revoked = new Map();
    this.senderEpochs = new Map();
    this.accountEpochs = new Map();
    this.timer = setInterval(() => this.prune(), 15_000);
    this.timer.unref?.();
  }

  async get(senderId, input) {
    this.prune();
    const senderEpoch = this.senderEpochs.get(senderId) || 0;
    const accountEpoch = this.accountEpochs.get(input.accountId) || 0;
    const source = await this.resolveSource(input.accountId, input.stickerId);
    if (senderEpoch !== (this.senderEpochs.get(senderId) || 0) || accountEpoch !== (this.accountEpochs.get(input.accountId) || 0))
      throw grantError('UNAUTHORIZED', 'la cuenta o ventana ya no está autorizada');
    const stats = await fsp.lstat(source.path);
    if (stats.isSymbolicLink() || !stats.isFile() || Number(stats.size) !== Number(source.sizeBytes))
      throw grantError('MEDIA_PREVIEW_UNAVAILABLE', 'el sticker no está disponible');
    if (this.grants.size >= MAX_GRANTS || [...this.grants.values()].filter((item) => item.senderId === senderId).length >= MAX_GRANTS_PER_SENDER)
      throw grantError('RESOURCE_CONSTRAINT', 'se alcanzó el límite de previews');
    const grantId = crypto.randomUUID();
    const expiresAtMs = Date.now() + TTL_MS;
    const grant = {
      grantId, senderId, accountId: input.accountId, stickerId: input.stickerId, assetId: source.assetId,
      path: source.path, mimeType: source.mimeType, sizeBytes: Number(source.sizeBytes), width: source.width,
      height: source.height, identity: fileIdentity(stats), expiresAtMs, streams: new Map(), opening: undefined, revoking: false,
    };
    this.grants.set(grantId, grant);
    grant.timer = setTimeout(() => void this.revokeGrant(grant), TTL_MS);
    return this.publicGrant(grant);
  }

  async open(senderId, input) {
    const grant = this.authorize(senderId, input);
    if (grant.opening || grant.streams.size) throw grantError('RESOURCE_CONSTRAINT', 'el preview ya está abierto');
    const opening = { cancelled: false };
    grant.opening = opening;
    let handle;
    try {
      await this.assertActive(grant);
      handle = await this.openFile(grant.path);
      opening.handle = handle;
      await this.assertActive(grant);
      const stats = await handle.stat();
      if (!stats.isFile() || Number(stats.size) !== grant.sizeBytes || (process.platform !== 'win32' && !sameIdentity(grant.identity, fileIdentity(stats))))
        throw grantError('STORAGE_FAILED', 'el asset cambió');
      await this.assertActive(grant);
      const streamId = crypto.randomUUID();
      grant.streams.set(streamId, { handle, offset: 0, sequence: 0, done: false, reading: undefined, closed: false });
      grant.opening = undefined;
      return { grantId: grant.grantId, streamId, accountId: grant.accountId, assetId: grant.assetId, expiresAt: new Date(grant.expiresAtMs).toISOString(), chunkSize: CHUNK_SIZE };
    } catch (cause) {
      if (handle) await handle.close().catch(() => undefined);
      throw cause;
    } finally {
      if (grant.opening === opening) grant.opening = undefined;
    }
  }

  async read(senderId, input) {
    const grant = this.authorize(senderId, input);
    const stream = grant.streams.get(input.streamId);
    if (!stream) throw grantError('CONFLICT', 'el stream no está abierto');
    if (stream.reading) throw grantError('CONFLICT', 'ya hay una lectura pendiente');
    if (input.sequence !== stream.sequence) throw grantError('CONFLICT', 'secuencia inválida');
    if (stream.done) throw grantError('CONFLICT', 'el stream ya terminó');
    const pending = this.readChunk(grant, stream, input);
    stream.reading = pending;
    try { return await pending; } finally { if (stream.reading === pending) stream.reading = undefined; }
  }

  async readChunk(grant, stream, input) {
    await this.assertReadable(grant, stream, input.streamId);
    const before = await stream.handle.stat();
    await this.assertReadable(grant, stream, input.streamId);
    if (!this.identityValid(grant, before)) { await this.revokeGrant(grant); throw grantError('STORAGE_FAILED', 'el asset cambió'); }
    const remaining = grant.sizeBytes - stream.offset;
    if (remaining <= 0) throw grantError('CONFLICT', 'se alcanzó el final del stream');
    const buffer = Buffer.alloc(Math.min(CHUNK_SIZE, remaining));
    const result = await stream.handle.read(buffer, 0, buffer.length, stream.offset);
    await this.assertReadable(grant, stream, input.streamId);
    const after = await stream.handle.stat();
    await this.assertReadable(grant, stream, input.streamId);
    if (!this.identityValid(grant, after) || !Number.isInteger(result.bytesRead) || result.bytesRead <= 0 || result.bytesRead > buffer.length)
      { await this.revokeGrant(grant); throw grantError('STORAGE_FAILED', 'la lectura no es íntegra'); }
    stream.offset += result.bytesRead;
    stream.sequence += 1;
    stream.done = stream.offset >= grant.sizeBytes;
    return { grantId: grant.grantId, streamId: input.streamId, sequence: input.sequence, bytes: buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + result.bytesRead), done: stream.done };
  }

  async close(senderId, input) {
    const grant = this.grants.get(input.grantId);
    if (!grant) { if (this.isRevokedOwner(senderId, input)) return; throw grantError('UNAUTHORIZED', 'la referencia no está autorizada'); }
    this.assertOwnership(senderId, grant, input);
    const stream = grant.streams.get(input.streamId);
    if (!stream) return;
    stream.closed = true;
    grant.streams.delete(input.streamId);
    await stream.handle.close().catch(() => undefined);
  }

  async revoke(senderId, input) {
    const grant = this.grants.get(input.grantId);
    if (!grant) { if (this.isRevokedOwner(senderId, input)) return; throw grantError('UNAUTHORIZED', 'la referencia no está autorizada'); }
    this.assertOwnership(senderId, grant, input);
    await this.revokeGrant(grant);
  }

  async revokeGrant(grant) {
    if (grant.revoking) return;
    grant.revoking = true;
    if (grant.timer) clearTimeout(grant.timer);
    this.grants.delete(grant.grantId);
    this.revoked.set(grant.grantId, { senderId: grant.senderId, accountId: grant.accountId, stickerId: grant.stickerId, expiresAtMs: Date.now() + TTL_MS });
    if (grant.opening?.handle) await grant.opening.handle.close().catch(() => undefined);
    for (const stream of grant.streams.values()) await stream.handle.close().catch(() => undefined);
    grant.streams.clear();
  }

  clearSender(senderId) {
    this.senderEpochs.set(senderId, (this.senderEpochs.get(senderId) || 0) + 1);
    for (const grant of [...this.grants.values()]) if (grant.senderId === senderId) void this.revokeGrant(grant);
  }

  clearAccount(accountId) {
    this.accountEpochs.set(accountId, (this.accountEpochs.get(accountId) || 0) + 1);
    for (const grant of [...this.grants.values()]) if (grant.accountId === accountId) void this.revokeGrant(grant);
  }

  hasActiveAsset(accountId, assetId) { return [...this.grants.values()].some((grant) => grant.accountId === accountId && grant.assetId === assetId && !grant.revoking); }

  authorize(senderId, input) {
    this.prune();
    const grant = this.grants.get(input.grantId);
    if (!grant) throw grantError('MEDIA_REFERENCE_REVOKED', 'la referencia expiró o fue revocada');
    this.assertOwnership(senderId, grant, input);
    if (Date.now() >= grant.expiresAtMs) { void this.revokeGrant(grant); throw grantError('MEDIA_REFERENCE_REVOKED', 'la referencia expiró'); }
    return grant;
  }

  assertOwnership(senderId, grant, input) {
    if (grant.senderId !== senderId || grant.accountId !== input.accountId || grant.stickerId !== input.stickerId || grant.grantId !== input.grantId)
      throw grantError('UNAUTHORIZED', 'la referencia no está autorizada');
  }

  async assertActive(grant) {
    if (grant.revoking || this.grants.get(grant.grantId) !== grant || Date.now() >= grant.expiresAtMs) {
      await this.revokeGrant(grant);
      throw grantError('MEDIA_REFERENCE_REVOKED', 'la referencia expiró o fue revocada');
    }
  }

  async assertReadable(grant, stream, streamId) {
    await this.assertActive(grant);
    if (grant.streams.get(streamId) !== stream || stream.closed) throw grantError('CONFLICT', 'el stream ya no está abierto');
  }

  identityValid(grant, stats) { return stats.isFile() && Number(stats.size) === grant.sizeBytes && (process.platform === 'win32' || sameIdentity(grant.identity, fileIdentity(stats))); }

  publicGrant(grant) {
    return { grantId: grant.grantId, accountId: grant.accountId, stickerId: grant.stickerId, assetId: grant.assetId, expiresAt: new Date(grant.expiresAtMs).toISOString(), mimeType: grant.mimeType, sizeBytes: String(grant.sizeBytes), width: grant.width, height: grant.height, chunkSize: CHUNK_SIZE };
  }

  isRevokedOwner(senderId, input) {
    const value = this.revoked.get(input.grantId);
    return Boolean(value && value.senderId === senderId && value.accountId === input.accountId && value.stickerId === input.stickerId);
  }

  prune() {
    const now = Date.now();
    for (const grant of [...this.grants.values()]) if (grant.expiresAtMs <= now) void this.revokeGrant(grant);
    for (const [key, value] of this.revoked) if (value.expiresAtMs <= now) this.revoked.delete(key);
  }
}

module.exports = { StickerGrantRegistry, TTL_MS, CHUNK_SIZE };
