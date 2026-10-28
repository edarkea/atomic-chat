import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { createOpaqueId } from './ids';
import { DomainEvent, FileOffer, FileTransfer } from './domain';

@Injectable({ providedIn: 'root' })
export class FileFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly items = signal<ReadonlyArray<FileTransfer>>([]);
  private account = '';
  private unsubscribe: () => void = () => undefined;
  readonly transfers = computed(() => this.items());
  readonly error = signal<string | null>(null);
  readonly activeCount = computed(() => this.items().filter((item) => !['completed', 'failed', 'cancelled'].includes(item.state)).length);

  constructor() {
    if (typeof window !== 'undefined' && window.atomicChat) {
      this.unsubscribe = window.atomicChat.subscribe((event) => this.onEvent(event));
      this.destroyRef.onDestroy(() => this.unsubscribe());
    }
  }

  async setAccount(accountId: string): Promise<void> {
    this.account = accountId;
    this.items.set([]);
    if (!window.atomicChat || !accountId) return;
    const result = await window.atomicChat.file.listActive({ version: 1, requestId: createOpaqueId('file-list'), accountId });
    if (this.account !== accountId) return;
    if (result.ok) {
      const active = new Map(result.value.map((item) => [item.offer.transferId, item]));
      for (const current of this.items()) if (current.offer.accountId === accountId) active.set(current.offer.transferId, current);
      this.items.set([...active.values()]);
    } else this.error.set(result.error.message);
  }

  async accept(transferId: string): Promise<void> { await this.mutate('accept', transferId); }
  async reject(transferId: string): Promise<void> { await this.mutate('reject', transferId); }
  async cancel(transferId: string): Promise<void> { await this.mutate('cancel', transferId); }

  forConversation(accountId: string, conversationId: string): ReadonlyArray<FileTransfer> {
    const jid = conversationId.split('/')[0].toLowerCase();
    return this.items().filter((item) => item.offer.accountId === accountId && item.offer.conversationId.toLowerCase() === jid);
  }

  private async mutate(action: 'accept' | 'reject' | 'cancel', transferId: string): Promise<void> {
    const item = this.items().find((candidate) => candidate.offer.transferId === transferId && candidate.offer.accountId === this.account);
    if (!item || !window.atomicChat) return;
    const result = await window.atomicChat.file[action]({ version: 1, requestId: createOpaqueId(`file-${action}`), accountId: this.account, transferId });
    if (result.ok) this.upsert(result.value); else this.error.set(result.error.message);
  }

  private onEvent(event: DomainEvent<unknown>): void {
    if (event.type === 'file.offerReceived') { const offer = event.payload as FileOffer; if (offer.accountId === this.account) this.upsert({ offer, direction: 'incoming', state: 'offered', bytesTransferred: '0', updatedAt: offer.offeredAt }); }
    if (event.type === 'file.stateChanged') { const transfer = event.payload as FileTransfer; if (transfer.offer.accountId === this.account) this.upsert(transfer); }
  }

  private upsert(transfer: FileTransfer): void { this.items.update((items) => items.some((item) => item.offer.transferId === transfer.offer.transferId) ? items.map((item) => item.offer.transferId === transfer.offer.transferId ? transfer : item) : [...items, transfer]); }

  label(state: FileTransfer['state'], reason?: FileTransfer['endReason']): string {
    if (state === 'offered') return 'Archivo ofrecido';
    if (state === 'accepted') return 'Esperando datos del remitente';
    if (state === 'transferring') return 'Recibiendo…';
    if (state === 'completed') return 'Archivo recibido correctamente';
    if (state === 'failed') return reason === 'storage_failed' ? 'No se pudo guardar el archivo' : 'Transferencia fallida';
    return reason === 'user_rejected' ? 'Oferta rechazada' : 'Transferencia cancelada';
  }
}
