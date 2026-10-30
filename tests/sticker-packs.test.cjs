const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { PersistenceStore } = require('../electron/storage.cjs');
const { StickerStore } = require('../electron/sticker-store.cjs');
const { StickerPackStore } = require('../electron/sticker-pack-store.cjs');

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
const decoder = { createFromBuffer: () => ({ isEmpty: () => false, getSize: () => ({ width: 1, height: 1 }) }) };

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-chat-pack-test-'));
  const persistence = new PersistenceStore(root);
  persistence.upsertAccount({ accountId: 'alice@example.test', host: 'example.test', port: 5222, tls: 1, credentialRef: null, createdAt: new Date().toISOString() });
  persistence.upsertAccount({ accountId: 'bob@example.test', host: 'example.test', port: 5222, tls: 1, credentialRef: null, createdAt: new Date().toISOString() });
  const stickers = new StickerStore(root, persistence, decoder);
  const source = path.join(root, 'source.png');
  await fs.writeFile(source, png);
  const first = await stickers.importFile('alice@example.test', source);
  const second = await stickers.importFile('alice@example.test', source);
  const bob = await stickers.importFile('bob@example.test', source);
  return { root, persistence, stickers, packs: new StickerPackStore(persistence), first, second, bob };
}

async function close(value) {
  value.persistence.close();
  await fs.rm(value.root, { recursive: true, force: true });
}

test('E8.3-PACK-001 migrates v10 to v12 without losing existing stickers', async () => {
  const value = await fixture();
  const preservedStickerId = value.first.sticker.stickerId;
  value.persistence.database.exec('DROP TABLE sticker_draft_items; DROP TABLE sticker_drafts; DROP TABLE sticker_pack_items; DROP TABLE sticker_packs; UPDATE schema_meta SET version = 10;');
  value.persistence.close();
  const reopened = new PersistenceStore(value.root);
  assert.equal(reopened.database.prepare('SELECT version FROM schema_meta').get().version, 12);
  assert.ok(reopened.getSticker('alice@example.test', preservedStickerId));
  const reopenedPacks = new StickerPackStore(reopened);
  const draft = await reopenedPacks.createDraft('alice@example.test');
  assert.equal(draft.status, 'editing');
  assert.equal(reopened.listStickerDrafts('alice@example.test')[0].draftId, draft.draftId);
  reopened.close();
  await fs.rm(value.root, { recursive: true, force: true });
});

test('E8.3-PACK-001B recovers an active draft after restart', async () => {
  const value = await fixture();
  const draft = await value.packs.createDraft('alice@example.test');
  value.persistence.close();
  const reopened = new PersistenceStore(value.root);
  assert.equal(reopened.listStickerDrafts('alice@example.test')[0].draftId, draft.draftId);
  reopened.close();
  await fs.rm(value.root, { recursive: true, force: true });
});

test('E8.3-PACK-002 validates name, non-empty content and duplicate ids', async () => {
  const value = await fixture();
  const draft = await value.packs.createDraft('alice@example.test');
  const unnamed = await value.packs.updateDraft({ accountId: 'alice@example.test', draftId: draft.draftId, revision: draft.revision, name: ' ', description: '', stickerIds: [value.first.sticker.stickerId] });
  await assert.rejects(() => value.packs.commitDraft('alice@example.test', draft.draftId, unnamed.revision), { code: 'INVALID_INPUT' });
  const named = await value.packs.updateDraft({ accountId: 'alice@example.test', draftId: draft.draftId, revision: unnamed.revision, name: ' Colección ', description: '', stickerIds: [] });
  await assert.rejects(() => value.packs.commitDraft('alice@example.test', draft.draftId, named.revision), { code: 'INVALID_INPUT' });
  await assert.rejects(async () => value.packs.updateDraft({ accountId: 'alice@example.test', draftId: draft.draftId, revision: named.revision, name: 'Colección', description: '', stickerIds: [value.first.sticker.stickerId, value.first.sticker.stickerId] }), { code: 'CONFLICT' });
  await close(value);
});

