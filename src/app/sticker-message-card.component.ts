import { ChangeDetectionStrategy, Component, computed, input, OnChanges, output, signal, SimpleChanges } from '@angular/core';
import { StickerMessageRef, StickerRecord } from './core/domain';
import { StickerThumbnailComponent } from './sticker-thumbnail.component';

@Component({
  selector: 'app-sticker-message-card',
  imports: [StickerThumbnailComponent],
  template: `
    <article class="sticker-message" [class.sticker-message--outgoing]="outgoing()" [attr.aria-label]="label()">
      @if (available()) {
        <app-sticker-thumbnail [accountId]="accountId()" [sticker]="thumbnailSticker()" [interactive]="false" [large]="true" />
      } @else {
        <div class="sticker-placeholder" role="status" aria-live="polite">
          <span aria-hidden="true">✦</span>
          <span>{{ unavailableLabel() }}</span>
          @if (canLoad()) {
            <button type="button" (click)="loadRequested.emit(sticker().refId)">Cargar sticker</button>
          }
        </div>
      }
      @if (sticker().altText || sticker().name) {
        <p class="sticker-caption">{{ sticker().altText || sticker().name }}</p>
      }
      @if (!outgoing() && available()) {
        <button type="button" class="sticker-save" [disabled]="saving() || saved()" (click)="requestSave()">
          {{ saved() ? 'Ya está guardado' : saving() ? 'Guardando…' : sticker().errorCode ? 'Error · Reintentar' : 'Guardar en Mis stickers' }}
        </button>
      }
    </article>
  `,
  styles: [`
    :host { display: block; max-width: 180px; }
    .sticker-message { align-items: center; background: var(--atomic-incoming-bubble); border: 1px solid var(--atomic-separator); border-radius: 10px; display: flex; flex-direction: column; gap: 6px; padding: 7px; }
    .sticker-message--outgoing { background: var(--atomic-outgoing-bubble); }
    .sticker-placeholder { align-items: center; color: var(--atomic-text-secondary); display: flex; flex-direction: column; gap: 6px; justify-content: center; min-height: 160px; text-align: center; width: 180px; }
    .sticker-placeholder > span:first-child { color: var(--atomic-green); font-size: 24px; }
    .sticker-placeholder button { background: transparent; border: 1px solid var(--atomic-separator); color: var(--atomic-text); cursor: pointer; padding: 4px 8px; }
    .sticker-placeholder button:focus-visible { outline: 2px solid var(--atomic-green); outline-offset: 2px; }
    .sticker-caption { color: var(--atomic-text-secondary); font-size: .75rem; margin: 0; max-width: 160px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sticker-save { background: transparent; border: 1px solid var(--atomic-separator); color: var(--atomic-text); cursor: pointer; font-size: .72rem; padding: 4px 7px; }
    .sticker-save:disabled { cursor: default; opacity: .75; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StickerMessageCardComponent implements OnChanges {
  readonly accountId = input.required<string>();
  readonly sticker = input.required<StickerMessageRef>();
  readonly outgoing = input(false);
  readonly loadRequested = output<string>();
  readonly saveRequested = output<string>();
  readonly saving = signal(false);
  readonly available = computed(() => this.sticker().availability === 'available');
  readonly saved = computed(() => Boolean(this.sticker().savedStickerId));
  readonly canLoad = computed(() => this.sticker().availability === 'missing');
  readonly thumbnailSticker = computed<StickerRecord>(() => ({
    stickerId: this.sticker().previewStickerId,
    accountId: this.sticker().accountId,
    assetId: this.sticker().localAssetId || this.sticker().refId,
    name: this.sticker().name,
    altText: this.sticker().altText,
    sortKey: this.sticker().createdAt,
    availability: 'available',
    createdAt: this.sticker().createdAt,
    updatedAt: this.sticker().updatedAt,
  }));
  readonly label = computed(() => this.sticker().altText || this.sticker().name || 'Sticker');
  readonly unavailableLabel = computed(() => this.sticker().availability === 'invalid' ? 'Sticker no disponible' : 'Sticker no cargado');

  requestSave(): void {
    if (this.saved() || this.saving()) return;
    this.saving.set(true);
    this.saveRequested.emit(this.sticker().refId);
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['sticker']) this.saving.set(false);
  }
}
