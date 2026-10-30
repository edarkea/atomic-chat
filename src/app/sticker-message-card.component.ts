import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
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
    </article>
  `,
  styles: [`
    :host { display: block; max-width: 220px; }
    .sticker-message { align-items: center; background: var(--atomic-incoming-bubble); border: 1px solid var(--atomic-separator); border-radius: 10px; display: flex; flex-direction: column; gap: 6px; padding: 7px; }
    .sticker-message--outgoing { background: var(--atomic-outgoing-bubble); }
    .sticker-placeholder { align-items: center; color: var(--atomic-text-secondary); display: flex; flex-direction: column; gap: 6px; justify-content: center; min-height: 160px; text-align: center; width: 180px; }
    .sticker-placeholder > span:first-child { color: var(--atomic-green); font-size: 24px; }
    .sticker-placeholder button { background: transparent; border: 1px solid var(--atomic-separator); color: var(--atomic-text); cursor: pointer; padding: 4px 8px; }
    .sticker-placeholder button:focus-visible { outline: 2px solid var(--atomic-green); outline-offset: 2px; }
    .sticker-caption { color: var(--atomic-text-secondary); font-size: .75rem; margin: 0; max-width: 190px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  `],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StickerMessageCardComponent {
  readonly accountId = input.required<string>();
  readonly sticker = input.required<StickerMessageRef>();
  readonly outgoing = input(false);
  readonly loadRequested = output<string>();
  readonly available = computed(() => this.sticker().availability === 'available');
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
}
