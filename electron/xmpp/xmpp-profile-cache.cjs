const crypto = require('node:crypto');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { inspectStaticImage } = require('../files/preview-image.cjs');

const PROFILE_CACHE_VERSION = 1;
const PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const PROFILE_CACHE_MAX_ENTRIES = 128;
const PROFILE_CACHE_MAX_BYTES = 32 * 1024 * 1024;

/** @typedef {{contentHash: string, mimeType: 'image/png' | 'image/jpeg', sizeBytes: number, width: number, height: number}} ProfileCacheImage */
/** @typedef {{version: number, accountId: string, jid: string, profile: Record<string, unknown>, avatarHash?: string, image?: ProfileCacheImage, cachedAt: number, lastUsedAt: number}} ProfileCacheRecord */
/** @typedef {{version: number, entries: Record<string, ProfileCacheRecord>}} ProfileCacheIndex */

/** @param {string} accountId @param {string} jid @returns {string} */
function cacheKey(accountId, jid) {
  return crypto
    .createHash('sha256')
    .update(`${accountId.toLocaleLowerCase()}\0${jid.toLocaleLowerCase()}`)
    .digest('hex');
}

/** @param {Buffer} data @returns {string} */
function contentHash(data) {
  return crypto.createHash('sha256').update(data).digest('hex');
}

/** @param {Buffer} data @returns {string} */
function avatarHash(data) {
  return crypto.createHash('sha1').update(data).digest('hex');
}

/** @param {unknown} value @returns {boolean} */
function isProfileRecord(value) {
  if (!value || typeof value !== 'object') return false;
  const candidate = /** @type {Partial<ProfileCacheRecord>} */ (value);
  return Boolean(
    candidate.version === PROFILE_CACHE_VERSION &&
    typeof candidate.accountId === 'string' &&
    typeof candidate.jid === 'string' &&
    candidate.profile &&
    typeof candidate.profile === 'object' &&
    typeof candidate.cachedAt === 'number' &&
    typeof candidate.lastUsedAt === 'number' &&
    (candidate.avatarHash === undefined ||
      (typeof candidate.avatarHash === 'string' && /^[a-f0-9]{40}$/u.test(candidate.avatarHash))) &&
    (candidate.image === undefined ||
      (typeof candidate.image === 'object' &&
        typeof candidate.image.contentHash === 'string' &&
        /^[a-f0-9]{64}$/u.test(candidate.image.contentHash) &&
        (candidate.image.mimeType === 'image/png' || candidate.image.mimeType === 'image/jpeg') &&
        Number.isInteger(candidate.image.sizeBytes) &&
        candidate.image.sizeBytes > 0 &&
        Number.isInteger(candidate.image.width) &&
        Number.isInteger(candidate.image.height))),
  );
}

class XmppProfileCache {
  /**
   * @param {string} directory
   * @param {{nativeImage?: {createFromBuffer: (data: Buffer) => {isEmpty: () => boolean, getSize: () => {width: number, height: number}}}, ttlMs?: number | null, maxEntries?: number, maxBytes?: number}} [options]
   */
  constructor(directory, options = {}) {
    this.directory = directory;
    this.indexPath = path.join(directory, 'index.json');
    this.ttlMs = options.ttlMs === null ? null : options.ttlMs || PROFILE_CACHE_TTL_MS;
    this.maxEntries = options.maxEntries || PROFILE_CACHE_MAX_ENTRIES;
    this.maxBytes = options.maxBytes || PROFILE_CACHE_MAX_BYTES;
    this.nativeImage = options.nativeImage;
    this.writeQueue = Promise.resolve();
    this.indexPromise = undefined;
  }

  async ensureDirectory() {
    await fsp.mkdir(this.directory, { recursive: true, mode: 0o700 });
  }

  async loadIndex() {
    if (this.indexPromise) return this.indexPromise;
    this.indexPromise = (async () => {
      await this.ensureDirectory();
      try {
        const raw = await fsp.readFile(this.indexPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== PROFILE_CACHE_VERSION || !parsed.entries)
          throw new Error();
        const entries = /** @type {Record<string, ProfileCacheRecord>} */ (
          Object.fromEntries(
            Object.entries(parsed.entries).filter(([, value]) => isProfileRecord(value)),
          )
        );
        return { version: PROFILE_CACHE_VERSION, entries };
      } catch {
        return { version: PROFILE_CACHE_VERSION, entries: {} };
      }
    })();
    return this.indexPromise;
  }

  /** @param {ProfileCacheIndex} index */
  async saveIndex(index) {
    await this.ensureDirectory();
    const temporary = `${this.indexPath}.${crypto.randomUUID()}.tmp`;
    await fsp.writeFile(temporary, JSON.stringify(index), { mode: 0o600, flag: 'wx' });
    await fsp.rename(temporary, this.indexPath);
  }

  /** @param {string} fileName */
  imagePath(fileName) {
    if (!/^[a-f0-9]{64}\.bin$/u.test(fileName)) throw new Error('invalid cache file');
    return path.join(this.directory, fileName);
  }

  /** @param {Record<string, ProfileCacheRecord>} entries @returns {number} */
  totalBytes(entries) {
    return Object.values(entries).reduce((sum, entry) => sum + (entry.image?.sizeBytes || 0), 0);
  }

