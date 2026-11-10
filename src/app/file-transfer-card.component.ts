import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
  viewChild,
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
import {
  ImagePreviewCoordinator,
  PreviewVisibilityPriority,
} from './image-preview-coordinator.service';

interface PreviewSession {
  readonly accountId: string;
  readonly conversationId: string;
  readonly transferId: string;
  readonly mediaId?: string;
  cancelled: boolean;
  preview?: ImagePreviewReady;
  streamId?: string;
  objectUrl?: string;
  retryTimer?: ReturnType<typeof setTimeout>;
  releaseTimer?: ReturnType<typeof setTimeout>;
  visible: boolean;
  loading: boolean;
  priority: PreviewVisibilityPriority;
  cancelQueued?: () => void;
  resourceConstraintRetries: number;
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
  private readonly coordinator = inject(ImagePreviewCoordinator);
  private currentSession: PreviewSession | undefined;
  private destroyed = false;
  private stopObserving: (() => void) | undefined;
  private observedTarget: HTMLElement | undefined;
  private observedRoot: HTMLElement | undefined;

  readonly transfer = input.required<FileTransfer>();
  readonly media = input<ChatImageRecord>();
  readonly previewRoot = input<HTMLElement>();
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
  protected readonly previewState = signal<
    'inactive' | 'pending' | 'loading' | 'ready' | 'unavailable' | 'cancelled'
  >('inactive');
  protected readonly previewMessage = signal<string | null>(null);
  protected readonly enlarged = signal(false);
  private readonly previewTarget = viewChild<ElementRef<HTMLElement>>('previewTarget');