test('E8.3-PACK-002B saves a new package through the direct pack contract', async () => {
  const value = await fixture();
  const pack = await value.packs.save({
    accountId: 'alice@example.test', revision: 0, name: 'Directo', description: 'local',
    stickerIds: [value.first.sticker.stickerId],
  });
  assert.equal(pack.name, 'Directo');
  assert.equal(pack.revision, 1);
  assert.deepEqual(pack.stickerIds, [value.first.sticker.stickerId]);
  await close(value);
});

test('E8.3-PACK-002C rejects invalid assets for new membership and preserves existing references', async () => {
  const value = await fixture();
  const otherSource = path.join(value.root, 'other.png');
  await fs.writeFile(otherSource, Buffer.concat([png, Buffer.from([1])]));
  const invalid = await value.stickers.importFile('alice@example.test', otherSource);
  value.persistence.markStickerAssetAvailability('alice@example.test', invalid.asset.assetId, 'invalid');
  await assert.rejects(() => value.packs.save({
    accountId: 'alice@example.test', revision: 0, name: 'Inválido', description: '',
    stickerIds: [invalid.sticker.stickerId],
  }), { code: 'MEDIA_PREVIEW_UNAVAILABLE' });

  const draft = await value.packs.createDraft('alice@example.test');
  const valid = await value.packs.updateDraft({ accountId: 'alice@example.test', draftId: draft.draftId, revision: draft.revision, name: 'Válido', description: '', stickerIds: [value.first.sticker.stickerId] });
  const pack = await value.packs.commitDraft('alice@example.test', draft.draftId, valid.revision);
  value.persistence.markStickerAssetAvailability('alice@example.test', value.first.asset.assetId, 'invalid');
  const edit = await value.packs.createDraft('alice@example.test', pack.packId);
  const preserved = await value.packs.updateDraft({ accountId: 'alice@example.test', draftId: edit.draftId, revision: edit.revision, name: 'Conservado', description: '', stickerIds: edit.stickerIds });
  const saved = await value.packs.commitDraft('alice@example.test', edit.draftId, preserved.revision);
  assert.deepEqual(saved.stickerIds, [value.first.sticker.stickerId]);
  await close(value);
});

test('E8.3-PACK-003 commits an ordered package and edits it with optimistic revision', async () => {
  const value = await fixture();
  const draft = await value.packs.createDraft('alice@example.test');
  const updated = await value.packs.updateDraft({ accountId: 'alice@example.test', draftId: draft.draftId, revision: draft.revision, name: 'Colección', description: 'local', stickerIds: [value.second.sticker.stickerId, value.first.sticker.stickerId] });
  const pack = await value.packs.commitDraft('alice@example.test', draft.draftId, updated.revision);
  assert.deepEqual(pack.stickerIds, [value.second.sticker.stickerId, value.first.sticker.stickerId]);
  assert.equal(pack.revision, 1);
  const edit = await value.packs.createDraft('alice@example.test', pack.packId);
  assert.equal(edit.basePackRevision, 1);
  const firstEdit = await value.packs.updateDraft({ accountId: 'alice@example.test', draftId: edit.draftId, revision: edit.revision, name: 'Intermedio', description: '', stickerIds: edit.stickerIds });
  await assert.rejects(async () => value.packs.updateDraft({ accountId: 'alice@example.test', draftId: edit.draftId, revision: edit.revision, name: 'Obsoleto', description: '', stickerIds: edit.stickerIds }), { code: 'CONFLICT' });
  const edited = await value.packs.updateDraft({ accountId: 'alice@example.test', draftId: edit.draftId, revision: firstEdit.revision, name: 'Editado', description: '', stickerIds: [value.first.sticker.stickerId, value.second.sticker.stickerId] });
  const saved = await value.packs.commitDraft('alice@example.test', edit.draftId, edited.revision);
  assert.equal(saved.revision, 2);
  assert.deepEqual(saved.stickerIds, [value.first.sticker.stickerId, value.second.sticker.stickerId]);
  await close(value);
});

