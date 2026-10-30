import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { Result, StickerDraftDTO, StickerDraftListSnapshot, StickerPackDTO, StickerPackListRequest, StickerPackListSnapshot } from './domain';
import { STICKER_PACK_PORT, StickerPackPort } from './ports';
import { StickerPackFacade } from './sticker-pack.facade';

const pack: StickerPackDTO = { packId: 'p1', accountId: 'alice', source: 'created', status: 'installed', name: 'Local', stickerIds: ['s1'], revision: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
const secondPack: StickerPackDTO = { ...pack, packId: 'p2', name: 'Otro' };
const draft: StickerDraftDTO = { draftId: 'd1', accountId: 'alice', status: 'editing', name: 'Borrador', stickerIds: ['s1'], revision: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
const secondDraft: StickerDraftDTO = { ...draft, draftId: 'd2', basePackId: 'p2', name: 'Otro borrador' };

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
    expect(facade.draft()).toBeUndefined();
    expect(facade.drafts()).toEqual([draft]);
    await facade.openDraft(draft.draftId);
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
    await facade.openDraft(draft.draftId);
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
    await facade.openDraft(draft.draftId);
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
    await facade.openDraft(draft.draftId);
    await facade.commitDraft({ name: 'No confirmado', description: '', stickerIds: ['s1'] });
    expect(commitDraft).not.toHaveBeenCalled();
    expect(facade.draft()?.name).toBe('Borrador');
  });

  it('does not choose a draft arbitrarily and can reopen either recovered draft', async () => {
    const port: StickerPackPort = {
      list: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerPackListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, packs: [pack, secondPack] } })),
      get: vi.fn(), save: vi.fn(), delete: vi.fn(), updateDraft: vi.fn(),
      listDrafts: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerDraftListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, drafts: [draft, secondDraft] } })),
      createDraft: vi.fn(), getDraft: vi.fn(), discardDraft: vi.fn(), commitDraft: vi.fn(),
    };
    TestBed.configureTestingModule({ providers: [{ provide: STICKER_PACK_PORT, useValue: port }] });
    const facade = TestBed.inject(StickerPackFacade);
    await facade.load('alice');
    expect(facade.draft()).toBeUndefined();
    expect(facade.drafts()).toEqual([draft, secondDraft]);
    await facade.openDraft(secondDraft.draftId);
    expect(facade.draft()).toEqual(secondDraft);
    expect(facade.selectedDraftId()).toBe(secondDraft.draftId);
  });

  it('separates New from Edit and reuses the active draft for a package', async () => {
    const created: StickerDraftDTO = { ...draft, draftId: 'd3', basePackId: undefined, name: '' };
    const editDraft: StickerDraftDTO = { ...draft, basePackId: 'p1' };
    let createCount = 0;
    const createDraftMock = vi.fn(async (input: Parameters<StickerPackPort['createDraft']>[0]) => ({ ok: true as const, version: 1 as const, requestId: input.requestId, value: { ...created, draftId: `new${++createCount}`, accountId: input.accountId } }));
    const createDraft: StickerPackPort['createDraft'] = createDraftMock;
    const port: StickerPackPort = {
      list: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerPackListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, packs: [pack] } })),
      get: vi.fn(), save: vi.fn(), delete: vi.fn(), updateDraft: vi.fn(), createDraft,
      listDrafts: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerDraftListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, drafts: [editDraft] } })),
      getDraft: vi.fn(), discardDraft: vi.fn(), commitDraft: vi.fn(),
    };
    TestBed.configureTestingModule({ providers: [{ provide: STICKER_PACK_PORT, useValue: port }] });
    const facade = TestBed.inject(StickerPackFacade);
    await facade.load('alice');
    await facade.openPack(pack.packId);
    expect(createDraft).not.toHaveBeenCalled();
    await Promise.all([facade.createDraft(), facade.createDraft()]);
    expect(createDraft).toHaveBeenCalledOnce();
    expect(createDraftMock.mock.calls[0][0].basePackId).toBeUndefined();
    expect(facade.selectedPackId()).toBeUndefined();
  });

  it('persists before changing package and does not navigate after a storage failure', async () => {
    const calls: string[] = [];
    const updateDraft: StickerPackPort['updateDraft'] = vi.fn(async (input) => {
      calls.push(`update:${input.revision}`);
      return { ok: true as const, version: 1 as const, requestId: input.requestId, value: { ...draft, name: input.name, revision: input.revision + 1 } };
    });
    const createDraft: StickerPackPort['createDraft'] = vi.fn(async (input) => {
      calls.push('create');
      return { ok: true as const, version: 1 as const, requestId: input.requestId, value: { ...secondDraft, draftId: 'd3', basePackId: input.basePackId } };
    });
    const port: StickerPackPort = {
      list: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerPackListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, packs: [pack, secondPack] } })),
      get: vi.fn(), save: vi.fn(), delete: vi.fn(), updateDraft, createDraft,
      listDrafts: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerDraftListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, drafts: [draft] } })),
      getDraft: vi.fn(), discardDraft: vi.fn(), commitDraft: vi.fn(),
    };
    TestBed.configureTestingModule({ providers: [{ provide: STICKER_PACK_PORT, useValue: port }] });
    const facade = TestBed.inject(StickerPackFacade);
    await facade.load('alice');
    await facade.openDraft(draft.draftId);
    await facade.openPack(secondPack.packId, { name: 'Editado', description: '', stickerIds: ['s1'] });
    expect(calls).toEqual(['update:1', 'create']);
    expect(facade.draft()?.basePackId).toBe(secondPack.packId);

    (updateDraft as ReturnType<typeof vi.fn>).mockImplementationOnce(async (input) => ({ ok: false as const, version: 1 as const, requestId: input.requestId, error: { code: 'STORAGE_FAILED' as const, retryable: true, requestId: input.requestId, message: 'fail' } }));
    await facade.openPack('p3', { name: 'No navega', description: '', stickerIds: ['s1'] });
    expect(createDraft).toHaveBeenCalledTimes(1);
    expect(facade.draft()?.basePackId).toBe(secondPack.packId);
    expect(facade.error()).toContain('No se pudo guardar');
  });

  it('ignores a pending navigation after the account changes', async () => {
    let resolveCreate!: (value: Result<StickerDraftDTO>) => void;
    const createDraft: StickerPackPort['createDraft'] = vi.fn(() => new Promise<Result<StickerDraftDTO>>((resolve) => { resolveCreate = resolve; }));
    const port: StickerPackPort = {
      list: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerPackListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, packs: [] } })),
      get: vi.fn(), save: vi.fn(), delete: vi.fn(), updateDraft: vi.fn(), createDraft,
      listDrafts: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerDraftListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, drafts: [] } })),
      getDraft: vi.fn(), discardDraft: vi.fn(), commitDraft: vi.fn(),
    };
    TestBed.configureTestingModule({ providers: [{ provide: STICKER_PACK_PORT, useValue: port }] });
    const facade = TestBed.inject(StickerPackFacade);
    await facade.load('alice');
    const pending = facade.openPack('p2');
    await new Promise((resolve) => setTimeout(resolve, 0));
    await facade.load('bob');
    resolveCreate({ ok: true, version: 1, requestId: 'late', value: { ...draft, draftId: 'late', accountId: 'alice', basePackId: 'p2' } });
    expect(await pending).toBe(false);
    expect(facade.draft()).toBeUndefined();
  });

  it('keeps the recovered list current across navigation and optimistic revisions', async () => {
    const updateRevisions: number[] = [];
    const updateDraft: StickerPackPort['updateDraft'] = vi.fn(async (input) => {
      updateRevisions.push(input.revision);
      return {
        ok: true as const,
        version: 1 as const,
        requestId: input.requestId,
        value: {
          ...draft,
          name: input.name,
          description: input.description,
          stickerIds: [...input.stickerIds],
          revision: input.revision + 1,
        },
      };
    });
    const port: StickerPackPort = {
      list: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerPackListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, packs: [] } })),
      get: vi.fn(), save: vi.fn(), delete: vi.fn(), updateDraft,
      listDrafts: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerDraftListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, drafts: [draft, secondDraft] } })),
      createDraft: vi.fn(), getDraft: vi.fn(), discardDraft: vi.fn(), commitDraft: vi.fn(),
    };
    TestBed.configureTestingModule({ providers: [{ provide: STICKER_PACK_PORT, useValue: port }] });
    const facade = TestBed.inject(StickerPackFacade);
    await facade.load('alice');
    await facade.openDraft(draft.draftId);
    await facade.updateDraft('A revisión 2', 'descripción 2', ['s2']);
    expect(facade.drafts().find((item) => item.draftId === draft.draftId)).toMatchObject({ name: 'A revisión 2', description: 'descripción 2', stickerIds: ['s2'], revision: 2 });

    await facade.openDraft(secondDraft.draftId);
    await facade.openDraft(draft.draftId);
    expect(port.getDraft).not.toHaveBeenCalled();
    expect(facade.draft()).toMatchObject({ draftId: draft.draftId, name: 'A revisión 2', description: 'descripción 2', stickerIds: ['s2'], revision: 2 });

    await facade.updateDraft('A revisión 3', 'descripción 3', ['s3']);
    expect(updateRevisions).toEqual([1, 2]);
    expect(facade.drafts().find((item) => item.draftId === draft.draftId)).toMatchObject({ name: 'A revisión 3', description: 'descripción 3', stickerIds: ['s3'], revision: 3 });
  });

  it('does not replace a newer recovered draft with a stale get result', async () => {
    let resolveGet!: (value: Result<StickerDraftDTO>) => void;
    const newer: StickerDraftDTO = { ...draft, draftId: 'remote', name: 'Vigente', revision: 3 };
    const stale: StickerDraftDTO = { ...newer, name: 'Antiguo', revision: 1 };
    const port: StickerPackPort = {
      list: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerPackListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, packs: [] } })),
      get: vi.fn(), save: vi.fn(), delete: vi.fn(), updateDraft: vi.fn(),
      listDrafts: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerDraftListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, drafts: [] } })),
      createDraft: vi.fn(), getDraft: vi.fn(() => new Promise<Result<StickerDraftDTO>>((resolve) => { resolveGet = resolve; })), discardDraft: vi.fn(), commitDraft: vi.fn(),
    };
    TestBed.configureTestingModule({ providers: [{ provide: STICKER_PACK_PORT, useValue: port }] });
    const facade = TestBed.inject(StickerPackFacade);
    await facade.load('alice');
    const pending = facade.openDraft(newer.draftId);
    await new Promise((resolve) => setTimeout(resolve, 0));
    facade.drafts.set([newer]);
    resolveGet({ ok: true, version: 1, requestId: 'stale', value: stale });
    expect(await pending).toBe(true);
    expect(facade.draft()).toEqual(newer);
    expect(facade.drafts()).toEqual([newer]);
  });

  it('does not publish unconfirmed metadata after a failed update', async () => {
    const updateDraft: StickerPackPort['updateDraft'] = vi.fn(async (input) => ({
      ok: false as const,
      version: 1 as const,
      requestId: input.requestId,
      error: { code: 'STORAGE_FAILED' as const, retryable: true, requestId: input.requestId, message: 'fail' },
    }));
    const port: StickerPackPort = {
      list: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerPackListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, packs: [] } })),
      get: vi.fn(), save: vi.fn(), delete: vi.fn(), updateDraft,
      listDrafts: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerDraftListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, drafts: [draft, secondDraft] } })),
      createDraft: vi.fn(), getDraft: vi.fn(), discardDraft: vi.fn(), commitDraft: vi.fn(),
    };
    TestBed.configureTestingModule({ providers: [{ provide: STICKER_PACK_PORT, useValue: port }] });
    const facade = TestBed.inject(StickerPackFacade);
    await facade.load('alice');
    await facade.openDraft(draft.draftId);
    expect(await facade.updateDraft('No confirmado', 'sin guardar', ['s2'])).toBe(false);
    await facade.openDraft(secondDraft.draftId);
    await facade.openDraft(draft.draftId);
    expect(facade.draft()).toEqual(draft);
    expect(facade.drafts().find((item) => item.draftId === draft.draftId)).toEqual(draft);
  });

  it('discards a late update result after the account changes', async () => {
    let resolveUpdate!: (value: Result<StickerDraftDTO>) => void;
    const updateDraft: StickerPackPort['updateDraft'] = vi.fn((input) => new Promise<Result<StickerDraftDTO>>((resolve) => {
      resolveUpdate = resolve;
    }));
    const bobDraft: StickerDraftDTO = { ...draft, draftId: 'bob-draft', accountId: 'bob', name: 'Bob' };
    const port: StickerPackPort = {
      list: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerPackListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, packs: [] } })),
      get: vi.fn(), save: vi.fn(), delete: vi.fn(), updateDraft,
      listDrafts: vi.fn(async (input: StickerPackListRequest): Promise<Result<StickerDraftListSnapshot>> => ({ ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, drafts: input.accountId === 'bob' ? [bobDraft] : [draft] } })),
      createDraft: vi.fn(), getDraft: vi.fn(), discardDraft: vi.fn(), commitDraft: vi.fn(),
    };
    TestBed.configureTestingModule({ providers: [{ provide: STICKER_PACK_PORT, useValue: port }] });
    const facade = TestBed.inject(StickerPackFacade);
    await facade.load('alice');
    await facade.openDraft(draft.draftId);
    const pending = facade.updateDraft('Alice tarde', 'no debe llegar', ['s2']);
    await new Promise((resolve) => setTimeout(resolve, 0));
    facade.reset();
    await facade.load('bob');
    resolveUpdate({ ok: true, version: 1, requestId: 'late', value: { ...draft, name: 'Alice tarde', revision: 2 } });
    expect(await pending).toBe(false);
    expect(facade.drafts()).toEqual([bobDraft]);
    expect(facade.draft()).toBeUndefined();
  });
});
