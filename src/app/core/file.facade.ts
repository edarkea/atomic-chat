import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { createOpaqueId } from './ids';
import { FileTransfer, TypedDomainEvent } from './domain';
import { FILE_TRANSFER_PORT, FileTransferPort } from './ports';

const MAX_DROPPED_FILES = 8;

@Injectable({ providedIn: 'root' })
export class FileFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly port = inject<FileTransferPort>(FILE_TRANSFER_PORT);
  private readonly items = signal<ReadonlyArray<FileTransfer>>([]);
  private readonly pendingLocalActions = signal<ReadonlySet<string>>(new Set());
  private account = '';
  private droppedBatchInFlight = false;
  private droppedBatchGeneration = 0;
  readonly transfers = computed(() => this.items());
  readonly error = signal<string | null>(null);
  readonly activeCount = computed(
    () =>
      this.items().filter((item) => !['completed', 'failed', 'cancelled'].includes(item.state))
        .length,
  );

  constructor() {
    const unsubscribe = this.port.subscribe((event) => this.onEvent(event));
    this.destroyRef.onDestroy(unsubscribe);
  }

  async setAccount(accountId: string): Promise<void> {
    this.droppedBatchGeneration += 1;
    this.account = accountId;
    this.items.set([]);
    this.pendingLocalActions.set(new Set());
    this.error.set(null);
    if (!accountId) return;
    const result = await this.port.listActive({
      version: 1,
      requestId: createOpaqueId('file-list'),
      accountId,
    });
    if (this.account !== accountId) return;
    if (result.ok) {
      const active = new Map(result.value.map((item) => [item.offer.transferId, item]));
      for (const current of this.items())
        if (current.offer.accountId === accountId) active.set(current.offer.transferId, current);
      this.items.set([...active.values()]);
    } else this.error.set(result.error.message);
  }

  async accept(transferId: string): Promise<void> {
    await this.mutate('accept', transferId);
  }
  async reject(transferId: string): Promise<void> {
    await this.mutate('reject', transferId);
  }
  async cancel(transferId: string): Promise<void> {
    await this.mutate('cancel', transferId);
  }

  async open(transferId: string): Promise<void> {
    await this.localAction('open', transferId);
  }

  async reveal(transferId: string): Promise<void> {
    await this.localAction('reveal', transferId);
  }

  isLocalActionPending(transferId: string): boolean {
    return this.pendingLocalActions().has(transferId);
  }

  async send(conversationId: string): Promise<void> {
    if (!this.account || !conversationId) return;
    const accountId = this.account;
    const result = await this.port.send({
      version: 1,
      requestId: createOpaqueId('file-send'),
      accountId,
      conversationId,
    });
    if (this.account !== accountId) return;
    if (result.ok && result.value) this.upsert(result.value);
    else if (!result.ok) this.error.set(result.error.message);
  }

  async sendDropped(conversationId: string, files: ReadonlyArray<File>): Promise<void> {
    if (!this.account || !conversationId) return;
    const batchGeneration = ++this.droppedBatchGeneration;
    if (this.droppedBatchInFlight) {
      this.error.set('Ya hay un lote de archivos en envío. Espera a que termine.');
      return;
    }
    if (files.length > MAX_DROPPED_FILES) {
      this.error.set(`Puedes enviar hasta ${MAX_DROPPED_FILES} archivos por vez.`);
      return;
    }
    if (!files.length || files.some((file) => !this.isValidDroppedFile(file))) {
      this.error.set('El elemento arrastrado no es un archivo válido.');
      return;
    }

    const accountId = this.account;
    let failed = 0;
    this.droppedBatchInFlight = true;
    try {
      for (const file of files) {
        try {
          const result = await this.port.sendDropped({
            version: 1,
            requestId: createOpaqueId('file-drop'),
            accountId,
            conversationId,
            file,
          });
          if (this.account !== accountId) return;
          if (result.ok) {
            if (result.value) this.upsert(result.value);
          } else failed += 1;
        } catch {
          if (this.account !== accountId) return;
          failed += 1;
        }
      }
      if (this.droppedBatchGeneration !== batchGeneration) return;
      if (failed) {
        this.error.set(
          failed === files.length
            ? 'No se pudo iniciar el envío de los archivos.'
            : `No se pudo iniciar el envío de ${failed} archivo${failed === 1 ? '' : 's'}.`,
        );
      } else this.error.set(null);
    } finally {
      this.droppedBatchInFlight = false;
    }
  }

  forConversation(accountId: string, conversationId: string): ReadonlyArray<FileTransfer> {
    const jid = conversationId.split('/')[0].toLowerCase();
    return this.items().filter(
      (item) =>
        item.offer.accountId === accountId && item.offer.conversationId.toLowerCase() === jid,
    );
  }

  label(
    state: FileTransfer['state'],
    reason?: FileTransfer['endReason'],
    direction: FileTransfer['direction'] = 'incoming',
  ): string {
    if (direction === 'outgoing') {
      if (state === 'selecting') return 'Seleccionando archivo';
      if (state === 'offering') return 'Enviando oferta…';
      if (state === 'awaiting_acceptance') return 'Esperando aceptación de Spark';
      if (state === 'accepted') return 'Preparando transferencia';
      if (state === 'transferring') return 'Enviando…';
      if (state === 'completed') return 'Archivo enviado';
      if (state === 'failed')
        return reason === 'storage_failed' ? 'No se pudo leer el archivo' : 'Envío fallido';
      return 'Envío cancelado';
    }
    if (state === 'offered') return 'Archivo ofrecido';
    if (state === 'accepted') return 'Esperando datos del remitente';
    if (state === 'transferring') return 'Recibiendo…';
    if (state === 'completed') return 'Archivo recibido correctamente';
    if (state === 'failed')
      return reason === 'storage_failed'
        ? 'No se pudo guardar el archivo'
        : 'Transferencia fallida';
    return reason === 'user_rejected' ? 'Oferta rechazada' : 'Transferencia cancelada';
  }

  private async mutate(action: 'accept' | 'reject' | 'cancel', transferId: string): Promise<void> {
    const item = this.items().find(
      (candidate) =>
        candidate.offer.transferId === transferId && candidate.offer.accountId === this.account,
    );
    if (!item) return;
    const accountId = this.account;
    const result = await this.port[action]({
      version: 1,
      requestId: createOpaqueId(`file-${action}`),
      accountId,
      transferId,
    });
    if (this.account !== accountId) return;
    if (result.ok) this.upsert(result.value);
    else this.error.set(result.error.message);
  }

  private async localAction(action: 'open' | 'reveal', transferId: string): Promise<void> {
    const item = this.items().find(
      (candidate) =>
        candidate.offer.transferId === transferId && candidate.offer.accountId === this.account,
    );
    if (
      !item ||
      item.state !== 'completed' ||
      !item.localActions?.[action] ||
      this.pendingLocalActions().has(transferId)
    )
      return;
    const accountId = this.account;
    this.pendingLocalActions.update((pending) => new Set(pending).add(transferId));
    try {
      const result = await this.port[action]({
        version: 1,
        requestId: createOpaqueId(`file-${action}`),
        accountId,
        transferId,
      });
      if (this.account !== accountId) return;
      if (result.ok) this.error.set(null);
      else this.error.set(result.error.message);
    } finally {
      this.pendingLocalActions.update((pending) => {
        const next = new Set(pending);
        next.delete(transferId);
        return next;
      });
    }
  }

  private onEvent(event: TypedDomainEvent): void {
    if (event.type === 'file.offerReceived') {
      const offer = event.payload;
      if (offer.accountId === this.account)
        this.upsert({
          offer,
          direction: 'incoming',
          state: 'offered',
          bytesTransferred: '0',
          updatedAt: offer.offeredAt,
        });
    }
    if (event.type === 'file.stateChanged') {
      const transfer = event.payload;
      if (transfer.offer.accountId === this.account) this.upsert(transfer);
    }
  }

  private upsert(transfer: FileTransfer): void {
    this.items.update((items) =>
      items.some((item) => item.offer.transferId === transfer.offer.transferId)
        ? items.map((item) =>
            item.offer.transferId === transfer.offer.transferId ? transfer : item,
          )
        : [...items, transfer],
    );
  }

  private isValidDroppedFile(file: File): boolean {
    return Boolean(
      file &&
        typeof file.name === 'string' &&
        file.name.trim() &&
        Number.isFinite(file.size) &&
        file.size >= 0 &&
        Number.isFinite(file.lastModified),
    );
  }
}
