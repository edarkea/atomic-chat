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

  it('serializes draft mutations and advances the revision for each request', async () => {
    let updateCount = 0;
    let resolveFirst!: (value: Result<StickerDraftDTO>) => void;
    const updateDraft: StickerPackPort['updateDraft'] = vi.fn((input) => {
      updateCount += 1;
      if (updateCount === 1) return new Promise<Result<StickerDraftDTO>>((resolve) => { resolveFirst = resolve; });
      return Promise.resolve({ ok: true as const, version: 1 as const, requestId: input.requestId, value: { ...draft, name: input.name, revision: input.revision + 1 } });
    });
    const port: StickerPackPort = {
      list: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerPackListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, packs: [] } })),
      get: vi.fn(), save: vi.fn(), delete: vi.fn(), updateDraft,
      listDrafts: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerDraftListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, drafts: [draft] } })),
      createDraft: vi.fn(), getDraft: vi.fn(), discardDraft: vi.fn(), commitDraft: vi.fn(),
    };
    TestBed.configureTestingModule({ providers: [{ provide: STICKER_PACK_PORT, useValue: port }] });
    const facade = TestBed.inject(StickerPackFacade);
    await facade.load('alice');
    const first = facade.updateDraft('Uno', '', ['s1']);
    const second = facade.updateDraft('Dos', '', ['s1']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(updateCount).toBe(1);
    resolveFirst({ ok: true, version: 1, requestId: 'first', value: { ...draft, name: 'Uno', revision: 2 } });
    await Promise.all([first, second]);
    expect(updateCount).toBe(2);
    expect(facade.draft()?.name).toBe('Dos');
    expect(facade.draft()?.revision).toBe(3);
  });

  it('persists the form snapshot before committing it', async () => {
    const calls: string[] = [];
    const updateDraft: StickerPackPort['updateDraft'] = vi.fn(async (input) => {
      calls.push(`update:${input.revision}`);
      return { ok: true as const, version: 1 as const, requestId: input.requestId, value: { ...draft, name: input.name, description: input.description, revision: input.revision + 1 } };
    });
    const commitDraft: StickerPackPort['commitDraft'] = vi.fn(async (input) => {
      calls.push(`commit:${input.revision}`);
      return { ok: true as const, version: 1 as const, requestId: input.requestId, value: pack };
    });
    const port: StickerPackPort = {
      list: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerPackListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, packs: [] } })),
      get: vi.fn(), save: vi.fn(), delete: vi.fn(), updateDraft,
      listDrafts: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerDraftListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, drafts: [draft] } })),
      createDraft: vi.fn(), getDraft: vi.fn(), discardDraft: vi.fn(), commitDraft,
    };
    TestBed.configureTestingModule({ providers: [{ provide: STICKER_PACK_PORT, useValue: port }] });
    const facade = TestBed.inject(StickerPackFacade);
    await facade.load('alice');
    await facade.commitDraft({ name: 'Final', description: 'persistido', stickerIds: ['s1'] });
    expect(calls).toEqual(['update:1', 'commit:2']);
  });

  it('does not commit when persisting the form snapshot fails', async () => {
    const commitDraft = vi.fn();
    const port: StickerPackPort = {
      list: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerPackListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, packs: [] } })),
      get: vi.fn(), save: vi.fn(), delete: vi.fn(),
      listDrafts: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerDraftListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, drafts: [draft] } })),
      createDraft: vi.fn(), getDraft: vi.fn(),
      updateDraft: vi.fn(async (input) => ({ ok: false as const, version: 1 as const, requestId: input.requestId, error: { code: 'STORAGE_FAILED' as const, retryable: true, requestId: input.requestId, message: 'fail' } })),
      discardDraft: vi.fn(), commitDraft,
    };
    TestBed.configureTestingModule({ providers: [{ provide: STICKER_PACK_PORT, useValue: port }] });
    const facade = TestBed.inject(StickerPackFacade);
    await facade.load('alice');
    await facade.commitDraft({ name: 'No confirmado', description: '', stickerIds: ['s1'] });
    expect(commitDraft).not.toHaveBeenCalled();
    expect(facade.draft()?.name).toBe('Borrador');
  });
});
