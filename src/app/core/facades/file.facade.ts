import { DestroyRef, Injectable, computed, inject, signal } from '@angular/core';
import { createOpaqueId } from '../ids';
import { ChatImageRecord, FileHistoryRequest, FileTransfer } from '../domain';
import type { TypedDomainEvent } from '../domain/domain-event';
import {
  FILE_HISTORY_PORT,
  FILE_TRANSFER_PORT,
  MEDIA_PORT,
  FileHistoryPort,
  FileTransferPort,
  MediaPort,
} from '../ports';
import { bareJid, normalizedBareJid } from '../identity';

const MAX_DROPPED_FILES = 8;

@Injectable({ providedIn: 'root' })
export class FileFacade {
  private readonly destroyRef = inject(DestroyRef);
  private readonly port = inject<FileTransferPort>(FILE_TRANSFER_PORT);
  private readonly historyPort = inject<FileHistoryPort>(FILE_HISTORY_PORT);
  private readonly mediaPort = inject<MediaPort | null>(MEDIA_PORT, { optional: true });
  private readonly items = signal<ReadonlyArray<FileTransfer>>([]);
  private readonly liveMediaItems = signal<ReadonlyArray<ChatImageRecord>>([]);
  private readonly pendingLocalActions = signal<ReadonlySet<string>>(new Set());
  private account = '';
  private readonly manualSendsInFlight = new Set<string>();
  private droppedBatchInFlight = false;
  private droppedBatchGeneration = 0;
  private accountGeneration = 0;
  readonly transfers = computed(() => this.items());
  readonly media = computed(() => this.liveMediaItems());
  readonly liveMedia = computed(() => this.liveMediaItems());
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
    const generation = ++this.accountGeneration;
    this.droppedBatchGeneration += 1;
    this.account = accountId;
    this.items.set([]);
    this.liveMediaItems.set([]);
    this.pendingLocalActions.set(new Set());
    this.error.set(null);
    if (!accountId) return;
    const result = await this.port.listActive({
      version: 1,
      requestId: createOpaqueId('file-list'),
      accountId,
    });
    const mediaResult = this.mediaPort
      ? await this.mediaPort.list({
          version: 1,
          requestId: createOpaqueId('media-list'),
          accountId,
          limit: 100,
        })
      : undefined;
    if (this.account !== accountId || this.accountGeneration !== generation) return;
    if (result.ok) {
      const active = new Map(result.value.map((item) => [item.offer.transferId, item]));
      for (const current of this.items())
        if (current.offer.accountId === accountId) active.set(current.offer.transferId, current);
      this.items.set([...active.values()]);
    } else this.error.set(result.error.message);
    if (mediaResult?.ok) this.liveMediaItems.set(mediaResult.value);
    else if (mediaResult && !mediaResult.ok && !result.ok)
      this.error.set(mediaResult.error.message);
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

  async openHistory(fileId: string, conversationId: string): Promise<void> {
    await this.historyAction('open', fileId, conversationId);
  }

  async revealHistory(fileId: string, conversationId: string): Promise<void> {
    await this.historyAction('reveal', fileId, conversationId);
  }

  isLocalActionPending(transferId: string): boolean {
    return this.pendingLocalActions().has(transferId);
  }

  async send(conversationId: string): Promise<void> {
    if (!this.account || !conversationId) return;
    const accountId = this.account;
    const conversationKey = normalizedBareJid(conversationId);
    const inFlightKey = `${accountId}|${conversationKey}`;
    if (this.manualSendsInFlight.has(inFlightKey)) {
      this.error.set(
        'Ya hay una selección o transferencia de archivo en curso para este contacto.',
      );
      return;
    }
    const generation = this.accountGeneration;
    this.manualSendsInFlight.add(inFlightKey);
    try {
      const result = await this.port.send({
        version: 1,
        requestId: createOpaqueId('file-send'),
        accountId,
        conversationId,
      });
      if (this.account !== accountId || this.accountGeneration !== generation) return;
      if (result.ok && result.value) this.upsert(result.value);
      else if (!result.ok) this.error.set(result.error.message);
    } finally {
      this.manualSendsInFlight.delete(inFlightKey);
    }
  }

  async sendDropped(conversationId: string, files: ReadonlyArray<File>): Promise<void> {
    await this.sendFiles(conversationId, files, 'drop');
  }

  async sendClipboard(conversationId: string, files: ReadonlyArray<File>): Promise<void> {
    await this.sendFiles(conversationId, files, 'clipboard');
  }

