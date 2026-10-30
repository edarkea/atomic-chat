import { Injectable, computed, inject, signal } from '@angular/core';
import { StickerLibrarySnapshot, StickerRecord, Result } from './domain';
import { createOpaqueId } from './ids';
import { STICKER_LIBRARY_PORT, StickerLibraryPort } from './ports';

@Injectable({ providedIn: 'root' })
export class StickerLibraryFacade {
  private readonly port = inject<StickerLibraryPort | null>(STICKER_LIBRARY_PORT, { optional: true });
  private readonly account = signal('');
  private readonly generation = signal(0);
  readonly query = signal('');
  readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly error = signal<string | null>(null);
  readonly selectedCollection = signal<'my-stickers' | undefined>(undefined);
  readonly selectedSticker = signal<StickerRecord | undefined>(undefined);
  readonly stickers = signal<ReadonlyArray<StickerRecord>>([]);
  readonly packs = computed(() => [] as const);
  readonly selectedPack = computed(() => undefined);

  async load(accountId: string): Promise<void> {
    if (!accountId.trim()) {
      this.account.set('');
      this.stickers.set([]);
      this.state.set('idle');
      return;
    }
    this.account.set(accountId);
    this.selectedCollection.set('my-stickers');
    const current = this.generation() + 1;
    this.generation.set(current);
    this.state.set('loading');
    this.error.set(null);
    if (!this.port) {
      this.state.set('error');
      this.error.set('Los stickers locales no están disponibles.');
      return;
    }
    const result = await this.port.list({ version: 1, requestId: createOpaqueId('stickers-list'), accountId, query: this.query(), limit: 250 });
    if (current !== this.generation()) return;
    if (!result.ok) {
      this.state.set('error');
      this.error.set(result.error.code === 'UNSUPPORTED' ? 'Los stickers locales no están disponibles.' : 'No se pudo cargar Mis stickers.');
      return;
    }
    this.applySnapshot(result);
  }

  selectCollection(collectionId: 'my-stickers'): void {
    this.selectedCollection.set(collectionId);
    if (this.account()) void this.load(this.account());
  }

  selectPack(_packId: string): void {
    // E8.3 packages are intentionally outside E8.2.
  }

  setQuery(value: string): void {
    this.query.set(value.slice(0, 128));
    if (this.account()) void this.load(this.account());
  }

  selectSticker(sticker: StickerRecord): void { this.selectedSticker.set(sticker); }

  async importSticker(): Promise<void> {
    const accountId = this.account();
    if (!accountId) return;
    if (!this.port) { this.error.set('Los stickers locales no están disponibles.'); return; }
    this.state.set('loading');
    const result = await this.port.import({ version: 1, requestId: createOpaqueId('sticker-import'), accountId });
    if (!result.ok) {
      this.state.set('error');
      this.error.set(result.error.code === 'RESOURCE_CONSTRAINT' ? 'Se alcanzó el límite local de stickers.' : 'No se pudo importar el sticker.');
      return;
    }
    await this.load(accountId);
  }

  async remove(stickerId: string): Promise<void> {
    const accountId = this.account();
    if (!accountId) return;
    if (!this.port) { this.error.set('Los stickers locales no están disponibles.'); return; }
    const result = await this.port.delete({ version: 1, requestId: createOpaqueId('sticker-delete'), accountId, stickerId });
    if (!result.ok) {
      this.error.set('No se pudo eliminar el sticker.');
      return;
    }
    if (this.selectedSticker()?.stickerId === stickerId) this.selectedSticker.set(undefined);
    await this.load(accountId);
  }

  private applySnapshot(result: Result<StickerLibrarySnapshot>): void {
    if (!result.ok) return;
    this.stickers.set(result.value.stickers);
    this.state.set('ready');
    this.error.set(null);
  }
}
