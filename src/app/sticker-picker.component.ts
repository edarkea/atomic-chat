import { ChangeDetectionStrategy, Component, HostListener, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StickerLibraryFacade } from './core/sticker-library.facade';
import { StickerThumbnailComponent } from './sticker-thumbnail.component';

@Component({
  selector: 'app-sticker-picker',
  imports: [FormsModule, StickerThumbnailComponent],
  templateUrl: './sticker-picker.component.html',
  styleUrls: ['./sticker-picker.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StickerPickerComponent {
  readonly accountId = input.required<string>();
  readonly disabled = input(false);
  readonly open = signal(false);
  readonly facade = inject(StickerLibraryFacade);

  constructor() {
    effect(() => {
      const accountId = this.accountId();
      if (!accountId) untracked(() => this.facade.reset());
      else if (this.open()) untracked(() => void this.facade.load(accountId));
    });
  }

  toggle(): void { if (!this.disabled() && this.accountId()) this.open.update((value) => !value); }
  close(): void { this.open.set(false); }
  async remove(event: Event, stickerId: string): Promise<void> { event.stopPropagation(); await this.facade.remove(stickerId); }
  @HostListener('document:keydown.escape') onEscape(): void { if (this.open()) this.close(); }
}