  constructor() {
    this.destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.stopObserving?.();
      this.stopObserving = undefined;
      const session = this.currentSession;
      this.currentSession = undefined;
      this.clearView();
      if (session) void this.cancelSession(session);
    });
    effect(
      () => {
        const transfer = this.transfer();
        const media = this.media();
        const root = this.previewRoot();
        const target = this.previewTarget()?.nativeElement;
        untracked(() => this.synchronizePreview(transfer, media));
        this.synchronizeVisibility(target, root);
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
    return Boolean(
      this.media() || this.transfer().offer.mimeType?.toLowerCase().startsWith('image/'),
    );
  }

  protected shouldRenderCard(): boolean {
    return !(
      this.transfer().direction === 'outgoing' &&
      this.transfer().state === 'cancelled' &&
      this.isImageTransfer() &&
      !this.media()
    );
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

  protected previewAspectRatio(): string {
    const media = this.media();
    return media && media.width > 0 && media.height > 0
      ? `${media.width} / ${media.height}`
      : '4 / 3';
  }

  private synchronizePreview(transfer: FileTransfer, media?: ChatImageRecord): void {
    const eligible =
      this.previewPort &&
      transfer.state === 'completed' &&
      (transfer.direction === 'incoming' ||
        Boolean(media) ||
        transfer.offer.mimeType === 'image/png' ||
        transfer.offer.mimeType === 'image/jpeg');
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
          visible: false,
          loading: false,
          priority: 'prefetch',
          resourceConstraintRetries: 0,
        }
      : undefined;
    this.observedTarget = undefined;
    this.observedRoot = undefined;
    this.clearView();
    if (previous) void this.cancelSession(previous);
    if (this.currentSession && media && media.availability !== 'available') {
      this.previewState.set('unavailable');
      this.previewMessage.set('Preview no disponible: el contenido ya no está disponible.');
    } else if (this.currentSession) {
      this.previewState.set('inactive');
    }
  }

  private synchronizeVisibility(target?: HTMLElement, root?: HTMLElement): void {
    if (this.observedTarget === target && this.observedRoot === root) return;
    this.stopObserving?.();
    this.stopObserving = undefined;
    this.observedTarget = target;
    this.observedRoot = root;
    if (!target || !root || !this.currentSession) {
      this.visibilityChanged(false, 'prefetch');
      return;
    }
    this.stopObserving = this.coordinator.observe(target, root, (active, priority) =>
      this.visibilityChanged(active, priority),
    );
  }

  private visibilityChanged(active: boolean, priority: PreviewVisibilityPriority): void {
    let session = this.currentSession;
    if (active && !session) {
      this.synchronizePreview(this.transfer(), this.media());
      session = this.currentSession;
    }
    if (!session || session.cancelled) return;
    if (this.previewState() === 'unavailable') return;
    if (active) {
      if (session.releaseTimer) clearTimeout(session.releaseTimer);
      session.releaseTimer = undefined;
      session.visible = true;
      session.priority = priority;
      if (session.objectUrl) {
        this.previewState.set('ready');
        return;
      }
      if (session.cancelQueued) {
        this.coordinator.reprioritize(sessionKey(session), priority);
        return;
      }
      if (session.loading) return;
      this.previewState.set('pending');
      session.cancelQueued = this.coordinator.enqueue(sessionKey(session), priority, async () => {
        session.cancelQueued = undefined;
        await this.loadPreview(this.transfer(), session);
      });
      return;
    }

    session.visible = false;
    session.cancelQueued?.();
    session.cancelQueued = undefined;
    if (session.retryTimer) clearTimeout(session.retryTimer);
    session.retryTimer = undefined;
    if (session.releaseTimer) clearTimeout(session.releaseTimer);
    session.releaseTimer = setTimeout(() => {
      session.releaseTimer = undefined;
      if (!session.visible && this.currentSession === session) this.releaseSession(session);
    }, 250);
    if (this.previewState() !== 'unavailable' && !session.loading && !session.objectUrl)
      this.previewState.set('inactive');
  }

  private async loadPreview(transfer: FileTransfer, session: PreviewSession): Promise<void> {
    if (session.cancelled || !session.visible || this.currentSession !== session || session.loading)
      return;
    session.loading = true;
    this.previewState.set('loading');
    try {
      const outcome = await this.loadPreviewAttempt(transfer, session);
      if (
        outcome === 'resource-constraint' &&
        session.visible &&
        session.resourceConstraintRetries < 1
      ) {
        session.resourceConstraintRetries += 1;
        this.previewState.set('pending');
        session.retryTimer = setTimeout(() => {
          session.retryTimer = undefined;
          this.queuePreview(session);
        }, 250);
      }
    } finally {
      session.loading = false;
      if (
        session.visible &&
        !session.cancelled &&
        this.currentSession === session &&
        !session.objectUrl &&
        this.previewState() !== 'unavailable' &&
        !session.retryTimer
      ) {
        this.queuePreview(session, true);
      }
    }
  }

  private queuePreview(session: PreviewSession, afterCurrentRun = false): void {
    if (!session.visible || session.cancelled || this.currentSession !== session) return;
    if (session.cancelQueued) {
      this.coordinator.reprioritize(sessionKey(session), session.priority);
      return;
    }
    this.previewState.set('pending');
    const enqueue = afterCurrentRun
      ? this.coordinator.enqueueAfterActive.bind(this.coordinator)
      : this.coordinator.enqueue.bind(this.coordinator);
    session.cancelQueued = enqueue(sessionKey(session), session.priority, async () => {
      session.cancelQueued = undefined;
      await this.loadPreview(this.transfer(), session);
    });
  }

  private releaseSession(session: PreviewSession): void {
    if (this.currentSession !== session) return;
    this.currentSession = undefined;
    this.clearView();
    void this.cancelSession(session);
  }

  private async loadPreviewAttempt(
    transfer: FileTransfer,
    session: PreviewSession,
  ): Promise<'complete' | 'failed' | 'resource-constraint' | 'cancelled'> {
    const port = this.previewPort;
    if (!port) return 'failed';
    const request = this.createPreviewRequest(transfer);
    try {
      const get = await port.get(request);
      if (get.ok && get.value.state === 'ready') session.preview = get.value;
      if (session.cancelled || !session.visible || this.currentSession !== session)
        return 'cancelled';
      if (!get.ok) {
        if (get.error.code === 'RESOURCE_CONSTRAINT') return 'resource-constraint';
        this.setUnavailable('Preview no disponible para este archivo.', session);
        return 'failed';
      }
      if (get.value.state !== 'ready') {
        this.setUnavailable(this.previewReason(get.value.reasonCode), session);
        return 'failed';
      }

      const open = await port.open({
        ...request,
        requestId: createOpaqueId('preview-open'),
        previewId: get.value.previewId,
      });
      if (!open.ok) {
        if (open.error.code === 'RESOURCE_CONSTRAINT') return 'resource-constraint';
        this.setUnavailable('Preview no disponible para este archivo.', session);
        return 'failed';
      }
      session.streamId = open.value.streamId;
      const chunks: ArrayBuffer[] = [];
      let sequence = 0;
      let done = false;
      while (!done && !session.cancelled && session.visible && sequence < 256) {
        const chunk = await port.read({
          ...request,
          requestId: createOpaqueId('preview-read'),
          previewId: get.value.previewId,
          streamId: open.value.streamId,
          sequence,
        });
        if (!chunk.ok) {
          if (chunk.error.code === 'RESOURCE_CONSTRAINT') return 'resource-constraint';
          throw new Error(chunk.error.message);
        }
        chunks.push(chunk.value.bytes);
        done = chunk.value.done;
        sequence += 1;
      }
      if (session.cancelled || !session.visible || this.currentSession !== session)
        return 'cancelled';
      if (!done) throw new Error('La previsualización expiró.');
      session.objectUrl = URL.createObjectURL(new Blob(chunks, { type: get.value.mimeType }));
      this.previewUrl.set(session.objectUrl);
      this.previewState.set('ready');
      return 'complete';
    } catch {
      if (!session.cancelled && session.visible && this.currentSession === session)
        this.setUnavailable('No se pudo renderizar la imagen.', session);
      return 'failed';
    } finally {
      await this.closeSessionStream(session, request).catch(() => undefined);
      await this.revokeSession(session, request).catch(() => undefined);
      if (session.cancelled || !session.visible) {
        if (session.objectUrl) {
          URL.revokeObjectURL(session.objectUrl);
          session.objectUrl = undefined;
        }
      }
    }
  }

  private async cancelSession(session: PreviewSession): Promise<void> {
    session.cancelled = true;
    session.visible = false;
    session.cancelQueued?.();
    session.cancelQueued = undefined;
    if (session.retryTimer) clearTimeout(session.retryTimer);
    session.retryTimer = undefined;
    if (session.releaseTimer) clearTimeout(session.releaseTimer);
    session.releaseTimer = undefined;
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

  private async revokeSession(
    session: PreviewSession,
    request: ImagePreviewRequest,
  ): Promise<void> {
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

  private clearView(): void {
    this.enlarged.set(false);
    this.previewUrl.set(null);
    this.previewState.set('inactive');
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
    if (code === 'MEDIA_DIMENSIONS_INVALID')
      return 'Preview no disponible: dimensiones no permitidas.';
    return 'Preview no disponible para este archivo.';
  }
}

function sessionKey(session: PreviewSession): string {
  return `${session.accountId}|${session.conversationId}|${session.transferId}|${session.mediaId ?? ''}`;
}
