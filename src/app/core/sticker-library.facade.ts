import { Injectable, computed, inject, signal } from '@angular/core';
import { StickerLibrarySnapshot, StickerRecord, Result } from './domain';
import { createOpaqueId } from './ids';
import { STICKER_LIBRARY_PORT, StickerLibraryPort } from './ports';

@Injectable({ providedIn: 'root' })
export class StickerLibraryFacade {
  private readonly port = inject<StickerLibraryPort | null>(STICKER_LIBRARY_PORT, { optional: true });
  private readonly account = signal('');
  private readonly generation = signal(0);
  private readonly allAccount = signal('');
  private allGeneration = 0;
  readonly query = signal('');
  readonly state = signal<'idle' | 'loading' | 'ready' | 'error'>('idle');
  readonly error = signal<string | null>(null);
  readonly selectedCollection = signal<StickerLibrarySnapshot['collectionId'] | undefined>(undefined);
  readonly selectedPackId = signal<string | undefined>(undefined);
  readonly selectedSticker = signal<StickerRecord | undefined>(undefined);
  readonly stickers = signal<ReadonlyArray<StickerRecord>>([]);
  readonly allStickers = signal<ReadonlyArray<StickerRecord>>([]);
  readonly packs = computed(() => [] as const);
  readonly selectedPack = computed(() => undefined);

  async load(accountId: string): Promise<void> {
    const normalizedAccountId = accountId.trim();
    const switchedAccount = this.account() !== normalizedAccountId;
    const current = this.generation() + 1;
    this.generation.set(current);
    this.account.set(normalizedAccountId);
    if (switchedAccount) {
      this.stickers.set([]);
      this.allStickers.set([]);
      this.allGeneration += 1;
      this.allAccount.set(normalizedAccountId);
      this.selectedSticker.set(undefined);
      this.selectedCollection.set(normalizedAccountId ? 'my-stickers' : undefined);
      this.selectedPackId.set(undefined);
      this.query.set('');
      this.error.set(null);
    }
    if (!normalizedAccountId) {
      this.state.set('idle');
      return;
    }
    const packId = this.selectedPackId();
    this.selectedCollection.set(packId ? `pack:${packId}` : 'my-stickers');
    this.state.set('loading');
    this.error.set(null);
    if (!this.port) {
      this.state.set('error');
      this.error.set('Los stickers locales no están disponibles.');
      return;
    }
    const result = await this.port.list({ version: 1, requestId: createOpaqueId('stickers-list'), accountId: normalizedAccountId, query: this.query(), limit: 250, ...(packId ? { packId } : {}) });
    if (!this.isCurrentContext(normalizedAccountId, current)) return;
    if (!result.ok) {
      this.state.set('error');
      this.error.set(result.error.code === 'UNSUPPORTED' ? 'Los stickers locales no están disponibles.' : 'No se pudo cargar Mis stickers.');
      return;
    }
    this.applySnapshot(result);
  }

  async loadAll(accountId: string): Promise<void> {
    const normalizedAccountId = accountId.trim();
    const current = ++this.allGeneration;
    this.allAccount.set(normalizedAccountId);
    if (!normalizedAccountId) {
      this.allStickers.set([]);
      return;
    }
    if (!this.port) {
      this.allStickers.set([]);
      return;
    }
    try {
      const result = await this.port.list({
        version: 1,
        requestId: createOpaqueId('stickers-all'),
        accountId: normalizedAccountId,
        query: '',
        limit: 250,
      });
      if (this.allAccount() !== normalizedAccountId || this.allGeneration !== current) return;
      this.allStickers.set(result.ok ? result.value.stickers : []);
    } catch {
      if (this.allAccount() === normalizedAccountId && this.allGeneration === current) this.allStickers.set([]);
    }
  }

  selectCollection(collectionId: 'my-stickers'): void {
    this.selectedPackId.set(undefined);
    this.selectedCollection.set(collectionId);
    if (this.account()) void this.load(this.account());
  }

  selectPack(packId: string): void {
    const normalized = packId.trim();
    if (!normalized) return;
    this.selectedPackId.set(normalized);
    this.selectedCollection.set(`pack:${normalized}`);
    if (this.account()) void this.load(this.account());
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
    const current = this.generation();
    this.state.set('loading');
    const result = await this.port.import({ version: 1, requestId: createOpaqueId('sticker-import'), accountId });
    if (!this.isCurrentContext(accountId, current)) return;
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
    const current = this.generation();
    const result = await this.port.delete({ version: 1, requestId: createOpaqueId('sticker-delete'), accountId, stickerId });
    if (!this.isCurrentContext(accountId, current)) return;
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
    const selected = this.selectedSticker();
    if (selected && !result.value.stickers.some((sticker) => sticker.stickerId === selected.stickerId))
      this.selectedSticker.set(undefined);
    this.state.set('ready');
    this.error.set(null);
  }

  reset(): void {
    this.generation.set(this.generation() + 1);
    this.allGeneration += 1;
    this.account.set('');
    this.allAccount.set('');
    this.query.set('');
    this.stickers.set([]);
    this.allStickers.set([]);
    this.selectedSticker.set(undefined);
    this.selectedCollection.set(undefined);
    this.selectedPackId.set(undefined);
    this.state.set('idle');
    this.error.set(null);
  }

  private isCurrentContext(accountId: string, generation: number): boolean {
    return this.account() === accountId && this.generation() === generation;
  }
}
