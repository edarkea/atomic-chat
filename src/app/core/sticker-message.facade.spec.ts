import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { Result, StickerMessageRef } from './domain';
import { STICKER_MESSAGE_PORT, StickerMessagePort } from './ports';
import { StickerMessageFacade } from './sticker-message.facade';

const ref: StickerMessageRef = {
  refId: 'ref-1', previewStickerId: 'message:ref-1', accountId: 'alice', conversationId: 'bob',
  clientMessageId: 'client-1', direction: 'incoming', senderJid: 'bob', mimeType: 'image/png',
  sizeBytes: '4', width: 1, height: 1, hashAlgorithm: 'sha-256', hashValue: 'a'.repeat(64),
  transportStatus: 'sent', availability: 'available', createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

describe('StickerMessageFacade', () => {
  it('deduplicates concurrent save requests for the same historical reference', async () => {
    let resolveSave!: (value: Result<StickerMessageRef>) => void;
    const save = vi.fn(() => new Promise<Result<StickerMessageRef>>((resolve) => { resolveSave = resolve; }));
    const port: StickerMessagePort = {
      discover: vi.fn(), send: vi.fn(), load: vi.fn(), save,
      subscribe: () => () => undefined,
    };
    TestBed.configureTestingModule({ providers: [{ provide: STICKER_MESSAGE_PORT, useValue: port }] });
    const facade = TestBed.inject(StickerMessageFacade);
    const first = facade.save(ref);
    const second = facade.save(ref);
    expect(save).toHaveBeenCalledOnce();
    const result: Result<StickerMessageRef> = { ok: true, version: 1, requestId: 'save', value: { ...ref, savedStickerId: 'saved-1' } };
    resolveSave(result);
    await expect(first).resolves.toEqual(result);
    await expect(second).resolves.toEqual(result);
    save.mockResolvedValue(result);
    await expect(facade.save(ref)).resolves.toEqual(result);
    expect(save).toHaveBeenCalledTimes(2);
    TestBed.resetTestingModule();
  });
});
