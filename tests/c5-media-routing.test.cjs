const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { PersistenceStore } = require('../electron/storage.cjs');
const { MediaStore } = require('../electron/media-store.cjs');
const { persistCompletedTransfer } = require('../electron/media-transfer-persistence.cjs');

const accountId = 'media-routing@example.invalid';
const conversationId = 'contact@example.invalid';
const pngFixture = () => Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const jpegFixture = () => Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x02, 0x00, 0x03,
  0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00, 0xff, 0xd9,
]);
const nativeImage = {
  createFromBuffer(buffer) {
    const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    return { isEmpty: () => false, getSize: () => (png ? { width: 1, height: 1 } : { width: 3, height: 2 }) };
  },
};

function completed(sourcePath, transferId, name) {
  return {
    state: 'completed',
    sourcePath,
    destination: sourcePath,
    offer: {
      transferId,
      accountId,
      conversationId,
      senderJid: accountId,
      name,
      sizeBytes: String(fs.statSync(sourcePath).size),
      transport: 'ibb',
      offeredAt: '2026-01-02T00:00:00.000Z',
    },
  };
}

async function setup() {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'atomic-chat-c5-media-'));
  const persistence = new PersistenceStore(directory);
  persistence.upsertAccount({
    accountId,
    host: 'example.invalid',
    port: 5222,
    tls: 1,
    credentialRef: null,
    createdAt: new Date().toISOString(),
  });
  return { directory, persistence, media: new MediaStore(directory, persistence, nativeImage) };
}

test('routes MIME-less PNG and JPEG transfers through the real image inspection path', async () => {
  const context = await setup();
  try {
    for (const [transferId, name, bytes, mimeType] of [
      ['png-without-mime', 'photo.png', pngFixture(), 'image/png'],
      ['jpeg-without-mime', 'photo.jpg', jpegFixture(), 'image/jpeg'],
    ]) {
      const sourcePath = path.join(context.directory, name);
      await fsp.writeFile(sourcePath, bytes);
      const fileHistory = { persistTransfer: async () => { throw new Error('no C5 fallback'); } };
      const saved = await persistCompletedTransfer({
        record: completed(sourcePath, transferId, name),
        direction: 'incoming',
        media: context.media,
        fileHistory,
      });
      assert.equal(saved.mimeType, mimeType);
      assert.equal(saved.availability, 'available');
    }
  } finally {
    context.persistence.close();
    await fsp.rm(context.directory, { recursive: true, force: true });
  }
});

test('routes a MIME-less non-image only to the path-based C5 history store', async () => {
  const context = await setup();
  try {
    const sourcePath = path.join(context.directory, 'document.bin');
    await fsp.writeFile(sourcePath, 'not an image');
    let mediaPersisted = false;
    let historyPersisted = false;
    const media = {
      isStaticImageCandidate: context.media.isStaticImageCandidate.bind(context.media),
      persistTransfer: async () => { mediaPersisted = true; return null; },
    };
    const fileHistory = { persistTransfer: async () => { historyPersisted = true; } };
    await persistCompletedTransfer({
      record: completed(sourcePath, 'document-without-mime', 'document.bin'),
      direction: 'incoming',
      media,
      fileHistory,
    });
    assert.equal(mediaPersisted, false);
    assert.equal(historyPersisted, true);
  } finally {
    context.persistence.close();
    await fsp.rm(context.directory, { recursive: true, force: true });
  }
});
