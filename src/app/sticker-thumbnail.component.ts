import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnDestroy, inject, input, output, signal } from '@angular/core';
import { StickerPreviewGrant, StickerRecord } from './core/domain';
import { createOpaqueId } from './core/ids';
import { STICKER_PREVIEW_PORT, StickerPreviewPort } from './core/ports';

@Component({
  selector: 'app-sticker-thumbnail',
  template: `
    <button class="sticker-thumbnail" type="button" [class.sticker-thumbnail--large]="large()" (click)="activated.emit()" [attr.aria-label]="sticker().name || sticker().altText || 'Sticker'">
      @if (url()) { <img [src]="url()" [alt]="sticker().altText || sticker().name || 'Sticker'" loading="lazy" /> }
      @else if (loading()) { <span class="sticker-thumbnail__state" aria-label="Cargando sticker">…</span> }
      @else { <span class="sticker-thumbnail__state" [attr.aria-label]="error() ? 'Sticker no disponible' : 'Sticker'">✦</span> }
    </button>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .sticker-thumbnail { align-items: center; background: var(--atomic-surface-raised); border: 1px solid var(--atomic-separator); border-radius: 8px; color: var(--atomic-text); cursor: pointer; display: flex; height: 64px; justify-content: center; overflow: hidden; padding: 5px; width: 64px; }
    .sticker-thumbnail:hover, .sticker-thumbnail:focus-visible { border-color: var(--atomic-green); outline: 2px solid color-mix(in srgb, var(--atomic-green) 45%, transparent); outline-offset: 2px; }
    .sticker-thumbnail--large { height: 180px; width: 180px; }
    img { display: block; height: 100%; object-fit: contain; width: 100%; }
    .sticker-thumbnail__state { color: var(--atomic-green); font-size: 22px; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StickerThumbnailComponent implements AfterViewInit, OnDestroy {
  readonly accountId = input.required<string>();
  readonly sticker = input.required<StickerRecord>();
  readonly large = input(false);
  readonly activated = output<void>();
  readonly url = signal<string | null>(null);
  readonly loading = signal(false);
  readonly error = signal(false);
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly port = inject<StickerPreviewPort | null>(STICKER_PREVIEW_PORT, { optional: true });
  private observer?: IntersectionObserver;
  private destroyed = false;
  private grant?: StickerPreviewGrant;

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
    if (!this.port) { this.error.set(true); return; }
    this.loading.set(true);
    const request = { version: 1 as const, requestId: createOpaqueId('sticker-preview'), accountId: this.accountId(), stickerId: this.sticker().stickerId };
    const grantResult = await this.port.get(request);
    if (!grantResult.ok) { this.error.set(true); this.loading.set(false); return; }
    this.grant = grantResult.value;
    let streamId: string | undefined;
    const chunks: ArrayBuffer[] = [];
    try {
      const opened = await this.port.open({ ...request, grantId: grantResult.value.grantId });
      if (!opened.ok) return;
      streamId = opened.value.streamId;
      let sequence = 0;
      let done = false;
      while (!done) {
        const chunk = await this.port.read({ ...request, grantId: grantResult.value.grantId, streamId, sequence });
        if (!chunk.ok) return;
        chunks.push(chunk.value.bytes);
        done = chunk.value.done;
        sequence += 1;
      }
      if (!this.destroyed) this.url.set(URL.createObjectURL(new Blob(chunks, { type: grantResult.value.mimeType })));
    } catch { this.error.set(true); }
    finally {
      if (streamId) await this.port.close({ ...request, grantId: grantResult.value.grantId, streamId }).catch(() => undefined);
      await this.port.revoke({ ...request, grantId: grantResult.value.grantId }).catch(() => undefined);
      this.loading.set(false);
    }
  }

  ngOnDestroy(): void {
    this.destroyed = true;
    this.observer?.disconnect();
    const value = this.url();
    if (value) URL.revokeObjectURL(value);
  }
}
