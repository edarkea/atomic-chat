import { computed, signal, type Signal } from '@angular/core';
import type { Preferences, Result, UpdateStatus } from '../domain';

export type PreferencesSaveState = 'idle' | 'saving' | 'saved' | 'error';

export interface PreferencesCoordinatorChat {
  readonly preferences: Signal<Preferences>;
  readonly error: Signal<string | null>;
  updatePreferences(changes: Partial<Preferences>): Promise<boolean>;
  resetPreferences(): Promise<boolean>;
  selectDownloadDirectory(): Promise<Result<string | null>>;
}

export interface PreferencesCoordinatorUpdates {
  readonly status: Signal<UpdateStatus>;
  readonly busy: Signal<boolean>;
  readonly error: Signal<string | null>;
  check(): Promise<void>;
  download(): Promise<void>;
  install(): Promise<void>;
}

export interface PreferencesCoordinatorDependencies {
  readonly chat: PreferencesCoordinatorChat;
  readonly updates: PreferencesCoordinatorUpdates;
  readonly resetTheme: () => void;
}

export interface PreferencesDialogViewModel {
  readonly preferences: Preferences;
  readonly downloadDirectorySelecting: boolean;
  readonly saveState: PreferencesSaveState;
  readonly error: string | null;
  readonly updateStatus: UpdateStatus;
  readonly updateBusy: boolean;
  readonly updateError: string | null;
}

export class PreferencesCoordinator {
  readonly open = signal(false);
  readonly saveState = signal<PreferencesSaveState>('idle');
  readonly error = signal<string | null>(null);
  readonly downloadDirectorySelecting = signal(false);
  readonly dialogModel = computed<PreferencesDialogViewModel>(() => ({
    preferences: this.dependencies.chat.preferences(),
    downloadDirectorySelecting: this.downloadDirectorySelecting(),
    saveState: this.saveState(),
    error: this.error(),
    updateStatus: this.dependencies.updates.status(),
    updateBusy: this.dependencies.updates.busy(),
    updateError: this.dependencies.updates.error(),
  }));

  private destroyed = false;
  private operationGeneration = 0;

  constructor(private readonly dependencies: PreferencesCoordinatorDependencies) {}

  openDialog(): void {
    if (this.destroyed) return;
    this.error.set(null);
    this.saveState.set('idle');
    this.open.set(true);
  }

  closeDialog(): void {
    if (this.destroyed) return;
    this.open.set(false);
    this.saveState.set('idle');
  }

  async reset(): Promise<void> {
    if (this.destroyed) return;
    const generation = ++this.operationGeneration;
    this.saveState.set('saving');
    this.error.set(null);
    const saved = await this.dependencies.chat.resetPreferences();
    if (this.destroyed || generation !== this.operationGeneration) return;
    if (saved) {
      this.dependencies.resetTheme();
      this.saveState.set('saved');
      return;
    }
    this.saveState.set('error');
    this.error.set(
      this.dependencies.chat.error() || 'No fue posible restablecer las preferencias.',
    );
  }

  async save(changes: Partial<Preferences>): Promise<void> {
    if (this.destroyed) return;
    const generation = ++this.operationGeneration;
    await this.saveWithGeneration(changes, generation);
  }

  private async saveWithGeneration(
    changes: Partial<Preferences>,
    generation: number,
  ): Promise<void> {
    this.saveState.set('saving');
    this.error.set(null);
    const saved = await this.dependencies.chat.updatePreferences(changes);
    if (this.destroyed || generation !== this.operationGeneration) return;
    if (saved) {
      this.saveState.set('saved');
      return;
    }
    this.saveState.set('error');
    this.error.set(this.dependencies.chat.error() || 'No fue posible guardar la preferencia.');
  }

  async selectDownloadDirectory(): Promise<void> {
    if (this.destroyed || this.downloadDirectorySelecting()) return;
    const generation = ++this.operationGeneration;
    this.downloadDirectorySelecting.set(true);
    this.error.set(null);
    try {
      const result = await this.dependencies.chat.selectDownloadDirectory();
      if (this.destroyed || generation !== this.operationGeneration) return;
      if (!result.ok) {
        this.saveState.set('error');
        this.error.set(result.error.message);
      } else if (result.value) {
        await this.saveWithGeneration({ downloadDirectory: result.value }, generation);
      }
    } finally {
      if (!this.destroyed) this.downloadDirectorySelecting.set(false);
    }
  }

  checkForUpdates(): void {
    if (!this.destroyed) void this.dependencies.updates.check();
  }

  downloadUpdate(): void {
    if (!this.destroyed) void this.dependencies.updates.download();
  }

  installUpdate(): void {
    if (!this.destroyed) void this.dependencies.updates.install();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.operationGeneration += 1;
    this.downloadDirectorySelecting.set(false);
    this.open.set(false);
  }
}
