import { describe, expect, it, vi } from 'vitest';
import type { Result, UserProfile } from '../domain';
import type { UserProfilePort } from '../ports';
import { UserProfileCoordinator } from './user-profile.coordinator';

const profile: UserProfile = {
  accountId: 'operator@example.invalid',
  jid: 'contact@example.invalid',
  source: 'vcard-temp',
  displayName: 'Profile name',
  fetchedAt: '2026-11-14T00:00:00.000Z',
};

function ok<T>(value: T, requestId = 'profile-1'): Result<T> {
  return { ok: true, value, version: 1, requestId };
}

function unavailable(requestId = 'profile-1'): Result<UserProfile> {
  return {
    ok: false,
    version: 1,
    error: {
      code: 'PROFILE_UNAVAILABLE',
      retryable: false,
      requestId,
      message: 'El perfil no está disponible.',
    },
  };
}

function coordinator(get: UserProfilePort['get']) {
  const reportError = vi.fn();
  const value = new UserProfileCoordinator({
    port: {
      get,
      update: vi.fn(),
      updateAvatar: vi.fn(),
      clearAvatar: vi.fn(),
      openImage: vi.fn(),
      readImage: vi.fn(),
      closeImage: vi.fn(),
      revokeImage: vi.fn(),
    },
    accountId: () => 'operator@example.invalid',
    identityGeneration: () => 4,
    isCurrent: () => true,
    isConnected: () => true,
    reportError,
  });
  return { value, reportError };
}

describe('UserProfileCoordinator', () => {
  it('loads only the requested conversation profile and publishes the result', async () => {
    const get = vi.fn(async () => ok(profile));
    const { value, reportError } = coordinator(get);

    await value.load('contact@example.invalid');

    expect(get).toHaveBeenCalledWith({
      version: 1,
      requestId: expect.any(String),
      accountId: 'operator@example.invalid',
      jid: 'contact@example.invalid',
    });
    expect(value.profile()).toEqual(profile);
    expect(reportError).not.toHaveBeenCalled();
  });

  it('drops an obsolete response after a newer request', async () => {
    let release: ((result: Result<UserProfile>) => void) | undefined;
    const get = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<Result<UserProfile>>((resolve) => (release = resolve)),
      )
      .mockResolvedValueOnce(ok({ ...profile, jid: 'second@example.invalid' }));
    const { value } = coordinator(get);

    const first = value.load('first@example.invalid');
    const second = value.load('second@example.invalid');
    release?.(ok({ ...profile, jid: 'first@example.invalid' }));
    await first;
    await second;

    expect(value.profile()?.jid).toBe('second@example.invalid');
  });

  it('uses the cached profile without issuing another request', async () => {
    const get = vi.fn(async () => ok(profile));
    const { value } = coordinator(get);

    value.useCached(profile);
    await value.load(profile.jid);

    expect(value.profile()).toBe(profile);
    expect(get).not.toHaveBeenCalled();
  });

  it('keeps profile unavailability local instead of raising a conversation error', async () => {
    const get = vi.fn(async () => unavailable());
    const { value, reportError } = coordinator(get);

    await value.load('contact@example.invalid');

    expect(value.profile()).toBeNull();
    expect(value.error()).toBe('El perfil no está disponible.');
    expect(reportError).not.toHaveBeenCalled();
  });
});
