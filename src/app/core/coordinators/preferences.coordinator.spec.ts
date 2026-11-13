import { signal } from '@angular/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PreferencesCoordinator } from './preferences.coordinator';
import type { Preferences, Result, UpdateStatus } from '../domain';

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

describe('PreferencesCoordinator', () => {
  let coordinator: PreferencesCoordinator;
  type UpdatePreferences = (changes: Partial<Preferences>) => Promise<boolean>;
  type ResetPreferences = () => Promise<boolean>;
  type SelectDownloadDirectory = () => Promise<Result<string | null>>;
  type UpdateAction = () => Promise<void>;
  let updatePreferences: ReturnType<typeof vi.fn<UpdatePreferences>>;
  let resetPreferences: ReturnType<typeof vi.fn<ResetPreferences>>;
  let selectDownloadDirectory: ReturnType<typeof vi.fn<SelectDownloadDirectory>>;
  let resetTheme: ReturnType<typeof vi.fn<() => void>>;
  let updates: {
    status: ReturnType<typeof signal<UpdateStatus>>;
    busy: ReturnType<typeof signal<boolean>>;
    error: ReturnType<typeof signal<string | null>>;
    check: ReturnType<typeof vi.fn<UpdateAction>>;
    download: ReturnType<typeof vi.fn<UpdateAction>>;
    install: ReturnType<typeof vi.fn<UpdateAction>>;
  };
  const error = signal<string | null>(null);
  const preferences = signal<Preferences>({
    theme: 'atomic',
    notifications: true,
    autoAcceptFileTransfers: false,
    autoLogin: false,
    hideClosedConversations: false,
    fileTransferTimeoutSeconds: 300,
    downloadDirectory: '',
  });

  beforeEach(() => {
    updatePreferences = vi.fn<UpdatePreferences>(async () => true);
    resetPreferences = vi.fn<ResetPreferences>(async () => true);
    selectDownloadDirectory = vi.fn<SelectDownloadDirectory>(async () => ({
      ok: true,
      value: 'C:/downloads',
      version: 1,
      requestId: 'directory-1',
    }));
    resetTheme = vi.fn<() => void>();
    updates = {
      status: signal<UpdateStatus>({ version: 1, state: 'idle', currentVersion: '0.0.0' }),
      busy: signal(false),
      error: signal<string | null>(null),
      check: vi.fn<UpdateAction>(async () => undefined),
      download: vi.fn<UpdateAction>(async () => undefined),
      install: vi.fn<UpdateAction>(async () => undefined),
    };
    error.set(null);
    coordinator = new PreferencesCoordinator({
      chat: { preferences, error, updatePreferences, resetPreferences, selectDownloadDirectory },
      updates,
      resetTheme,
    });
  });

  it('coordinates opening, saving and resetting without owning persistence', async () => {
    coordinator.openDialog();
    expect(coordinator.open()).toBe(true);
    await coordinator.save({ notifications: false });
    expect(updatePreferences).toHaveBeenCalledWith({ notifications: false });
    expect(coordinator.saveState()).toBe('saved');

    await coordinator.reset();
    expect(resetPreferences).toHaveBeenCalledOnce();
    expect(resetTheme).toHaveBeenCalledOnce();
    expect(coordinator.saveState()).toBe('saved');
  });

  it('reports a failed save through the visual state', async () => {
    updatePreferences.mockResolvedValueOnce(false);
    error.set('storage failed');

    await coordinator.save({ notifications: false });

    expect(coordinator.saveState()).toBe('error');
    expect(coordinator.error()).toBe('storage failed');
  });

  it('exposes the complete preferences dialog model', () => {
    coordinator.openDialog();
    expect(coordinator.dialogModel()).toMatchObject({
      preferences: preferences(),
      downloadDirectorySelecting: false,
      saveState: 'idle',
      error: null,
      updateStatus: updates.status(),
      updateBusy: false,
      updateError: null,
    });
  });

  it('clears directory selection after the chained preference save', async () => {
    await coordinator.selectDownloadDirectory();

    expect(selectDownloadDirectory).toHaveBeenCalledOnce();
    expect(updatePreferences).toHaveBeenCalledWith({ downloadDirectory: 'C:/downloads' });
    expect(coordinator.downloadDirectorySelecting()).toBe(false);
    expect(coordinator.saveState()).toBe('saved');
  });

  it('ignores an operation that resolves after destruction', async () => {
    const pending = deferred<boolean>();
    resetPreferences.mockReturnValueOnce(pending.promise);
    const operation = coordinator.reset();

    coordinator.destroy();
    pending.resolve(true);
    await operation;

    expect(resetTheme).not.toHaveBeenCalled();
    expect(coordinator.open()).toBe(false);
  });

  it('delegates update actions and resets dialog state on close', () => {
    coordinator.openDialog();
    coordinator.checkForUpdates();
    coordinator.downloadUpdate();
    coordinator.installUpdate();
    coordinator.closeDialog();

    expect(updates.check).toHaveBeenCalledOnce();
    expect(updates.download).toHaveBeenCalledOnce();
    expect(updates.install).toHaveBeenCalledOnce();
    expect(coordinator.open()).toBe(false);
    expect(coordinator.saveState()).toBe('idle');
  });
});
