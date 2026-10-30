import { ChangeDetectionStrategy, Component, effect, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { StickerLibraryFacade } from './core/sticker-library.facade';
import { StickerPackFacade } from './core/sticker-pack.facade';
import { StickerRecord } from './core/domain';
import { StickerThumbnailComponent } from './sticker-thumbnail.component';

@Component({
  selector: 'app-sticker-studio',
  imports: [FormsModule, StickerThumbnailComponent],
  templateUrl: './sticker-studio.component.html',
  styleUrls: ['./sticker-studio.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StickerStudioComponent {
  readonly accountId = input.required<string>();
  readonly closed = output<void>();
  readonly name = signal('');
  readonly description = signal('');
  readonly library: StickerLibraryFacade;
  readonly packs: StickerPackFacade;

  constructor(library: StickerLibraryFacade, packs: StickerPackFacade) {
    this.library = library;
    this.packs = packs;
    effect(() => {
      const accountId = this.accountId();
      if (!accountId) return;
      untracked(() => {
        this.library.selectCollection('my-stickers');
        void this.packs.load(accountId);
      });
    });
    effect(() => {
      const draft = this.packs.draft();
      if (draft) {
        this.name.set(draft.name);
        this.description.set(draft.description || '');
      }
    });
  }

  async createDraft(): Promise<void> { await this.packs.createDraft(this.packs.selectedPackId()); }
  async selectPack(packId: string): Promise<void> { this.packs.selectPack(packId); await this.packs.createDraft(packId); }
  async addSticker(stickerId: string): Promise<void> {
    const draft = this.packs.draft();
    if (!draft || draft.stickerIds.includes(stickerId)) return;
    await this.packs.updateDraft(this.name(), this.description(), [...draft.stickerIds, stickerId]);
  }
  async removeSticker(stickerId: string): Promise<void> {
    const draft = this.packs.draft();
    if (!draft) return;
    await this.packs.updateDraft(this.name(), this.description(), draft.stickerIds.filter((id) => id !== stickerId));
  }
  async moveSticker(stickerId: string, delta: -1 | 1): Promise<void> {
    const draft = this.packs.draft();
    if (!draft) return;
    const index = draft.stickerIds.indexOf(stickerId);
    const next = index + delta;
    if (index < 0 || next < 0 || next >= draft.stickerIds.length) return;
    const ids = [...draft.stickerIds];
    [ids[index], ids[next]] = [ids[next], ids[index]];
    await this.packs.updateDraft(this.name(), this.description(), ids);
  }
  async updateMetadata(): Promise<void> { await this.packs.updateDraft(this.name(), this.description(), this.packs.draft()?.stickerIds || []); }
  async commit(): Promise<void> { await this.packs.commitDraft(); }
  async discard(): Promise<void> { await this.packs.discardDraft(); }
  async deletePack(packId: string): Promise<void> {
    const pack = this.packs.packs().find((item) => item.packId === packId);
    if (pack && window.confirm(`¿Eliminar el paquete «${pack.name}»?`)) await this.packs.deletePack(pack);
  }
  close(): void { this.closed.emit(); }
  hasSticker(stickerId: string): boolean { return this.packs.draft()?.stickerIds.includes(stickerId) || false; }
  indexOf(stickerId: string): number { return this.packs.draft()?.stickerIds.indexOf(stickerId) ?? -1; }
  stickerById(stickerId: string): StickerRecord | undefined { return this.library.stickers().find((sticker) => sticker.stickerId === stickerId); }
}