  private async sendFiles(
    conversationId: string,
    files: ReadonlyArray<File>,
    source: 'drop' | 'clipboard',
  ): Promise<void> {
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
    const generation = this.accountGeneration;
    const sendFile = (input: {
      version: 1;
      requestId: string;
      accountId: string;
      conversationId: string;
      file: File;
    }) => (source === 'clipboard' ? this.port.sendClipboard(input) : this.port.sendDropped(input));
    let failed = 0;
    this.droppedBatchInFlight = true;
    try {
      for (const file of files) {
        if (this.account !== accountId || this.accountGeneration !== generation) return;
        try {
          const result = await sendFile({
            version: 1,
            requestId: createOpaqueId('file-drop'),
            accountId,
            conversationId,
            file,
          });
          if (this.account !== accountId || this.accountGeneration !== generation) return;
          if (result.ok) {
            if (result.value) this.upsert(result.value);
          } else failed += 1;
        } catch {
          if (this.account !== accountId || this.accountGeneration !== generation) return;
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
    const jid = bareJid(conversationId);
    return this.items().filter(
      (item) =>
        item.offer.accountId === accountId && item.offer.conversationId.toLowerCase() === jid,
    );
  }

  mediaForTransfer(accountId: string, transferId: string): ChatImageRecord | undefined {
    return this.liveMediaItems().find(
      (record) => record.accountId === accountId && record.transferId === transferId,
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
      else
        this.error.set(
          action === 'open' ? 'No se pudo abrir el archivo' : 'No se pudo abrir la carpeta',
        );
    } finally {
      this.pendingLocalActions.update((pending) => {
        const next = new Set(pending);
        next.delete(transferId);
        return next;
      });
    }
  }

  private async historyAction(
    action: 'open' | 'reveal',
    fileId: string,
    conversationId: string,
  ): Promise<void> {
    if (!this.account || !fileId || !conversationId || this.pendingLocalActions().has(fileId))
      return;
    const accountId = this.account;
    const input: FileHistoryRequest = {
      version: 1,
      requestId: createOpaqueId(`file-history-${action}`),
      accountId,
      conversationId,
      fileId,
    };
    this.pendingLocalActions.update((pending) => new Set(pending).add(fileId));
    try {
      const result = await this.historyPort[action](input);
      if (this.account !== accountId) return;
      if (result.ok) this.error.set(null);
      else
        this.error.set(
          action === 'open' ? 'No se pudo abrir el archivo' : 'No se pudo abrir la carpeta',
        );
    } finally {
      this.pendingLocalActions.update((pending) => {
        const next = new Set(pending);
        next.delete(fileId);
        return next;
      });
    }
  }

  private onEvent(event: TypedDomainEvent): void {
    if (event.type === 'file.offerReceived') {
      const offer = event.payload;
      if (
        offer.accountId === this.account &&
        !this.items().some((item) => item.offer.transferId === offer.transferId)
      )
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
      if (transfer.offer.accountId === this.account && transfer.state === 'completed')
        void this.refreshMedia(transfer.offer.accountId, this.accountGeneration);
    }
    if (event.type === 'media.available') {
      const media = event.payload;
      if (media.accountId === this.account) {
        this.upsertMedia(media);
      }
    }
  }

  private upsert(transfer: FileTransfer): void {
    const current = this.items().find(
      (item) => item.offer.transferId === transfer.offer.transferId,
    );
    if (current && ['completed', 'failed', 'cancelled'].includes(current.state)) return;
    this.items.update((items) =>
      items.some((item) => item.offer.transferId === transfer.offer.transferId)
        ? items.map((item) =>
            item.offer.transferId === transfer.offer.transferId ? transfer : item,
          )
        : [...items, transfer],
    );
  }

  private upsertMedia(media: ChatImageRecord): void {
    this.liveMediaItems.update((items) =>
      items.some((item) => item.mediaId === media.mediaId)
        ? items.map((item) => (item.mediaId === media.mediaId ? media : item))
        : [...items, media],
    );
  }

  private async refreshMedia(accountId: string, generation: number): Promise<void> {
    if (!this.mediaPort) return;
    const result = await this.mediaPort.list({
      version: 1,
      requestId: createOpaqueId('media-refresh'),
      accountId,
      limit: 100,
    });
    if (this.account !== accountId || this.accountGeneration !== generation || !result.ok) return;
    this.liveMediaItems.set(result.value);
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