  /** @param {Record<string, ProfileCacheRecord>} entries */
  async prune(entries) {
    const now = Date.now();
    const ttlMs = this.ttlMs;
    const removedContentHashes = new Set();
    const removeEntry = (/** @type {string} */ key) => {
      const entry = entries[key];
      if (entry?.image?.contentHash) removedContentHashes.add(entry.image.contentHash);
      delete entries[key];
    };
    const candidates =
      ttlMs === null
        ? []
        : Object.entries(entries).filter(([, entry]) => now - entry.cachedAt > ttlMs);
    for (const [key] of candidates) removeEntry(key);
    const ordered = Object.entries(entries).sort(
      (left, right) => left[1].lastUsedAt - right[1].lastUsedAt,
    );
    while (ordered.length > this.maxEntries || this.totalBytes(entries) > this.maxBytes) {
      const item = ordered.shift();
      if (!item) break;
      removeEntry(item[0]);
    }
    for (const contentHash of removedContentHashes)
      await this.removeIfUnreferenced(contentHash, entries);
  }

  /** @param {string} accountId @param {string} jid */
  async get(accountId, jid) {
    const index = await this.loadIndex();
    const key = cacheKey(accountId, jid);
    const entry = index.entries[key];
    if (
      !entry ||
      entry.accountId.toLocaleLowerCase() !== accountId.toLocaleLowerCase() ||
      entry.jid.toLocaleLowerCase() !== jid.toLocaleLowerCase()
    )
      return undefined;
    if (this.ttlMs !== null && Date.now() - entry.cachedAt > this.ttlMs) {
      delete index.entries[key];
      await this.enqueueSave(index);
      if (entry.image?.contentHash)
        await this.removeIfUnreferenced(entry.image.contentHash, index.entries);
      return undefined;
    }
    let data;
    if (entry.image) {
      try {
        data = await fsp.readFile(this.imagePath(`${entry.image.contentHash}.bin`));
        if (data.length !== entry.image.sizeBytes || contentHash(data) !== entry.image.contentHash)
          throw new Error();
        const image = inspectStaticImage(data, this.nativeImage);
        if (
          image.mimeType !== entry.image.mimeType ||
          image.width !== entry.image.width ||
          image.height !== entry.image.height
        )
          throw new Error();
        if (avatarHash(data) !== entry.avatarHash) throw new Error();
      } catch {
        delete index.entries[key];
        await this.enqueueSave(index);
        if (entry.image?.contentHash)
          await this.removeIfUnreferenced(entry.image.contentHash, index.entries);
        return undefined;
      }
    }
    entry.lastUsedAt = Date.now();
    // lastUsedAt only affects in-process eviction order. Avoid a disk write for every avatar read.
    return { profile: entry.profile, avatarHash: entry.avatarHash, data };
  }

  /** @param {string} accountId @param {string} jid @param {Record<string, unknown>} profile @param {Buffer | undefined} data */
  async put(accountId, jid, profile, data) {
    if (data && (!Buffer.isBuffer(data) || !data.length)) return;
    const index = await this.loadIndex();
    const key = cacheKey(accountId, jid);
    const now = Date.now();
    const previous = index.entries[key];
    let image;
    let hash;
    if (data) {
      const inspected = inspectStaticImage(data, this.nativeImage);
      hash = avatarHash(data);
      image = /** @type {ProfileCacheImage} */ ({
        contentHash: contentHash(data),
        mimeType: /** @type {'image/png' | 'image/jpeg'} */ (inspected.mimeType),
        sizeBytes: data.length,
        width: inspected.width || 0,
        height: inspected.height || 0,
      });
      const filePath = this.imagePath(`${image.contentHash}.bin`);
      try {
        await fsp.writeFile(filePath, data, { mode: 0o600, flag: 'wx' });
      } catch (error) {
        const code =
          error && typeof error === 'object'
            ? /** @type {{code?: unknown}} */ (error).code
            : undefined;
        if (code !== 'EEXIST') throw error;
      }
    }
    const { image: _ignoredImage, fetchedAt: _ignoredFetchedAt, ...profileData } = profile;
    index.entries[key] = {
      version: PROFILE_CACHE_VERSION,
      accountId,
      jid,
      profile: profileData,
      ...(hash ? { avatarHash: hash } : {}),
      ...(image ? { image } : {}),
      cachedAt: now,
      lastUsedAt: now,
    };
    await this.prune(index.entries);
    await this.enqueueSave(index);
    if (previous?.image?.contentHash && previous.image.contentHash !== image?.contentHash) {
      await this.removeIfUnreferenced(previous.image.contentHash, index.entries);
    }
  }

  /** @param {string} accountId @param {string} jid @param {string | undefined} nextHash */
  async invalidateIfChanged(accountId, jid, nextHash) {
    const index = await this.loadIndex();
    const key = cacheKey(accountId, jid);
    const entry = index.entries[key];
    if (!entry || entry.avatarHash === nextHash) return false;
    delete index.entries[key];
    await this.enqueueSave(index);
    if (entry.image?.contentHash)
      await this.removeIfUnreferenced(entry.image.contentHash, index.entries);
    return true;
  }

  /** @param {string} content @param {Record<string, ProfileCacheRecord>} entries */
  async removeIfUnreferenced(content, entries) {
    if (Object.values(entries).some((entry) => entry.image?.contentHash === content)) return;
    try {
      await fsp.unlink(this.imagePath(`${content}.bin`));
    } catch (error) {
      const code =
        error && typeof error === 'object'
          ? /** @type {{code?: unknown}} */ (error).code
          : undefined;
      if (code !== 'ENOENT') throw error;
    }
  }

  /** @param {ProfileCacheIndex} index */
  enqueueSave(index) {
    this.writeQueue = this.writeQueue.catch(() => undefined).then(() => this.saveIndex(index));
    return this.writeQueue;
  }
}

module.exports = {
  PROFILE_CACHE_MAX_BYTES,
  PROFILE_CACHE_MAX_ENTRIES,
  PROFILE_CACHE_TTL_MS,
  XmppProfileCache,
  avatarHash,
};
