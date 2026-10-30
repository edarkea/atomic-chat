import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { StickerPickerComponent } from './sticker-picker.component';
import { STICKER_LIBRARY_PORT, STICKER_PACK_PORT, STICKER_PREVIEW_PORT, StickerLibraryPort, StickerPackPort, StickerPreviewPort } from './core/ports';

describe('StickerPickerComponent', () => {
  let fixture: ComponentFixture<StickerPickerComponent>;
  const library: StickerLibraryPort = {
    import: vi.fn(async (input) => ({ ok: true as const, version: 1 as const, requestId: input.requestId, value: null })),
    list: vi.fn(async (input) => ({ ok: true as const, version: 1 as const, requestId: input.requestId, value: { accountId: input.accountId, collectionId: 'my-stickers' as const, query: input.query || '', stickers: [] } })),
    delete: vi.fn(async (input) => ({ ok: true as const, version: 1 as const, requestId: input.requestId, value: undefined })),
  };
  const preview: StickerPreviewPort = {
    get: vi.fn(), open: vi.fn(), read: vi.fn(), close: vi.fn(), revoke: vi.fn(),
  };

  it('opens Mis stickers and exposes explicit import and send controls', async () => {
    await TestBed.configureTestingModule({
      imports: [StickerPickerComponent],
      providers: [
        { provide: STICKER_LIBRARY_PORT, useValue: library },
        { provide: STICKER_PREVIEW_PORT, useValue: preview },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(StickerPickerComponent);
    fixture.componentRef.setInput('accountId', 'alice@example.test');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.sticker-toggle') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Mis stickers');
    expect(fixture.nativeElement.querySelector('.import')?.textContent).toContain('Importar PNG/JPEG');
    expect(fixture.nativeElement.querySelector('.send-sticker')).toBeNull();
    expect(library.list).toHaveBeenCalled();
  });

  it('emits the selected sticker only after explicit confirmation', async () => {
    await TestBed.configureTestingModule({
      imports: [StickerPickerComponent],
      providers: [
        { provide: STICKER_LIBRARY_PORT, useValue: library },
        { provide: STICKER_PREVIEW_PORT, useValue: preview },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(StickerPickerComponent);
    fixture.componentRef.setInput('accountId', 'alice@example.test');
    fixture.detectChanges();
    fixture.componentInstance.facade.selectSticker({
      stickerId: 's1', accountId: 'alice@example.test', assetId: 'a1', name: 'one.png',
      sortKey: '1', availability: 'available', createdAt: '2026-01-01', updatedAt: '2026-01-01',
    });
    const emitted: string[] = [];
    fixture.componentInstance.stickerSend.subscribe((value) => emitted.push(value));
    fixture.componentInstance.sendSelected();
    expect(emitted).toEqual(['s1']);
  });

  it('does not expose library deletion while a package is selected', async () => {
    library.list = vi.fn(async (input) => ({ ok: true as const, version: 1 as const, requestId: input.requestId, value: {
      accountId: input.accountId, collectionId: input.packId ? `pack:${input.packId}` as const : 'my-stickers' as const, query: input.query || '',
      stickers: [{ stickerId: 's1', accountId: input.accountId, assetId: 'a1', name: 'one.png', sortKey: '1', availability: 'available' as const, createdAt: '2026-01-01', updatedAt: '2026-01-01' }],
    } }));
    const packPort: StickerPackPort = {
      list: vi.fn(async (input) => ({ ok: true as const, version: 1 as const, requestId: input.requestId, value: { accountId: input.accountId, packs: [{ packId: 'p1', accountId: input.accountId, source: 'created' as const, status: 'installed' as const, name: 'Local', stickerIds: ['s1'], revision: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' }] } })),
      get: vi.fn(), save: vi.fn(), delete: vi.fn(), listDrafts: vi.fn(async (input) => ({ ok: true as const, version: 1 as const, requestId: input.requestId, value: { accountId: input.accountId, drafts: [] } })),
      createDraft: vi.fn(), getDraft: vi.fn(), updateDraft: vi.fn(), discardDraft: vi.fn(), commitDraft: vi.fn(),
    };
    await TestBed.configureTestingModule({
      imports: [StickerPickerComponent],
      providers: [
        { provide: STICKER_LIBRARY_PORT, useValue: library },
        { provide: STICKER_PACK_PORT, useValue: packPort },
        { provide: STICKER_PREVIEW_PORT, useValue: preview },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(StickerPickerComponent);
    fixture.componentRef.setInput('accountId', 'alice@example.test');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.sticker-toggle') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
    const collectionButtons = Array.from(fixture.nativeElement.querySelectorAll('.sticker-collections button')) as HTMLButtonElement[];
    const packageButton = collectionButtons.find((button) => button.textContent?.includes('Local'));
    packageButton?.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.delete')).toBeNull();
  });
});
