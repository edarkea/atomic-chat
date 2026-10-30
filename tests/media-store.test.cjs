const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PersistenceStore } = require('../electron/storage.cjs');
const { MediaStore } = require('../electron/media-store.cjs');

const accountId = 'media@example.invalid';
const conversationId = 'contact@example.invalid';
const nativeImage = {
  createFromBuffer() {
    return { isEmpty: () => false, getSize: () => ({ width: 3, height: 2 }) };
  },
};

function jpegFixture() {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-media-'));
  const persistence = new PersistenceStore(directory);
  persistence.upsertAccount({
    accountId,
    host: 'example.invalid',
    port: 5222,
    tls: 1,
    credentialRef: null,
    createdAt: new Date().toISOString(),
  });
  return { directory, persistence };
}

function completedRecord(sourcePath, transferId, conversation = conversationId) {
  return {
    ownerSenderId: 7,
    state: 'completed',
    sourcePath,
    offer: {
      transferId,
      accountId,
      conversationId: conversation,
      senderJid: accountId,
      name: `${transferId}.jpg`,
      sizeBytes: String(jpegFixture().length),
      mimeType: 'image/jpeg',
      transport: 'ibb',
      offeredAt: '2026-01-02T00:00:00.000Z',
    },
  };
}

test('persists image metadata outside SQLite and rehydrates a mixed timeline', async () => {
  const { directory, persistence } = setup();
  const sourcePath = path.join(directory, 'source.jpg');
  await fsp.writeFile(sourcePath, jpegFixture());
  persistence.saveMessage({
    id: 'text-1',
    accountId,
    conversationId,
    clientMessageId: 'client-1',
    senderJid: accountId,
    body: { kind: 'text', text: 'antes' },
    status: 'sent',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  const media = new MediaStore(directory, persistence, nativeImage);
  const saved = await media.persistTransfer(
    {
      ownerSenderId: 7,
      state: 'completed',
      sourcePath,
      offer: {
        transferId: 'transfer-1',
        accountId,
        conversationId,
        senderJid: accountId,
        name: 'photo.jpg',
        sizeBytes: String(jpegFixture().length),
        mimeType: 'image/jpeg',
        transport: 'ibb',
        offeredAt: '2026-01-02T00:00:00.000Z',
      },
    },
    'outgoing',
  );
  assert.equal(saved.availability, 'available');
  assert.equal(saved.mimeType, 'image/jpeg');
  assert.equal(saved.width, 3);
  assert.equal(saved.height, 2);
  assert.equal(persistence.database.prepare('SELECT COUNT(*) AS count FROM media_assets').get().count, 1);
  assert.equal(persistence.database.prepare('SELECT COUNT(*) AS count FROM media_assets WHERE storage_key IS NOT NULL').get().count, 1);
  const page = persistence.listTimelinePage(accountId, conversationId, 10, 'older', null);
  assert.deepEqual(page.items.map((item) => item.kind), ['text', 'image']);
  persistence.close();

  const reopened = new PersistenceStore(directory);
  const rehydrated = new MediaStore(directory, reopened, nativeImage);
  assert.equal(rehydrated.list(accountId, conversationId)[0].mediaId, saved.mediaId);
  const resolved = await rehydrated.resolveForPreview(7, {
    accountId,
    transferId: 'transfer-1',
    conversationId,
    mediaId: saved.mediaId,
  });
  assert.equal(path.basename(resolved.path), `${saved.mediaId}.bin`);
  reopened.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('serializes repeated persistence and isolates listener failures', async () => {
  const { directory, persistence } = setup();
  const sourcePath = path.join(directory, 'source.jpg');
  await fsp.writeFile(sourcePath, jpegFixture());
  const media = new MediaStore(directory, persistence, nativeImage);
  let inspections = 0;
  const inspect = media.readAndInspect.bind(media);
  media.readAndInspect = async (...args) => {
    inspections += 1;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return inspect(...args);
  };
  media.onEvent(() => {
    throw new Error('renderer listener failed');
  });
  const record = completedRecord(sourcePath, 'transfer-concurrent');
  const [first, second] = await Promise.all([
    media.persistTransfer(record, 'outgoing'),
    media.persistTransfer(record, 'outgoing'),
  ]);
  assert.equal(first.availability, 'available');
  assert.equal(second.mediaId, first.mediaId);
  assert.equal(inspections, 1);
  assert.equal(
    persistence.database.prepare('SELECT COUNT(*) AS count FROM media_assets').get().count,
    1,
  );
  assert.equal(
    fs.existsSync(path.join(directory, 'media', `${first.mediaId}.bin`)),
    true,
  );
  persistence.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('compensates a SQLite failure after publication without removing an earlier asset', async () => {
  const { directory, persistence } = setup();
  const sourcePath = path.join(directory, 'source.jpg');
  await fsp.writeFile(sourcePath, jpegFixture());
  const media = new MediaStore(directory, persistence, nativeImage);
  const first = await media.persistTransfer(
    completedRecord(sourcePath, 'transfer-preserved'),
    'outgoing',
  );
  const firstPath = path.join(directory, 'media', `${first.mediaId}.bin`);
  const firstBytes = await fsp.readFile(firstPath);

  const originalUpsert = persistence.upsertMedia.bind(persistence);
  persistence.upsertMedia = () => {
    throw new Error('sqlite unavailable');
  };
  const failed = await media.persistTransfer(
    completedRecord(sourcePath, 'transfer-failed'),
    'outgoing',
  );
  assert.equal(failed, null);
  assert.deepEqual(await fsp.readFile(firstPath), firstBytes);
  assert.equal(
    (await fsp.readdir(path.join(directory, 'media'))).filter((name) => name.endsWith('.bin'))
      .length,
    1,
  );
  persistence.upsertMedia = originalUpsert;
  persistence.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('pages 120 mixed records and lists an image-only conversation', () => {
  const { directory, persistence } = setup();
  const mixedConversation = 'mixed@example.invalid';
  for (let index = 0; index < 120; index += 1) {
    const createdAt = new Date(1_700_000_000_000 + index).toISOString();
    if (index % 2 === 0) {
      persistence.saveMessage({
        id: `text-${index}`,
        accountId,
        conversationId: mixedConversation,
        clientMessageId: `client-${index}`,
        senderJid: accountId,
        body: { kind: 'text', text: String(index) },
        status: 'sent',
        createdAt,
      });
    } else {
      persistence.upsertMedia(
        {
          mediaId: `media-${index}`,
          transferId: `transfer-${index}`,
          accountId,
          conversationId: mixedConversation,
          direction: 'incoming',
          senderJid: 'contact@example.invalid',
          originalName: `image-${index}.jpg`,
          mimeType: 'image/jpeg',
          sizeBytes: '23',
          width: 3,
          height: 2,
          createdAt,
          availability: 'missing',
        },
        null,
      );
    }
  }
  persistence.upsertMedia(
    {
      mediaId: 'image-only-1',
      transferId: 'image-only-transfer',
      accountId,
      conversationId: 'images-only@example.invalid',
      direction: 'incoming',
      senderJid: 'contact@example.invalid',
      originalName: 'only.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: '23',
      width: 3,
      height: 2,
      createdAt: '2026-01-03T00:00:00.000Z',
      availability: 'missing',
    },
    null,
  );

  const ids = [];
  let cursor = null;
  let page;
  do {
    page = persistence.listTimelinePage(accountId, mixedConversation, 50, 'older', cursor);
    ids.push(...page.items.map((item) => item.id));
    const first = page.items[0];
    cursor = page.hasMore && first ? { createdAt: first.sortAt, id: first.id } : null;
  } while (page.hasMore);
  assert.equal(ids.length, 120);
  assert.equal(new Set(ids).size, 120);
  assert.ok(ids.some((id) => id.startsWith('text-')));
  assert.ok(ids.some((id) => id.startsWith('media-')));
  assert.equal(persistence.listMedia(accountId, mixedConversation, 3).length, 3);
  assert.ok(
    persistence
      .listConversations(accountId)
      .some((conversation) => conversation.jid === 'images-only@example.invalid'),
  );
  persistence.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
