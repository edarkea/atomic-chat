const test = require('node:test');
const assert = require('node:assert/strict');
const { registerStickerPackHandlers } = require('../electron/ipc-sticker-pack-handlers.cjs');

function harness(authorized = true) {
  const handlers = new Map();
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  const pack = { packId: 'pack-1', accountId: 'alice', source: 'created', status: 'installed', name: 'Local', stickerIds: ['s1'], revision: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
  const draft = { draftId: 'draft-1', accountId: 'alice', status: 'editing', name: '', stickerIds: [], revision: 1, createdAt: '2026-01-01', updatedAt: '2026-01-01' };
  const calls = [];
  const stickerPacks = {
    list: async (...args) => { calls.push(['list', args]); return { accountId: 'alice', packs: [pack] }; },
    get: async () => pack,
    save: async (input) => { calls.push(['save', input]); return pack; },
    delete: async (...args) => { calls.push(['delete', args]); },
    listDrafts: async () => ({ accountId: 'alice', drafts: [draft] }),
    createDraft: async () => draft,
    getDraft: async () => draft,
    updateDraft: async () => draft,
    discardDraft: async () => undefined,
    commitDraft: async () => pack,
  };
  registerStickerPackHandlers({
    ipcMain,
    assertSender: () => undefined,
    getRuntime: () => ({ stickerPacks }),
    historySecurity: { authorize: () => authorized },
    helpers: { validVersion: (input) => input?.version === 1, requestId: (_event, input) => input?.requestId || 'fallback' },
  });
  return { handlers, calls };
}

test('E8.3-IPC-001 rejects unauthorized package operations', async () => {
  const value = harness(false);
  const result = await value.handlers.get('stickerPacks.list')({ sender: { id: 7 } }, { version: 1, requestId: 'r1', accountId: 'alice' });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'UNAUTHORIZED');
});

test('E8.3-IPC-002 exposes versioned DTO operations without paths or bytes', async () => {
  const value = harness();
  const result = await value.handlers.get('stickerPacks.list')({ sender: { id: 7 } }, { version: 1, requestId: 'r2', accountId: 'alice' });
  assert.equal(result.ok, true);
  assert.equal(result.value.packs[0].packId, 'pack-1');
  assert.equal('storageKey' in result.value.packs[0], false);
  assert.equal('path' in result.value.packs[0], false);
});

test('E8.3-IPC-003 rejects malformed package mutations before Main store', async () => {
  const value = harness();
  const result = await value.handlers.get('stickerPacks.save')({ sender: { id: 7 } }, { version: 1, requestId: 'r3', accountId: 'alice', revision: 0, name: 'X', stickerIds: ['s1', 's1'] });
  assert.equal(result.ok, false);
  assert.equal(result.error.code, 'CONFLICT');
  assert.equal(value.calls.length, 0);
});
