import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import {
  ChatImageRecord,
  ChatFileHistoryRecord,
  FileTransfer,
  ImagePreviewFailureCode,
  ImagePreviewReady,
  ImagePreviewRequest,
} from './core/domain';
import { createOpaqueId } from './core/ids';
import { PREVIEW_PORT, PreviewPort } from './core/ports';

interface PreviewSession {
  readonly accountId: string;
  readonly conversationId: string;
  readonly transferId: string;
  readonly mediaId?: string;
  cancelled: boolean;
  preview?: ImagePreviewReady;
  streamId?: string;
  objectUrl?: string;
  expiryTimer?: ReturnType<typeof setTimeout>;
}

@Component({
  selector: 'app-file-transfer-card',
  templateUrl: './file-transfer-card.component.html',
  styleUrls: ['./file-transfer-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileTransferCardComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly previewPort = inject<PreviewPort | null>(PREVIEW_PORT, { optional: true });
  private currentSession: PreviewSession | undefined;
  private destroyed = false;

  readonly transfer = input.required<FileTransfer>();
  readonly media = input<ChatImageRecord>();
  readonly history = input<ChatFileHistoryRecord>();
  readonly label = input.required<string>();
  readonly accepted = output<string>();
  readonly rejected = output<string>();
  readonly cancelled = output<string>();
  readonly opened = output<string>();
  readonly revealed = output<string>();
  readonly historicalOpened = output<string>();
  readonly historicalRevealed = output<string>();
  readonly actionBusy = input(false);
  protected readonly previewUrl = signal<string | null>(null);
  protected readonly previewState = signal<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  protected readonly previewMessage = signal<string | null>(null);
  protected readonly enlarged = signal(false);

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      const session = this.currentSession;
      this.currentSession = undefined;
      this.clearView();
      if (session) void this.cancelSession(session);
    });
    effect(
      () => {
        const transfer = this.transfer();
        const media = this.media();
        untracked(() => this.synchronizePreview(transfer, media));
      },
      { allowSignalWrites: true },
    );
  }

  protected isInProgress(): boolean {
    return ['accepted', 'offering', 'awaiting_acceptance', 'transferring'].includes(
      this.transfer().state,
    );
  }

  protected isTerminal(): boolean {
    return ['completed', 'failed', 'cancelled'].includes(this.transfer().state);
  }

  protected isImageTransfer(): boolean {
    if (this.history()) return false;
    return Boolean(this.media() || this.transfer().offer.mimeType?.startsWith('image/'));
  }

  protected canOpenFile(): boolean {
    const history = this.history();
    if (history) return history.availability === 'available';
    return this.transfer().state === 'completed' && this.transfer().localActions?.open === true;
  }

  protected openFile(): void {
    if (!this.canOpenFile() || this.actionBusy()) return;
    const history = this.history();
    if (history) this.historicalOpened.emit(history.fileId);
    else this.opened.emit(this.transfer().offer.transferId);
  }

  protected historyStatus(): string {
    return this.history()?.availability === 'available' ? '' : 'Archivo no disponible';
  }

  protected canRevealFolder(): boolean {
    const history = this.history();
    if (history) return history.availability === 'available';
    return this.transfer().state === 'completed' && this.transfer().localActions?.reveal === true;
  }

  protected openPreview(): void {
    if (this.previewUrl()) this.enlarged.set(true);
  }

  protected closePreview(): void {
    this.enlarged.set(false);
  }

  private synchronizePreview(transfer: FileTransfer, media?: ChatImageRecord): void {
    const eligible =
      this.previewPort &&
      transfer.state === 'completed' &&
      (transfer.direction === 'incoming' || Boolean(media));
    const transferId = eligible ? transfer.offer.transferId : undefined;
    const mediaId = eligible ? media?.mediaId : undefined;
    const current = this.currentSession;
    if (
      current &&
      current.accountId === transfer.offer.accountId &&
      current.conversationId === transfer.offer.conversationId &&
      current.transferId === transferId &&
      current.mediaId === mediaId &&
      !current.cancelled
    )
      return;

    const previous = this.currentSession;
    this.currentSession = transferId
      ? {
          accountId: transfer.offer.accountId,
          conversationId: transfer.offer.conversationId,
          transferId,
          ...(mediaId ? { mediaId } : {}),
          cancelled: false,
        }
      : undefined;
    this.clearView();
    if (previous) void this.cancelSession(previous);
    if (this.currentSession && media && media.availability !== 'available') {
      this.previewState.set('unavailable');
      this.previewMessage.set('Preview no disponible: el contenido ya no está disponible.');
    } else if (this.currentSession) {
      this.previewState.set('loading');
      void this.loadPreview(transfer, this.currentSession);
    }
  }

  private async loadPreview(transfer: FileTransfer, session: PreviewSession): Promise<void> {
    const port = this.previewPort;
    if (!port) return;
    const request = this.createPreviewRequest(transfer);
    let keepGrant = false;
    try {
      const get = await port.get(request);
      if (get.ok && get.value.state === 'ready') session.preview = get.value;
      if (session.cancelled || this.currentSession !== session) return;
      if (!get.ok) {
        this.setUnavailable('Preview no disponible para este archivo.', session);
        return;
      }
      if (get.value.state !== 'ready') {
        this.setUnavailable(this.previewReason(get.value.reasonCode), session);
        return;
      }

      const open = await port.open({
        ...request,
        requestId: createOpaqueId('preview-open'),
        previewId: get.value.previewId,
      });
      if (!open.ok) {
        this.setUnavailable('Preview no disponible para este archivo.', session);
        return;
      }
      session.streamId = open.value.streamId;
      const chunks: ArrayBuffer[] = [];
      let sequence = 0;
      let done = false;
      while (!done && !session.cancelled && sequence < 256) {
        const chunk = await port.read({
          ...request,
          requestId: createOpaqueId('preview-read'),
          previewId: get.value.previewId,
          streamId: open.value.streamId,
          sequence,
        });
        if (!chunk.ok) throw new Error(chunk.error.message);
        chunks.push(chunk.value.bytes);
        done = chunk.value.done;
        sequence += 1;
      }
      if (!done || session.cancelled || this.currentSession !== session)
        throw new Error('La previsualización expiró.');

      session.objectUrl = URL.createObjectURL(new Blob(chunks, { type: get.value.mimeType }));
      this.previewUrl.set(session.objectUrl);
      this.previewState.set('ready');
      keepGrant = true;
      session.expiryTimer = setTimeout(
        () => this.expireSession(session),
        Math.max(0, Date.parse(get.value.expiresAt) - Date.now()),
      );
    } catch {
      if (!session.cancelled && this.currentSession === session)
        this.setUnavailable('No se pudo renderizar la imagen.', session);
    } finally {
      await this.closeSessionStream(session, request).catch(() => undefined);
      if (!keepGrant || session.cancelled)
        await this.revokeSession(session, request).catch(() => undefined);
      if (!keepGrant && session.objectUrl) {
        URL.revokeObjectURL(session.objectUrl);
        session.objectUrl = undefined;
      }
    }
  }

  private async cancelSession(session: PreviewSession): Promise<void> {
    session.cancelled = true;
    if (session.expiryTimer) clearTimeout(session.expiryTimer);
    session.expiryTimer = undefined;
    const request: ImagePreviewRequest = {
      version: 1,
      requestId: createOpaqueId('preview-cancel'),
      accountId: session.accountId,
      transferId: session.transferId,
      conversationId: session.conversationId,
      ...(session.mediaId ? { mediaId: session.mediaId } : {}),
    };
    await this.closeSessionStream(session, request);
    await this.revokeSession(session, request);
    if (session.objectUrl) {
      URL.revokeObjectURL(session.objectUrl);
      session.objectUrl = undefined;
    }
  }

  private async closeSessionStream(
    session: PreviewSession,
    request: ImagePreviewRequest,
  ): Promise<void> {
    const streamId = session.streamId;
    const preview = session.preview;
    session.streamId = undefined;
    if (!this.previewPort || !streamId || !preview) return;
    await this.previewPort
      .close({
        ...request,
        requestId: createOpaqueId('preview-close'),
        previewId: preview.previewId,
        streamId,
      })
      .catch(() => undefined);
  }

  private async revokeSession(session: PreviewSession, request: ImagePreviewRequest): Promise<void> {
    const preview = session.preview;
    session.preview = undefined;
    if (!this.previewPort || !preview) return;
    await this.previewPort
      .revoke({
        ...request,
        requestId: createOpaqueId('preview-revoke'),
        previewId: preview.previewId,
      })
      .catch(() => undefined);
  }

  private expireSession(session: PreviewSession): void {
    if (this.currentSession !== session) return;
    this.currentSession = undefined;
    this.clearView();
    void this.cancelSession(session);
  }

  private clearView(): void {
    this.enlarged.set(false);
    this.previewUrl.set(null);
    this.previewState.set('idle');
    this.previewMessage.set(null);
  }

  private createPreviewRequest(transfer: FileTransfer): ImagePreviewRequest {
    const mediaId = this.media()?.mediaId;
    return {
      version: 1,
      requestId: createOpaqueId('preview-get'),
      accountId: transfer.offer.accountId,
      transferId: transfer.offer.transferId,
      conversationId: transfer.offer.conversationId,
      ...(mediaId ? { mediaId } : {}),
    };
  }

  private setUnavailable(message: string, session: PreviewSession): void {
    if (!this.destroyed && this.currentSession === session) {
      this.previewState.set('unavailable');
      this.previewMessage.set(message);
    }
  }

  private previewReason(code: ImagePreviewFailureCode): string {
    if (code === 'MEDIA_TYPE_UNSUPPORTED') return 'Preview no disponible: solo PNG/JPEG estático.';
    if (code === 'MEDIA_SIZE_EXCEEDED') return 'Preview no disponible: imagen demasiado grande.';
    if (code === 'MEDIA_DIMENSIONS_INVALID') return 'Preview no disponible: dimensiones no permitidas.';
    return 'Preview no disponible para este archivo.';
  }
}
