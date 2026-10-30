import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { StickerStudioComponent } from './sticker-studio.component';
import { STICKER_LIBRARY_PORT, STICKER_PACK_PORT, STICKER_PREVIEW_PORT, StickerLibraryPort, StickerPackPort, StickerPreviewPort } from './core/ports';

describe('StickerStudioComponent', () => {
  it('exposes an accessible local editor without send actions', async () => {
    const library: StickerLibraryPort = {
      import: vi.fn(),
      list: vi.fn(async (input) => ({ ok: true as const, version: 1 as const, requestId: input.requestId, value: { accountId: input.accountId, collectionId: 'my-stickers' as const, query: '', stickers: [] } })),
      delete: vi.fn(),
    };
    const empty = { accountId: 'alice', packs: [] };
    const packPort: StickerPackPort = {
      list: vi.fn(async (input) => ({ ok: true as const, version: 1 as const, requestId: input.requestId, value: empty })),
      get: vi.fn(), save: vi.fn(), delete: vi.fn(),
      listDrafts: vi.fn(async (input) => ({ ok: true as const, version: 1 as const, requestId: input.requestId, value: { accountId: input.accountId, drafts: [] } })),
      createDraft: vi.fn(async (input) => ({ ok: true as const, version: 1 as const, requestId: input.requestId, value: { draftId: 'd1', accountId: input.accountId, status: 'editing' as const, name: '', stickerIds: [], revision: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' } })),
      getDraft: vi.fn(), updateDraft: vi.fn(), discardDraft: vi.fn(), commitDraft: vi.fn(),
    };
    const preview: StickerPreviewPort = { get: vi.fn(), open: vi.fn(), read: vi.fn(), close: vi.fn(), revoke: vi.fn() };
    await TestBed.configureTestingModule({ imports: [StickerStudioComponent], providers: [
      { provide: STICKER_LIBRARY_PORT, useValue: library },
      { provide: STICKER_PACK_PORT, useValue: packPort },
      { provide: STICKER_PREVIEW_PORT, useValue: preview },
    ] }).compileComponents();
    const fixture: ComponentFixture<StickerStudioComponent> = TestBed.createComponent(StickerStudioComponent);
    fixture.componentRef.setInput('accountId', 'alice');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.componentInstance.createDraft();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('input[name="pack-name"]')?.getAttribute('aria-label')).toBe('Nombre del paquete');
    expect(fixture.nativeElement.textContent).not.toContain('Enviar');
    expect(fixture.nativeElement.querySelector('button[type="submit"]')).not.toBeNull();
  });
});
