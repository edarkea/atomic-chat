import { ChangeDetectionStrategy, Component, HostListener, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StickerLibraryFacade } from './core/sticker-library.facade';
import { StickerPackFacade } from './core/sticker-pack.facade';
import { StickerThumbnailComponent } from './sticker-thumbnail.component';
import { StickerStudioComponent } from './sticker-studio.component';

@Component({
  selector: 'app-sticker-picker',
  imports: [FormsModule, StickerThumbnailComponent, StickerStudioComponent],
  templateUrl: './sticker-picker.component.html',
  styleUrls: ['./sticker-picker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StickerPickerComponent {
  readonly accountId = input.required<string>();
  readonly disabled = input(false);
  readonly open = signal(false);
  readonly facade = inject(StickerLibraryFacade);
  readonly packFacade = inject(StickerPackFacade);
  readonly studioOpen = signal(false);
  private studioReturnFocus?: HTMLElement;

  constructor() {
    effect(() => {
      const accountId = this.accountId();
      if (!accountId) untracked(() => { this.facade.reset(); this.packFacade.reset(); });
      else if (this.open()) untracked(() => { void this.facade.load(accountId); void this.packFacade.load(accountId); });
    });
  }

  toggle(): void { if (!this.disabled() && this.accountId()) this.open.update((value) => !value); }
  close(): void { this.open.set(false); }
  selectPack(packId: string): void { this.facade.selectPack(packId); }
  openStudio(event: Event): void {
    this.studioReturnFocus = event.currentTarget instanceof HTMLElement ? event.currentTarget : undefined;
    this.studioOpen.set(true);
  }
  closeStudio(): void {
    this.studioOpen.set(false);
    const returnFocus = this.studioReturnFocus;
    this.studioReturnFocus = undefined;
    queueMicrotask(() => returnFocus?.focus());
  }
  async remove(event: Event, stickerId: string): Promise<void> { event.stopPropagation(); await this.facade.remove(stickerId); }
  @HostListener('document:keydown.escape', ['$event']) onEscape(event: Event): void {
    if (this.studioOpen()) return;
    if (this.open()) { event.preventDefault(); this.close(); }
  }
}
