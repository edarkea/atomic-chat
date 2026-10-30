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

export interface StickerDraftSnapshot {
  readonly name: string;
  readonly description: string;
  readonly stickerIds: readonly string[];
}

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
  readonly selectedDraftId = signal<string | undefined>(undefined);
  readonly selectedPack = computed(() => this.packs().find((pack) => pack.packId === this.selectedPackId()));
  private readonly draftQueues = new Map<string, Promise<unknown>>();
  private navigationQueue: Promise<unknown> = Promise.resolve();

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
    this.selectedDraftId.set(undefined);
    if (switched) this.selectedPackId.set(undefined);
    if (!normalized) { this.state.set('idle'); return; }
    if (!this.port) { this.state.set('error'); this.error.set('El Sticker Studio no está disponible.'); return; }
    this.state.set('loading');
    this.error.set(null);
    const request = { version: 1 as const, requestId: createOpaqueId('sticker-packs-list'), accountId: normalized };
    let packs: Result<StickerPackListSnapshot>;
    let drafts: Result<StickerDraftListSnapshot>;
    try {
      [packs, drafts] = await Promise.all([this.port.list(request), this.port.listDrafts({ ...request, requestId: createOpaqueId('sticker-drafts-list') })]);
    } catch {
      if (this.isCurrent(normalized, current)) { this.state.set('error'); this.error.set('No se pudieron cargar los paquetes locales.'); }
      return;
    }
    if (!this.isCurrent(normalized, current)) return;
    if (!packs.ok || !drafts.ok) { this.state.set('error'); this.error.set('No se pudieron cargar los paquetes locales.'); return; }
    this.applyPacks(packs);
    this.applyDrafts(drafts);
    this.state.set('ready');
  }

  async createDraft(snapshot?: StickerDraftSnapshot): Promise<boolean> {
    const accountId = this.account();
    const originGeneration = this.generation();
    const originDraftId = this.draft()?.draftId;
    if (!accountId || !this.port) return false;
    return this.enqueueNavigation(async () => {
      if (!this.isCurrentAccount(accountId, originGeneration)) return false;
      if (!await this.persistCurrentSnapshot(snapshot)) return false;
      if (this.draft()?.draftId !== originDraftId) return false;
      this.selectedPackId.set(undefined);
      return this.createDraftInternal(undefined);
    });
  }

  async openPack(packId: string, snapshot?: StickerDraftSnapshot): Promise<boolean> {
    const accountId = this.account();
    const originGeneration = this.generation();
    if (!accountId || !this.port || !packId.trim()) return false;
    const normalizedPackId = packId.trim();
    return this.enqueueNavigation(async () => {
      if (!this.isCurrentAccount(accountId, originGeneration)) return false;
      if (!await this.persistCurrentSnapshot(snapshot)) return false;
      this.selectedPackId.set(normalizedPackId);
      const existing = this.findActiveDraftForPack(normalizedPackId);
      if (existing) return this.openDraftInternal(existing.draftId);
      return this.createDraftInternal(normalizedPackId);
    });
  }

  async openDraft(draftId: string, snapshot?: StickerDraftSnapshot): Promise<boolean> {
    const accountId = this.account();
    const originGeneration = this.generation();
    if (!accountId || !this.port || !draftId.trim()) return false;
    const normalizedDraftId = draftId.trim();
    return this.enqueueNavigation(async () => {
      if (!this.isCurrentAccount(accountId, originGeneration)) return false;
      if (!await this.persistCurrentSnapshot(snapshot)) return false;
      return this.openDraftInternal(normalizedDraftId);
    });
  }

  async updateDraft(name: string, description: string, stickerIds: readonly string[]): Promise<boolean> {
    const accountId = this.account();
    const draft = this.draft();
    if (!accountId || !draft || !this.port) return false;
    this.state.set('saving');
    const snapshot: StickerDraftSnapshot = { name, description, stickerIds: [...stickerIds] };
    return this.enqueueDraftMutation(draft.draftId, () => this.persistDraftSnapshot(accountId, draft.draftId, snapshot)).then((result) => Boolean(result));
  }

  async commitDraft(snapshot: StickerDraftSnapshot): Promise<void> {
    const accountId = this.account();
    const draft = this.draft();
    if (!accountId || !draft || !this.port) return;
    this.state.set('saving');
    await this.enqueueDraftMutation(draft.draftId, async () => {
      const currentGeneration = this.generation();
      let currentDraft = this.draft();
      if (!this.isCurrent(accountId, currentGeneration) || !currentDraft || currentDraft.draftId !== draft.draftId) return;
      if (!this.sameSnapshot(currentDraft, snapshot)) {
        const persisted = await this.persistDraftSnapshot(accountId, draft.draftId, snapshot);
        if (!persisted) return;
        currentDraft = persisted;
      }
      if (!this.isCurrent(accountId, currentGeneration)) return;
      this.state.set('saving');
      try {
        const result = await this.port!.commitDraft({ version: 1, requestId: createOpaqueId('sticker-draft-commit'), accountId, draftId: draft.draftId, revision: currentDraft.revision });
        if (!this.isCurrent(accountId, currentGeneration)) return;
        if (!result.ok) { this.fail(result.error.code); return; }
        this.selectedPackId.set(result.value.packId);
        await this.load(accountId);
      } catch {
        if (this.isCurrent(accountId, currentGeneration)) this.fail('STORAGE_FAILED');
      }
    });
  }

  async discardDraft(): Promise<void> {
    const accountId = this.account();
    const draft = this.draft();
    if (!accountId || !draft || !this.port) return;
    const current = this.generation();
    this.state.set('saving');
    let result: Result<void>;
    try {
      result = await this.port.discardDraft({ version: 1, requestId: createOpaqueId('sticker-draft-discard'), accountId, draftId: draft.draftId, revision: draft.revision });
    } catch {
      if (this.isCurrent(accountId, current)) this.fail('STORAGE_FAILED');
      return;
    }
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
    let result: Result<void>;
    try {
      result = await this.port.delete({ version: 1, requestId: createOpaqueId('sticker-pack-delete'), accountId, packId: pack.packId, revision: pack.revision });
    } catch {
      if (this.isCurrent(accountId, current)) this.fail('STORAGE_FAILED');
      return;
    }
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
    this.selectedDraftId.set(undefined);
    this.state.set('idle');
    this.error.set(null);
  }

  private applyPacks(result: Result<StickerPackListSnapshot>): void { if (result.ok) this.packs.set(result.value.packs); }
  private applyDrafts(result: Result<StickerDraftListSnapshot>): void {
    if (!result.ok) return;
    this.drafts.set(result.value.drafts);
    this.draft.set(undefined);
    this.selectedDraftId.set(undefined);
  }
  private async createDraftInternal(basePackId: string | undefined): Promise<boolean> {
    const accountId = this.account();
    const current = this.generation();
    if (!accountId || !this.port) return false;
    if (basePackId) {
      const existing = this.findActiveDraftForPack(basePackId);
      if (existing) return this.openDraftInternal(existing.draftId);
    }
    this.state.set('saving');
    let result: Result<StickerDraftDTO>;
    try {
      result = await this.port.createDraft({ version: 1, requestId: createOpaqueId('sticker-draft-create'), accountId, ...(basePackId ? { basePackId } : {}) });
    } catch {
      if (this.isCurrent(accountId, current)) this.fail('STORAGE_FAILED');
      return false;
    }
    if (!this.isCurrent(accountId, current)) return false;
    if (!result.ok) { this.fail(result.error.code); return false; }
    this.rememberDraft(result.value);
    this.setCurrentDraft(result.value);
    this.state.set('ready');
    this.error.set(null);
    return true;
  }
  private async openDraftInternal(draftId: string): Promise<boolean> {
    const accountId = this.account();
    const current = this.generation();
    if (!accountId || !this.port) return false;
    const known = this.drafts().find((item) => item.draftId === draftId);
    if (known) {
      this.setCurrentDraft(known);
      this.state.set('ready');
      this.error.set(null);
      return true;
    }
    this.state.set('loading');
    try {
      const result = await this.port.getDraft({ version: 1, requestId: createOpaqueId('sticker-draft-get'), accountId, draftId });
      if (!this.isCurrent(accountId, current)) return false;
      if (!result.ok) { this.fail(result.error.code); return false; }
      this.rememberDraft(result.value);
      this.setCurrentDraft(this.drafts().find((item) => item.draftId === result.value.draftId) || result.value);
      this.state.set('ready');
      this.error.set(null);
      return true;
    } catch {
      if (this.isCurrent(accountId, current)) this.fail('STORAGE_FAILED');
      return false;
    }
  }
  private async persistCurrentSnapshot(snapshot?: StickerDraftSnapshot): Promise<boolean> {
    const current = this.draft();
    if (!current || !snapshot || this.sameSnapshot(current, snapshot)) return true;
    const result = await this.enqueueDraftMutation(current.draftId, () => this.persistDraftSnapshot(this.account(), current.draftId, snapshot));
    return Boolean(result);
  }
  private rememberDraft(value: StickerDraftDTO): void {
    const existing = this.drafts();
    const index = existing.findIndex((item) => item.draftId === value.draftId);
    if (index < 0) this.drafts.set([...existing, value]);
    else if (existing[index].revision <= value.revision) this.drafts.set(existing.map((item, position) => position === index ? value : item));
  }
  private setCurrentDraft(value: StickerDraftDTO): void {
    this.draft.set(value);
    this.selectedDraftId.set(value.draftId);
    this.selectedPackId.set(value.basePackId);
  }
  private findActiveDraftForPack(packId: string): StickerDraftDTO | undefined {
    return this.drafts().find((item) => item.basePackId === packId && !['discarded', 'saved'].includes(item.status));
  }
  private enqueueNavigation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.navigationQueue.catch(() => undefined).then(operation);
    this.navigationQueue = next;
    return next.finally(() => {
      if (this.navigationQueue === next) this.navigationQueue = Promise.resolve();
    });
  }
  private enqueueDraftMutation<T>(draftId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.draftQueues.get(draftId) || Promise.resolve();
    const next = previous.catch(() => undefined).then(operation);
    this.draftQueues.set(draftId, next);
    return next.finally(() => {
      if (this.draftQueues.get(draftId) === next) this.draftQueues.delete(draftId);
    });
  }
  private async persistDraftSnapshot(accountId: string, draftId: string, snapshot: StickerDraftSnapshot): Promise<StickerDraftDTO | undefined> {
    const currentGeneration = this.generation();
    const currentDraft = this.draft();
    if (!this.port || !this.isCurrent(accountId, currentGeneration) || !currentDraft || currentDraft.draftId !== draftId) return undefined;
    this.state.set('saving');
    try {
      const result = await this.port.updateDraft({
        version: 1,
        requestId: createOpaqueId('sticker-draft-update'),
        accountId,
        draftId,
        revision: currentDraft.revision,
        name: snapshot.name,
        description: snapshot.description,
        stickerIds: snapshot.stickerIds,
      });
      if (!this.isCurrent(accountId, currentGeneration)) return undefined;
      if (!result.ok) { this.fail(result.error.code); return undefined; }
      this.rememberDraft(result.value);
      const confirmed = this.drafts().find((item) => item.draftId === result.value.draftId) || result.value;
      this.setCurrentDraft(confirmed);
      this.state.set('ready');
      this.error.set(null);
      return confirmed;
    } catch {
      if (this.isCurrent(accountId, currentGeneration)) this.fail('STORAGE_FAILED');
      return undefined;
    }
  }
  private sameSnapshot(draft: StickerDraftDTO, snapshot: StickerDraftSnapshot): boolean {
    return draft.name === snapshot.name && (draft.description || '') === snapshot.description && draft.stickerIds.length === snapshot.stickerIds.length && draft.stickerIds.every((id, index) => id === snapshot.stickerIds[index]);
  }
  private isCurrentAccount(accountId: string, generation: number): boolean { return this.account() === accountId && this.generation() === generation && Boolean(this.port); }
  private fail(code: string): void {
    this.state.set('error');
    this.error.set(code === 'CONFLICT' ? 'El paquete cambió en otra ventana. Vuelve a cargarlo.' : code === 'UNSUPPORTED' ? 'El Sticker Studio no está disponible.' : 'No se pudo guardar el paquete local.');
  }
  private isCurrent(accountId: string, generation: number): boolean { return this.account() === accountId && this.generation() === generation; }
}
