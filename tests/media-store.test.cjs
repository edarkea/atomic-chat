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
