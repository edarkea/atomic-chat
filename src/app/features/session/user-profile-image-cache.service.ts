import { Injectable, inject } from '@angular/core';
import { createOpaqueId } from '../../core/ids';
import type {
  UserProfileImageChunk,
  UserProfileImageRef,
  UserProfileImageStreamRef,
} from '../../core/domain';
import { USER_PROFILE_PORT, type UserProfilePort } from '../../core/ports';

const MAX_PROFILE_IMAGE_BYTES = 512 * 1024;
const MAX_CACHED_PROFILE_IMAGES = 32;
const MAX_CACHED_PROFILE_IMAGE_BYTES = 16 * 1024 * 1024;

interface CachedProfileImage {
  readonly objectUrl: string;
  readonly sizeBytes: number;
  readonly expiresAtMs: number;
  lastUsedAt: number;
}

/** Shares one safe image stream between all visible avatar components. */
@Injectable({ providedIn: 'root' })
export class UserProfileImageCache {
  private readonly port = inject<UserProfilePort | null>(USER_PROFILE_PORT, { optional: true });
  private readonly entries = new Map<string, CachedProfileImage>();
  private readonly pending = new Map<string, Promise<string>>();
  private readonly accountGenerations = new Map<string, number>();
  private totalBytes = 0;

  async get(image: UserProfileImageRef, accountId: string): Promise<string> {
    this.pruneExpired();
    const key = this.key(accountId, image.referenceId);
    const expiresAtMs = Date.parse(image.expiresAt);
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now())
      throw new Error('La referencia de imagen expiró.');

    const cached = this.entries.get(key);
    if (cached && cached.expiresAtMs > Date.now()) {
      cached.lastUsedAt = Date.now();
      return cached.objectUrl;
    }

    const existing = this.pending.get(key);
    if (existing) return existing;

    const accountGeneration = this.generationFor(accountId);
    const operation = this.load(image, accountId, expiresAtMs)
      .then((objectUrl) => {
        if (this.generationFor(accountId) !== accountGeneration) {
          URL.revokeObjectURL(objectUrl);
          throw new Error('La sesión de imágenes quedó obsoleta.');
        }
        this.store(key, objectUrl, image, expiresAtMs);
        return objectUrl;
      })
      .finally(() => {
        if (this.pending.get(key) === operation) this.pending.delete(key);
      });
    this.pending.set(key, operation);
    return operation;
  }

  clearAccount(accountId: string): void {
    const normalizedAccountId = accountId.trim().toLocaleLowerCase();
    if (!normalizedAccountId) return;
    this.accountGenerations.set(normalizedAccountId, this.generationFor(normalizedAccountId) + 1);
    const prefix = `${normalizedAccountId}\u0000`;
    for (const key of this.pending.keys()) if (key.startsWith(prefix)) this.pending.delete(key);
    for (const [key, entry] of this.entries) {
      if (key.startsWith(prefix)) this.remove(key, entry);
    }
  }

  private async load(
    image: UserProfileImageRef,
    accountId: string,
    expiresAtMs: number,
  ): Promise<string> {
    if (!this.port) throw new Error('La lectura de imágenes no está disponible.');
    const expectedSize = Number(image.sizeBytes);
    if (
      !Number.isSafeInteger(expectedSize) ||
      expectedSize < 1 ||
      expectedSize > MAX_PROFILE_IMAGE_BYTES
    )
      throw new Error('El tamaño de la imagen no es válido.');

    let stream: UserProfileImageStreamRef | undefined;
    try {
      const opened = await this.port.openImage({
        version: 1,
        requestId: createOpaqueId('profile-image-open'),
        accountId,
        referenceId: image.referenceId,
      });
      if (!opened.ok) throw new Error(opened.error.message);
      stream = opened.value;

      const bytes = new Uint8Array(expectedSize);
      let sequence = 0;
      let offset = 0;
      let done = false;
      while (!done) {
        const result = await this.port.readImage({
          version: 1,
          requestId: createOpaqueId('profile-image-read'),
          accountId,
          referenceId: image.referenceId,
          streamId: stream.streamId,
          sequence,
        });
        if (!result.ok) throw new Error(result.error.message);
        const chunk = this.chunkBytes(result.value);
        if (offset + chunk.byteLength > bytes.byteLength)
          throw new Error('La imagen excede el tamaño declarado.');
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
        sequence += 1;
        done = result.value.done;
      }
      if (offset !== expectedSize) throw new Error('La imagen está incompleta.');
      if (expiresAtMs <= Date.now()) throw new Error('La referencia de imagen expiró.');
      return URL.createObjectURL(new Blob([bytes], { type: image.mimeType }));
    } finally {
      if (stream) {
        await this.port
          .closeImage({
            version: 1,
            requestId: createOpaqueId('profile-image-close'),
            accountId,
            referenceId: image.referenceId,
            streamId: stream.streamId,
          })
          .catch(() => undefined);
      }
    }
  }

  private chunkBytes(chunk: UserProfileImageChunk): Uint8Array {
    return new Uint8Array(chunk.bytes);
  }

  private store(
    key: string,
    objectUrl: string,
    image: UserProfileImageRef,
    expiresAtMs: number,
  ): void {
    this.pruneExpired();
    const sizeBytes = Number(image.sizeBytes);
    const previous = this.entries.get(key);
    if (previous) {
      URL.revokeObjectURL(previous.objectUrl);
      this.totalBytes -= previous.sizeBytes;
    }
    this.entries.set(key, { objectUrl, sizeBytes, expiresAtMs, lastUsedAt: Date.now() });
    this.totalBytes += sizeBytes;
    this.pruneToBudget();
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAtMs <= now) this.remove(key, entry);
    }
  }

  private pruneToBudget(): void {
    while (
      this.entries.size > MAX_CACHED_PROFILE_IMAGES ||
      this.totalBytes > MAX_CACHED_PROFILE_IMAGE_BYTES
    ) {
      const oldest = [...this.entries.entries()].sort(
        (left, right) => left[1].lastUsedAt - right[1].lastUsedAt,
      )[0];
      if (!oldest) return;
      this.remove(oldest[0], oldest[1]);
    }
  }

  private remove(key: string, entry: CachedProfileImage): void {
    if (this.entries.get(key) !== entry) return;
    URL.revokeObjectURL(entry.objectUrl);
    this.entries.delete(key);
    this.totalBytes -= entry.sizeBytes;
  }

  private key(accountId: string, referenceId: string): string {
    return `${accountId.trim().toLocaleLowerCase()}\u0000${referenceId}`;
  }

  private generationFor(accountId: string): number {
    return this.accountGenerations.get(accountId.trim().toLocaleLowerCase()) || 0;
  }
}
