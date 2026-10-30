import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { StickerPickerComponent } from './sticker-picker.component';
import { STICKER_LIBRARY_PORT, STICKER_PREVIEW_PORT, StickerLibraryPort, StickerPreviewPort } from './core/ports';

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

  it('opens Mis stickers and exposes individual import without a send action', async () => {
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
    expect(fixture.nativeElement.querySelector('button[type="submit"]')).toBeNull();
    expect(library.list).toHaveBeenCalled();
  });
});
