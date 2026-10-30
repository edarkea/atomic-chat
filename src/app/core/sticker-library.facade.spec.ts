import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  Result,
  StickerDeleteRequest,
  StickerImportRequest,
  StickerImportResult,
  StickerLibrarySnapshot,
  StickerListRequest,
  StickerRecord,
} from './domain';
import { StickerLibraryFacade } from './sticker-library.facade';
import { STICKER_LIBRARY_PORT, StickerLibraryPort } from './ports';

const sticker: StickerRecord = {
  stickerId: 's1', accountId: 'alice', assetId: 'a1', name: 'one.png', sortKey: '1',
  availability: 'available', createdAt: '2026-01-01', updatedAt: '2026-01-01',
};

function snapshot(input: StickerListRequest, stickers: ReadonlyArray<StickerRecord>): Result<StickerLibrarySnapshot> {
  return { ok: true, version: 1, requestId: input.requestId, value: { accountId: input.accountId, collectionId: 'my-stickers', query: input.query || '', stickers } };
}

describe('StickerLibraryFacade', () => {
  let facade: StickerLibraryFacade;
  let list: ReturnType<typeof vi.fn<StickerLibraryPort['list']>>;
  let importSticker: ReturnType<typeof vi.fn<StickerLibraryPort['import']>>;
  let remove: ReturnType<typeof vi.fn<StickerLibraryPort['delete']>>;

  beforeEach(() => {
    list = vi.fn(async (input: StickerListRequest) => snapshot(input, input.accountId === 'alice' ? [sticker] : []));
    importSticker = vi.fn(async (_input: StickerImportRequest): Promise<Result<StickerImportResult | null>> => ({ ok: true, version: 1, requestId: 'import', value: null }));
    remove = vi.fn(async (input: StickerDeleteRequest): Promise<Result<void>> => ({ ok: true, version: 1, requestId: input.requestId, value: undefined }));
    const port: StickerLibraryPort = { list, import: importSticker, delete: remove };
    TestBed.configureTestingModule({ providers: [{ provide: STICKER_LIBRARY_PORT, useValue: port }] });
    facade = TestBed.inject(StickerLibraryFacade);
  });

  it('ignores an older list response after changing account and clears prior selection immediately', async () => {
    let resolveAlice!: (value: Result<StickerLibrarySnapshot>) => void;
    let resolveBob!: (value: Result<StickerLibrarySnapshot>) => void;
    list.mockImplementation((input) => new Promise((resolve) => {
      if (input.accountId === 'alice') resolveAlice = resolve;
      else resolveBob = resolve;
    }));
    const aliceLoad = facade.load('alice');
    facade.selectSticker(sticker);
    const bobLoad = facade.load('bob');
    expect(facade.stickers()).toEqual([]);
    expect(facade.selectedSticker()).toBeUndefined();
    resolveBob(snapshot({ version: 1, requestId: 'bob', accountId: 'bob' }, []));
    resolveAlice(snapshot({ version: 1, requestId: 'alice', accountId: 'alice' }, [sticker]));
    await Promise.all([aliceLoad, bobLoad]);
    expect(facade.stickers()).toEqual([]);
    expect(facade.selectedCollection()).toBe('my-stickers');
  });

  it('does not reload the previous account when import finishes after reset', async () => {
    await facade.load('alice');
    let resolveImport!: (value: Result<StickerImportResult | null>) => void;
    importSticker.mockImplementation(() => new Promise((resolve) => { resolveImport = resolve; }));
    const pending = facade.importSticker();
    facade.reset();
    resolveImport({ ok: true, version: 1, requestId: 'import', value: null });
    await pending;
    expect(list).toHaveBeenCalledTimes(1);
    expect(facade.stickers()).toEqual([]);
  });
});
