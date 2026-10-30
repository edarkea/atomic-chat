import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { Result, StickerDraftDTO, StickerDraftListSnapshot, StickerPackDTO, StickerPackListRequest, StickerPackListSnapshot } from './domain';
import { STICKER_PACK_PORT, StickerPackPort } from './ports';
import { StickerPackFacade } from './sticker-pack.facade';

const pack: StickerPackDTO = { packId: 'p1', accountId: 'alice', source: 'created', status: 'installed', name: 'Local', stickerIds: ['s1'], revision: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
const draft: StickerDraftDTO = { draftId: 'd1', accountId: 'alice', status: 'editing', name: 'Borrador', stickerIds: ['s1'], revision: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' };

describe('StickerPackFacade', () => {
  it('recovers packages and active drafts for the current account', async () => {
    const port: StickerPackPort = {
      list: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerPackListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, packs: [pack] } })),
      get: vi.fn(), save: vi.fn(), delete: vi.fn(),
      listDrafts: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerDraftListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, drafts: [draft] } })),
      createDraft: vi.fn(), getDraft: vi.fn(), updateDraft: vi.fn(), discardDraft: vi.fn(), commitDraft: vi.fn(),
    };
    TestBed.configureTestingModule({ providers: [{ provide: STICKER_PACK_PORT, useValue: port }] });
    const facade = TestBed.inject(StickerPackFacade);
    await facade.load('alice');
    expect(facade.packs()).toEqual([pack]);
    expect(facade.draft()).toEqual(draft);
  });

  it('drops late results after account reset', async () => {
    let resolveList!: (value: Result<{ accountId: string; packs: readonly StickerPackDTO[] }>) => void;
    let resolveDrafts!: (value: Result<{ accountId: string; drafts: readonly StickerDraftDTO[] }>) => void;
    const port: StickerPackPort = {
      list: vi.fn(() => new Promise<Result<StickerPackListSnapshot>>((resolve) => { resolveList = resolve; })),
      get: vi.fn(), save: vi.fn(), delete: vi.fn(),
      listDrafts: vi.fn(() => new Promise<Result<StickerDraftListSnapshot>>((resolve) => { resolveDrafts = resolve; })),
      createDraft: vi.fn(), getDraft: vi.fn(), updateDraft: vi.fn(), discardDraft: vi.fn(), commitDraft: vi.fn(),
    };
    TestBed.configureTestingModule({ providers: [{ provide: STICKER_PACK_PORT, useValue: port }] });
    const facade = TestBed.inject(StickerPackFacade);
    const pending = facade.load('alice');
    facade.reset();
    resolveList({ ok: true, version: 1, requestId: 'late', value: { accountId: 'alice', packs: [pack] } });
    resolveDrafts({ ok: true, version: 1, requestId: 'late', value: { accountId: 'alice', drafts: [draft] } });
    await pending;
    expect(facade.packs()).toEqual([]);
    expect(facade.draft()).toBeUndefined();
  });
});
