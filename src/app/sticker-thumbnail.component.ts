import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, inject, input, output, signal } from '@angular/core';
import { StickerRecord } from './core/domain';
import { createOpaqueId } from './core/ids';
import { STICKER_PREVIEW_PORT, StickerPreviewPort } from './core/ports';

type PreviewRelease = () => void;

class PreviewLoadLimiter {
  private active = 0;
  private readonly queue: Array<(release: PreviewRelease) => void> = [];

  acquire(): Promise<PreviewRelease> {
    if (this.active < 4) {
      this.active += 1;
      return Promise.resolve(this.releaseHandle());
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  private releaseHandle(): PreviewRelease {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.queue.shift();
      if (next) next(this.releaseHandle());
      else this.active = Math.max(0, this.active - 1);
    };
  }
}

const previewLoadLimiter = new PreviewLoadLimiter();

@Component({
  selector: 'app-sticker-thumbnail',
  template: `
    @if (interactive()) {
      <button class="sticker-thumbnail" type="button" [class.sticker-thumbnail--large]="large()" (click)="activated.emit()" [attr.aria-label]="sticker().name || sticker().altText || 'Sticker'">
        @if (url()) { <img [src]="url()" [alt]="sticker().altText || sticker().name || 'Sticker'" loading="lazy" /> }
        @else if (loading()) { <span class="sticker-thumbnail__state" aria-label="Cargando sticker">…</span> }
        @else { <span class="sticker-thumbnail__state" [attr.aria-label]="error() ? 'Sticker no disponible' : 'Sticker'">✦</span> }
      </button>
    } @else {
      <div class="sticker-thumbnail" aria-hidden="true" [class.sticker-thumbnail--large]="large()">
        @if (url()) { <img [src]="url()" alt="" loading="lazy" /> }
        @else if (loading()) { <span class="sticker-thumbnail__state">…</span> }
        @else { <span class="sticker-thumbnail__state">✦</span> }
      </div>
    }
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .sticker-thumbnail { align-items: center; background: var(--atomic-surface-raised); border: 1px solid var(--atomic-separator); border-radius: 8px; color: var(--atomic-text); cursor: pointer; display: flex; height: 64px; justify-content: center; overflow: hidden; padding: 5px; width: 64px; }
    .sticker-thumbnail:hover, .sticker-thumbnail:focus-visible { border-color: var(--atomic-green); outline: 2px solid color-mix(in srgb, var(--atomic-green) 45%, transparent); outline-offset: 2px; }
    .sticker-thumbnail--large { height: 160px; width: 160px; }
    img { display: block; height: 100%; object-fit: contain; width: 100%; }
    .sticker-thumbnail__state { color: var(--atomic-green); font-size: 22px; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StickerThumbnailComponent implements AfterViewInit, OnDestroy {
  readonly accountId = input.required<string>();
  readonly sticker = input.required<StickerRecord>();
  readonly large = input(false);
  readonly interactive = input(true);
  readonly activated = output<void>();
  readonly url = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal(false);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly port = inject<StickerPreviewPort | null>(STICKER_PREVIEW_PORT, { optional: true });
  private observer?: IntersectionObserver;
  private destroyed = false;
  private operation = 0;
  private activeRequest?: { readonly version: 1; readonly requestId: string; readonly accountId: string; readonly stickerId: string };
  private activeGrantId?: string;
  private activeStreamId?: string;

  ngAfterViewInit(): void {
    if (typeof IntersectionObserver === 'undefined') void this.load();
    else {
      this.observer = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) { this.observer?.disconnect(); void this.load(); }
      }, { rootMargin: '120px' });
      this.observer.observe(this.host.nativeElement);
    }
  }

  async load(): Promise<void> {
    if (this.destroyed || this.loading() || this.url()) return;
    const port = this.port;
    if (!port) { this.error.set(true); return; }
    const operation = ++this.operation;
    const accountId = this.accountId();
    const stickerId = this.sticker().stickerId;
    const request = { version: 1 as const, requestId: createOpaqueId('sticker-preview'), accountId, stickerId };
    this.activeRequest = request;
    this.loading.set(true);
    this.error.set(false);
    const release = await previewLoadLimiter.acquire();
    let streamId: string | undefined;
    let grantId: string | undefined;
    let mimeType: 'image/png' | 'image/jpeg' = 'image/png';
    const chunks: ArrayBuffer[] = [];
    try {
      if (!this.isActive(operation, accountId, stickerId)) return;
      const grantResult = await port.get(request);
      if (!grantResult.ok) { if (this.isActive(operation, accountId, stickerId)) this.error.set(true); return; }
      grantId = grantResult.value.grantId;
      this.activeGrantId = grantId;
      mimeType = grantResult.value.mimeType;
      if (!this.isActive(operation, accountId, stickerId)) return;
      const opened = await port.open({ ...request, grantId });
      if (!opened.ok || !this.isActive(operation, accountId, stickerId)) return;
      streamId = opened.value.streamId;
      this.activeStreamId = streamId;
      let sequence = 0;
      let done = false;
      while (!done) {
        const chunk = await port.read({ ...request, grantId, streamId, sequence });
        if (!chunk.ok || !this.isActive(operation, accountId, stickerId)) return;
        chunks.push(chunk.value.bytes);
        done = chunk.value.done;
        sequence += 1;
      }
      if (this.isActive(operation, accountId, stickerId)) this.url.set(URL.createObjectURL(new Blob(chunks, { type: mimeType })));
    } catch { if (this.isActive(operation, accountId, stickerId)) this.error.set(true); }
    finally {
      if (streamId && grantId) await port.close({ ...request, grantId, streamId }).catch(() => undefined);
      if (grantId) await port.revoke({ ...request, grantId }).catch(() => undefined);
      chunks.length = 0;
      release();
      if (this.activeRequest?.requestId === request.requestId) {
        this.activeRequest = undefined;
        this.activeGrantId = undefined;
        this.activeStreamId = undefined;
      }
      if (this.isActive(operation, accountId, stickerId)) this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.operation += 1;
    this.observer?.disconnect();
    const port = this.port;
    const request = this.activeRequest;
    const grantId = this.activeGrantId;
    const streamId = this.activeStreamId;
    if (port && request && grantId) {
      if (streamId) void port.close({ ...request, grantId, streamId }).catch(() => undefined);
      void port.revoke({ ...request, grantId }).catch(() => undefined);
    }
    const value = this.url();
    if (value) URL.revokeObjectURL(value);
  }

  private isActive(operation: number, accountId: string, stickerId: string): boolean {
    return !this.destroyed && operation === this.operation && this.accountId() === accountId && this.sticker().stickerId === stickerId;
  }
}
