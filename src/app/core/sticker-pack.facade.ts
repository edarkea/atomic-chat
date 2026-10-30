import { Injectable, computed, inject, signal } from '@angular/core';
import {
  Result,
  StickerDraftDTO,
  StickerPackDTO,
  StickerPackListSnapshot,
  StickerDraftListSnapshot,
} from './domain';
import { createOpaqueId } from './ids';
import { STICKER_PACK_PORT, StickerPackPort } from './ports';

@Injectable({ providedIn: 'root' })
export class StickerPackFacade {
  private readonly port = inject<StickerPackPort | null>(STICKER_PACK_PORT, { optional: true });
  private readonly account = signal('');
  private readonly generation = signal(0);
  readonly packs = signal<ReadonlyArray<StickerPackDTO>>([]);
  readonly drafts = signal<ReadonlyArray<StickerDraftDTO>>([]);
  readonly draft = signal<StickerDraftDTO | undefined>(undefined);
  readonly state = signal<'idle' | 'loading' | 'ready' | 'saving' | 'error'>('idle');
  readonly error = signal<string | null>(null);
  readonly selectedPackId = signal<string | undefined>(undefined);
  readonly selectedPack = computed(() => this.packs().find((pack) => pack.packId === this.selectedPackId()));

  selectPack(packId: string | undefined): void { this.selectedPackId.set(packId); }

  async load(accountId: string): Promise<void> {
    const normalized = accountId.trim();
    const switched = this.account() !== normalized;
    const current = this.generation() + 1;
    this.generation.set(current);
    this.account.set(normalized);
    this.packs.set([]);
    this.drafts.set([]);
    this.draft.set(undefined);
    if (switched) this.selectedPackId.set(undefined);
    if (!normalized) { this.state.set('idle'); return; }
    if (!this.port) { this.state.set('error'); this.error.set('El Sticker Studio no está disponible.'); return; }
    this.state.set('loading');
    this.error.set(null);
    const request = { version: 1 as const, requestId: createOpaqueId('sticker-packs-list'), accountId: normalized };
    const [packs, drafts] = await Promise.all([this.port.list(request), this.port.listDrafts({ ...request, requestId: createOpaqueId('sticker-drafts-list') })]);
    if (!this.isCurrent(normalized, current)) return;
    if (!packs.ok || !drafts.ok) { this.state.set('error'); this.error.set('No se pudieron cargar los paquetes locales.'); return; }
    this.applyPacks(packs);
    this.applyDrafts(drafts);
    this.state.set('ready');
  }

  async createDraft(basePackId?: string): Promise<void> {
    const accountId = this.account();
    if (!accountId || !this.port) return;
    const current = this.generation();
    this.state.set('saving');
    const result = await this.port.createDraft({ version: 1, requestId: createOpaqueId('sticker-draft-create'), accountId, ...(basePackId ? { basePackId } : {}) });
    if (!this.isCurrent(accountId, current)) return;
    if (!result.ok) { this.fail(result.error.code); return; }
    this.draft.set(result.value);
    this.state.set('ready');
    this.error.set(null);
  }

  async updateDraft(name: string, description: string, stickerIds: readonly string[]): Promise<boolean> {
    const accountId = this.account();
    const draft = this.draft();
    if (!accountId || !draft || !this.port) return false;
    const current = this.generation();
    this.state.set('saving');
    const result = await this.port.updateDraft({ version: 1, requestId: createOpaqueId('sticker-draft-update'), accountId, draftId: draft.draftId, revision: draft.revision, name, description, stickerIds });
    if (!this.isCurrent(accountId, current)) return false;
    if (!result.ok) { this.fail(result.error.code); return false; }
    this.draft.set(result.value);
    this.state.set('ready');
    this.error.set(null);
    return true;
  }

  async commitDraft(): Promise<void> {
    const accountId = this.account();
    const draft = this.draft();
    if (!accountId || !draft || !this.port) return;
    const current = this.generation();
    this.state.set('saving');
    const result = await this.port.commitDraft({ version: 1, requestId: createOpaqueId('sticker-draft-commit'), accountId, draftId: draft.draftId, revision: draft.revision });
    if (!this.isCurrent(accountId, current)) return;
    if (!result.ok) { this.fail(result.error.code); return; }
    this.selectedPackId.set(result.value.packId);
    await this.load(accountId);
  }

  async discardDraft(): Promise<void> {
    const accountId = this.account();
    const draft = this.draft();
    if (!accountId || !draft || !this.port) return;
    const current = this.generation();
    this.state.set('saving');
    const result = await this.port.discardDraft({ version: 1, requestId: createOpaqueId('sticker-draft-discard'), accountId, draftId: draft.draftId, revision: draft.revision });
    if (!this.isCurrent(accountId, current)) return;
    if (!result.ok) { this.fail(result.error.code); return; }
    this.draft.set(undefined);
    await this.load(accountId);
  }

  async deletePack(pack: StickerPackDTO): Promise<void> {
    const accountId = this.account();
    if (!accountId || !this.port) return;
    const current = this.generation();
    this.state.set('saving');
    const result = await this.port.delete({ version: 1, requestId: createOpaqueId('sticker-pack-delete'), accountId, packId: pack.packId, revision: pack.revision });
    if (!this.isCurrent(accountId, current)) return;
    if (!result.ok) { this.fail(result.error.code); return; }
    if (this.selectedPackId() === pack.packId) this.selectedPackId.set(undefined);
    await this.load(accountId);
  }

  reset(): void {
    this.generation.set(this.generation() + 1);
    this.account.set('');
    this.packs.set([]);
    this.drafts.set([]);
    this.draft.set(undefined);
    this.selectedPackId.set(undefined);
    this.state.set('idle');
    this.error.set(null);
  }

  private applyPacks(result: Result<StickerPackListSnapshot>): void { if (result.ok) this.packs.set(result.value.packs); }
  private applyDrafts(result: Result<StickerDraftListSnapshot>): void {
    if (!result.ok) return;
    this.drafts.set(result.value.drafts);
    this.draft.set(result.value.drafts[0]);
  }
  private fail(code: string): void {
    this.state.set('error');
    this.error.set(code === 'CONFLICT' ? 'El paquete cambió en otra ventana. Vuelve a cargarlo.' : code === 'UNSUPPORTED' ? 'El Sticker Studio no está disponible.' : 'No se pudo guardar el paquete local.');
  }
  private isCurrent(accountId: string, generation: number): boolean { return this.account() === accountId && this.generation() === generation; }
}
