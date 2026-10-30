import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { Result, StickerPreviewChunk, StickerPreviewReadRequest, StickerRecord } from './core/domain';
import { STICKER_PREVIEW_PORT, StickerPreviewPort } from './core/ports';
import { StickerThumbnailComponent } from './sticker-thumbnail.component';

describe('StickerThumbnailComponent', () => {
  it('revokes the active grant and closes the stream when destroyed during a read', async () => {
    let resolveRead!: (value: { ok: true; version: 1; requestId: string; value: { grantId: string; streamId: string; sequence: number; bytes: ArrayBuffer; done: boolean } }) => void;
    const grant = { grantId: 'g1', accountId: 'alice', stickerId: 's1', assetId: 'a1', expiresAt: '2026-01-01T00:01:00.000Z', mimeType: 'image/png' as const, sizeBytes: '1', width: 1, height: 1, chunkSize: 65536 };
    const read = vi.fn(async (_input: StickerPreviewReadRequest): Promise<Result<StickerPreviewChunk>> => new Promise((resolve) => { resolveRead = resolve; }));
    const close = vi.fn(async (input: { requestId: string }) => ({ ok: true as const, version: 1 as const, requestId: input.requestId, value: undefined }));
    const revoke = vi.fn(async (input: { requestId: string }) => ({ ok: true as const, version: 1 as const, requestId: input.requestId, value: undefined }));
    const port: StickerPreviewPort = {
      get: vi.fn(async (input) => ({ ok: true as const, version: 1 as const, requestId: input.requestId, value: grant })),
      open: vi.fn(async (input) => ({ ok: true as const, version: 1 as const, requestId: input.requestId, value: { grantId: input.grantId, streamId: 'st1', accountId: 'alice', assetId: 'a1', expiresAt: grant.expiresAt, chunkSize: 65536 } })),
      read, close, revoke,
    };
    await TestBed.configureTestingModule({ imports: [StickerThumbnailComponent], providers: [{ provide: STICKER_PREVIEW_PORT, useValue: port }] }).compileComponents();
    const fixture: ComponentFixture<StickerThumbnailComponent> = TestBed.createComponent(StickerThumbnailComponent);
    const sticker: StickerRecord = { stickerId: 's1', accountId: 'alice', assetId: 'a1', name: 'one.png', sortKey: '1', availability: 'available', createdAt: '2026-01-01', updatedAt: '2026-01-01' };
    fixture.componentRef.setInput('accountId', 'alice');
    fixture.componentRef.setInput('sticker', sticker);
    const pending = fixture.componentInstance.load();
    while (!read.mock.calls.length) await Promise.resolve();
    fixture.destroy();
    expect(close).toHaveBeenCalledWith(expect.objectContaining({ grantId: 'g1', streamId: 'st1' }));
    expect(revoke).toHaveBeenCalledWith(expect.objectContaining({ grantId: 'g1' }));
    resolveRead({ ok: true, version: 1, requestId: 'read', value: { grantId: 'g1', streamId: 'st1', sequence: 0, bytes: new Uint8Array([1]).buffer, done: true } });
    await pending;
  });
});
