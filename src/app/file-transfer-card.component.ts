import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { FileTransfer, ImagePreviewReady } from './core/domain';
import { FileFacade } from './core/file.facade';

@Component({
  selector: 'app-file-transfer-card',
  templateUrl: './file-transfer-card.component.html',
  styleUrls: ['./file-transfer-card.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FileTransferCardComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly files = inject(FileFacade);
  private readonly run = signal(0);
  private activePreview: ImagePreviewReady | undefined;
  private activeStreamId: string | undefined;
  private currentObjectUrl: string | undefined;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  readonly transfer = input.required<FileTransfer>();
  readonly label = input.required<string>();
  readonly accepted = output<string>();
  readonly rejected = output<string>();
  readonly cancelled = output<string>();
  readonly opened = output<string>();
  readonly revealed = output<string>();
  readonly actionBusy = input(false);
  protected readonly previewUrl = signal<string | null>(null);
  protected readonly previewState = signal<'idle' | 'loading' | 'ready' | 'unavailable'>('idle');
  protected readonly previewMessage = signal<string | null>(null);
  protected readonly enlarged = signal(false);

  constructor() {
    this.destroyRef.onDestroy(() => void this.releasePreview());
    effect(
      () => {
        const transfer = this.transfer();
        if (transfer.direction === 'incoming' && transfer.state === 'completed') {
          void this.loadPreview(transfer);
        } else {
          void this.releasePreview();
        }
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

  protected hasLocalActions(): boolean {
    const actions = this.transfer().localActions;
    return (
      this.transfer().direction === 'incoming' &&
      this.transfer().state === 'completed' &&
      Boolean(actions?.open || actions?.reveal)
    );
  }

  protected canOpenFile(): boolean {
    return this.transfer().direction === 'incoming' && this.transfer().localActions?.open === true;
  }

  protected canRevealFolder(): boolean {
    return (
      this.transfer().direction === 'incoming' &&
      this.transfer().localActions?.reveal === true
    );
  }

  protected openPreview(): void {
    if (this.previewUrl()) this.enlarged.set(true);
  }

  protected closePreview(): void {
    this.enlarged.set(false);
  }

  private async loadPreview(transfer: FileTransfer): Promise<void> {
    const request = this.files.previewRequest(transfer.offer.transferId);
    if (!request) return;
    if (
      this.activePreview?.transferId !== transfer.offer.transferId &&
      (this.activePreview !== undefined || this.currentObjectUrl !== undefined || this.previewState() !== 'idle')
    )
      await this.releasePreview();
    const generation = this.run() + 1;
    this.run.set(generation);
    if (this.previewUrl() || this.previewState() === 'loading') return;
    this.previewState.set('loading');
    this.previewMessage.set(null);
    const get = await this.files.previewPortForUse().get(request);
    if (generation !== this.run()) return;
    if (!get.ok) {
      this.setUnavailable(get.error.message);
      return;
    }
    if (get.value.state !== 'ready') {
      this.setUnavailable(this.previewReason(get.value.reasonCode));
      return;
    }
    this.activePreview = get.value;
    const open = await this.files.previewPortForUse().open({
      ...request,
      requestId: `${request.requestId}-open`,
      previewId: get.value.previewId,
    });
    if (!open.ok) {
      this.setUnavailable(open.error.message);
      await this.revokeActivePreview(request.accountId, request.transferId);
      return;
    }
    this.activeStreamId = open.value.streamId;
    const chunks: ArrayBuffer[] = [];
    let sequence = 0;
    let done = false;
    try {
      while (!done && sequence < 256) {
        const chunk = await this.files.previewPortForUse().read({
          ...request,
          requestId: `${request.requestId}-read-${sequence}`,
          previewId: get.value.previewId,
          streamId: open.value.streamId,
          sequence,
        });
        if (!chunk.ok) throw new Error(chunk.error.message);
        chunks.push(chunk.value.bytes);
        done = chunk.value.done;
        sequence += 1;
      }
      if (!done || generation !== this.run()) throw new Error('La previsualización expiró.');
      this.currentObjectUrl = URL.createObjectURL(new Blob(chunks, { type: get.value.mimeType }));
      this.previewUrl.set(this.currentObjectUrl);
      this.previewState.set('ready');
      this.expiryTimer = setTimeout(
        () => void this.releasePreview(),
        Math.max(0, Date.parse(get.value.expiresAt) - Date.now()),
      );
    } catch (error) {
      this.setUnavailable(error instanceof Error ? error.message : 'No se pudo renderizar la imagen.');
      await this.revokeActivePreview(request.accountId, request.transferId);
    } finally {
      await this.closeActiveStream(request.accountId, request.transferId);
    }
  }

  private async releasePreview(): Promise<void> {
    this.run.update((value) => value + 1);
    this.enlarged.set(false);
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    const preview = this.activePreview;
    const transferId = preview?.transferId;
    const accountId = preview?.accountId;
    if (this.currentObjectUrl) URL.revokeObjectURL(this.currentObjectUrl);
    this.currentObjectUrl = undefined;
    this.previewUrl.set(null);
    this.previewState.set('idle');
    this.activePreview = undefined;
    if (accountId && transferId) await this.revokeActivePreview(accountId, transferId);
    this.activeStreamId = undefined;
  }

  private async closeActiveStream(accountId: string, transferId: string): Promise<void> {
    const streamId = this.activeStreamId;
    const preview = this.activePreview;
    this.activeStreamId = undefined;
    if (!streamId || !preview) return;
    await this.files.previewPortForUse().close({
      version: 1,
      requestId: `preview-close-${streamId}`,
      accountId,
      transferId,
      previewId: preview.previewId,
      streamId,
    });
  }

  private async revokeActivePreview(accountId: string, transferId: string): Promise<void> {
    const preview = this.activePreview;
    if (!preview) return;
    await this.files.previewPortForUse().revoke({
      version: 1,
      requestId: `preview-revoke-${preview.previewId}`,
      accountId,
      transferId,
      previewId: preview.previewId,
    });
    this.activePreview = undefined;
  }

  private setUnavailable(message: string): void {
    this.previewState.set('unavailable');
    this.previewMessage.set(message);
  }

  private previewReason(code: string): string {
    if (code === 'MEDIA_TYPE_UNSUPPORTED') return 'Preview no disponible: solo PNG/JPEG estático.';
    if (code === 'MEDIA_SIZE_EXCEEDED') return 'Preview no disponible: imagen demasiado grande.';
    if (code === 'MEDIA_DIMENSIONS_INVALID') return 'Preview no disponible: dimensiones no permitidas.';
    return 'Preview no disponible para este archivo.';
  }
}