test('E8.3-PACK-004 rejects cross-account stickers and preserves transactional state', async () => {
  const value = await fixture();
  const draft = await value.packs.createDraft('alice@example.test');
  await assert.rejects(() => value.packs.updateDraft({ accountId: 'alice@example.test', draftId: draft.draftId, revision: draft.revision, name: 'No fuga', description: '', stickerIds: [value.bob.sticker.stickerId] }), { code: 'UNAUTHORIZED' });
  const valid = await value.packs.updateDraft({ accountId: 'alice@example.test', draftId: draft.draftId, revision: draft.revision, name: 'Original', description: '', stickerIds: [value.first.sticker.stickerId] });
  const originalInsert = value.persistence.insertStickerPackItems.bind(value.persistence);
  value.persistence.insertStickerPackItems = () => { throw Object.assign(new Error('disk'), { code: 'STORAGE_FAILED' }); };
  await assert.rejects(() => value.packs.commitDraft('alice@example.test', draft.draftId, valid.revision), { code: 'STORAGE_FAILED' });
  value.persistence.insertStickerPackItems = originalInsert;
  assert.equal(value.persistence.listStickerPacks('alice@example.test').length, 0);
  await close(value);
});

test('E8.3-PACK-005 shared stickers remain in Mis stickers and deleting a referenced sticker conflicts', async () => {
  const value = await fixture();
  const create = async (name) => {
    const draft = await value.packs.createDraft('alice@example.test');
    const updated = await value.packs.updateDraft({ accountId: 'alice@example.test', draftId: draft.draftId, revision: draft.revision, name, description: '', stickerIds: [value.first.sticker.stickerId] });
    return value.packs.commitDraft('alice@example.test', draft.draftId, updated.revision);
  };
  const firstPack = await create('Uno');
  const secondPack = await create('Dos');
  assert.deepEqual(firstPack.stickerIds, secondPack.stickerIds);
  assert.equal(value.persistence.database.prepare('SELECT COUNT(*) AS count FROM sticker_assets WHERE account_id = ?').get('alice@example.test').count, 1);
  await assert.rejects(() => value.stickers.delete('alice@example.test', value.first.sticker.stickerId), { code: 'CONFLICT' });
  await value.packs.delete('alice@example.test', firstPack.packId, firstPack.revision);
  assert.ok(value.persistence.getSticker('alice@example.test', value.first.sticker.stickerId));
  await close(value);
});

test('E8.3-PACK-006 discards a draft and deletes package metadata without deleting stickers', async () => {
  const value = await fixture();
  const draft = await value.packs.createDraft('alice@example.test');
  const updated = await value.packs.updateDraft({ accountId: 'alice@example.test', draftId: draft.draftId, revision: draft.revision, name: 'Descartable', description: '', stickerIds: [value.first.sticker.stickerId] });
  await assert.rejects(() => value.stickers.delete('alice@example.test', value.first.sticker.stickerId), { code: 'CONFLICT' });
  await value.packs.discardDraft('alice@example.test', updated.draftId, updated.revision);
  assert.equal(value.persistence.listStickerDrafts('alice@example.test').length, 0);
  const savedDraft = await value.packs.createDraft('alice@example.test');
  const savedUpdate = await value.packs.updateDraft({ accountId: 'alice@example.test', draftId: savedDraft.draftId, revision: savedDraft.revision, name: 'Guardado', description: '', stickerIds: [value.first.sticker.stickerId] });
  const pack = await value.packs.commitDraft('alice@example.test', savedDraft.draftId, savedUpdate.revision);
  await value.packs.delete('alice@example.test', pack.packId, pack.revision);
  assert.ok(value.persistence.getSticker('alice@example.test', value.first.sticker.stickerId));
  await close(value);
});
