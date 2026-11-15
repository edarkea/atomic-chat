import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  Result,
  UserProfileImageChunk,
  UserProfileImageRef,
  UserProfileImageStreamRef,
} from '../../core/domain';
import { USER_PROFILE_PORT, type UserProfilePort } from '../../core/ports';
import { UserProfileImageCache } from './user-profile-image-cache.service';

const image: UserProfileImageRef = {
  referenceId: 'profile-image-1',
  mimeType: 'image/png',
  sizeBytes: '4',
  width: 1,
  height: 1,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
};

function ok<T>(value: T, requestId = 'profile-image-test'): Result<T> {
  return { ok: true, value, version: 1, requestId };
}

function createPort() {
  const stream: UserProfileImageStreamRef = {
    referenceId: image.referenceId,
    streamId: 'stream-1',
    expiresAt: image.expiresAt,
    chunkSize: 64 * 1024,
  };
  const chunk: UserProfileImageChunk = {
    referenceId: image.referenceId,
    streamId: stream.streamId,
    sequence: 0,
    bytes: Uint8Array.from([1, 2, 3, 4]).buffer,
    done: true,
  };
  const port = {
    openImage: vi.fn(async () => ok(stream)),
    readImage: vi.fn(async () => ok(chunk)),
    closeImage: vi.fn(async () => ok(undefined)),
  } as unknown as UserProfilePort;
  return port;
}

describe('UserProfileImageCache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('deduplicates concurrent streams and reuses one object URL', async () => {
    const port = createPort();
    const createObjectURL = vi.fn(() => 'blob:profile-image-1');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    TestBed.configureTestingModule({
      providers: [{ provide: USER_PROFILE_PORT, useValue: port }],
    });
    const cache = TestBed.inject(UserProfileImageCache);

    const first = cache.get(image, 'operator@example.invalid');
    const second = cache.get(image, 'operator@example.invalid');

    await expect(first).resolves.toBe('blob:profile-image-1');
    await expect(second).resolves.toBe('blob:profile-image-1');
    expect(port.openImage).toHaveBeenCalledOnce();
    expect(port.readImage).toHaveBeenCalledOnce();
    expect(port.closeImage).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
  });

  it('rejects a stream whose byte count differs from the validated reference', async () => {
    const port = createPort();
    const readImage = port.readImage as ReturnType<typeof vi.fn>;
    readImage.mockResolvedValueOnce(
      ok({
        referenceId: image.referenceId,
        streamId: 'stream-1',
        sequence: 0,
        bytes: Uint8Array.from([1, 2]).buffer,
        done: true,
      } satisfies UserProfileImageChunk),
    );
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:invalid'),
      revokeObjectURL: vi.fn(),
    });
    TestBed.configureTestingModule({
      providers: [{ provide: USER_PROFILE_PORT, useValue: port }],
    });
    const cache = TestBed.inject(UserProfileImageCache);

    await expect(cache.get(image, 'operator@example.invalid')).rejects.toThrow('incompleta');
    expect(port.closeImage).toHaveBeenCalledOnce();
  });

  it('revokes cached URLs when an account session is cleared', async () => {
    const port = createPort();
    const createObjectURL = vi.fn(() => 'blob:profile-image-1');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    TestBed.configureTestingModule({
      providers: [{ provide: USER_PROFILE_PORT, useValue: port }],
    });
    const cache = TestBed.inject(UserProfileImageCache);

    await cache.get(image, 'operator@example.invalid');
    cache.clearAccount('operator@example.invalid');

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:profile-image-1');
  });
});
