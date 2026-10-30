const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { FileHistoryStore } = require('../electron/file-history.cjs');
const { PersistenceStore } = require('../electron/storage.cjs');

const ACCOUNT = 'one@example.invalid';
const OTHER_ACCOUNT = 'two@example.invalid';
const CONVERSATION = 'contact@example.invalid';

function setup() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-file-history-'));
  const persistence = new PersistenceStore(directory);
  for (const accountId of [ACCOUNT, OTHER_ACCOUNT])
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

function completed(sourcePath, transferId, accountId = ACCOUNT, name = 'document.pdf') {
  return {
    state: 'completed',
    sourcePath,
    destination: sourcePath,
    updatedAt: '2026-01-02T00:00:00.000Z',
    offer: {
      transferId,
      accountId,
      conversationId: CONVERSATION,
      senderJid: accountId,
      name,
      sizeBytes: '7',
      mimeType: 'application/pdf',
      transport: 'ibb',
      offeredAt: '2026-01-01T00:00:00.000Z',
    },
  };
}

async function withSetup(callback) {
  const context = setup();
  try {
    await callback(context);
  } finally {
    context.persistence.close();
    fs.rmSync(context.directory, { recursive: true, force: true });
  }
}

test('persists incoming and outgoing history by path without copying bytes', async () => {
  await withSetup(async ({ directory, persistence }) => {
    const source = path.join(directory, 'document.pdf');
    await fsp.writeFile(source, 'payload');
    const store = new FileHistoryStore(persistence, { openPath: async () => '' });
    const saved = await store.persistTransfer(completed(source, 'incoming-1'), 'incoming');
    assert.equal(saved.availability, 'available');
    assert.equal(saved.originalName, 'document.pdf');
    assert.equal(saved.sizeBytes, '7');
    assert.equal(Object.hasOwn(saved, 'localPath'), false);
    assert.equal(fs.existsSync(path.join(directory, 'media')), false);
    const outgoing = await store.persistTransfer(completed(source, 'outgoing-1'), 'outgoing');
    assert.equal(outgoing.direction, 'outgoing');
    assert.equal(persistence.database.prepare('SELECT COUNT(*) AS count FROM file_assets').get().count, 2);
  });
});

test('migration v9 and repeated persistence are idempotent', async () => {
  await withSetup(async ({ directory, persistence }) => {
    const source = path.join(directory, 'repeat.pdf');
    await fsp.writeFile(source, 'payload');
    const store = new FileHistoryStore(persistence, {});
    const record = completed(source, 'repeat-1');
    const [first, second] = await Promise.all([
      store.persistTransfer(record, 'outgoing'),
      store.persistTransfer(record, 'outgoing'),
    ]);
    assert.equal(first.fileId, second.fileId);
    assert.equal(persistence.database.prepare('SELECT version FROM schema_meta').get().version, 9);
    assert.equal(persistence.database.prepare('SELECT COUNT(*) AS count FROM file_assets').get().count, 1);
    const page = persistence.listTimelinePage(ACCOUNT, CONVERSATION, 10, 'older', null);
    assert.deepEqual(page.items.map((item) => item.kind), ['file']);
    assert.equal(Object.hasOwn(page.items[0].file, 'localPath'), false);
  });
});

test('mixed timeline and conversation index include files without duplicating C6 images', async () => {
  await withSetup(async ({ directory, persistence }) => {
    const source = path.join(directory, 'mixed.pdf');
    await fsp.writeFile(source, 'payload');
    persistence.saveMessage({
      id: 'text-1',
      accountId: ACCOUNT,
      conversationId: CONVERSATION,
      clientMessageId: 'client-1',
      senderJid: ACCOUNT,
      body: { kind: 'text', text: 'texto' },
      status: 'sent',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    persistence.upsertMedia({
      mediaId: 'media-1',
      accountId: ACCOUNT,
      transferId: 'image-1',
      conversationId: CONVERSATION,
      direction: 'incoming',
      senderJid: 'contact@example.invalid',
      originalName: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: '3',
      width: 1,
      height: 1,
      createdAt: '2026-01-02T00:00:00.000Z',
      availability: 'missing',
    });
    const store = new FileHistoryStore(persistence, {});
    const fileRecord = completed(source, 'file-1');
    fileRecord.updatedAt = '2026-01-03T00:00:00.000Z';
    await store.persistTransfer(fileRecord, 'incoming');
    const page = persistence.listTimelinePage(ACCOUNT, CONVERSATION, 10, 'older', null);
    assert.deepEqual(page.items.map((item) => item.kind), ['text', 'image', 'file']);
    assert.deepEqual(
      persistence.listConversations(ACCOUNT).map((item) => item.jid),
      [CONVERSATION],
    );
  });
});

test('refresh marks moved, changed and symlinked files without deleting history', async () => {
  await withSetup(async ({ directory, persistence }) => {
    const source = path.join(directory, 'tracked.pdf');
    await fsp.writeFile(source, 'payload');
    const store = new FileHistoryStore(persistence, {});
    const saved = await store.persistTransfer(completed(source, 'state-1'), 'outgoing');
    await fsp.appendFile(source, '!');
    assert.equal((await store.refreshFile(ACCOUNT, saved.fileId)).availability, 'changed');
    await fsp.rm(source);
    assert.equal((await store.refreshFile(ACCOUNT, saved.fileId)).availability, 'missing');
    const replacement = path.join(directory, 'replacement.pdf');
    await fsp.writeFile(replacement, 'replacement');
    await fsp.symlink(replacement, source);
    assert.equal((await store.refreshFile(ACCOUNT, saved.fileId)).availability, 'blocked');
    assert.equal(persistence.getFileAsset(ACCOUNT, saved.fileId).fileId, saved.fileId);
  });
});

test('historical actions require the recorded conversation and current identity', async () => {
  await withSetup(async ({ directory, persistence }) => {
    const source = path.join(directory, 'safe.pdf');
    await fsp.writeFile(source, 'payload');
    const opened = [];
    const revealed = [];
    const store = new FileHistoryStore(persistence, {
      openPath: async (filePath) => {
        opened.push(filePath);
        return '';
      },
      showItemInFolder: (filePath) => revealed.push(filePath),
    });
    const saved = await store.persistTransfer(completed(source, 'action-1'), 'outgoing');
    await store.open(ACCOUNT, CONVERSATION, saved.fileId);
    await store.reveal(ACCOUNT, CONVERSATION, saved.fileId);
    assert.deepEqual(opened, [source]);
    assert.deepEqual(revealed, [source]);
    await assert.rejects(
      store.open(OTHER_ACCOUNT, CONVERSATION, saved.fileId),
      (error) => error.code === 'UNAUTHORIZED',
    );
    await assert.rejects(
      store.open(ACCOUNT, 'other@example.invalid', saved.fileId),
      (error) => error.code === 'UNAUTHORIZED',
    );
  });
});

test('revalidates the path and authorization immediately before a historical action', async () => {
  await withSetup(async ({ directory, persistence }) => {
    const source = path.join(directory, 'async.pdf');
    await fsp.writeFile(source, 'payload');
    const opened = [];
    let releaseValidation;
    const validation = new Promise((resolve) => { releaseValidation = resolve; });
    let lstatCalls = 0;
    const store = new FileHistoryStore(persistence, {
      openPath: async (filePath) => { opened.push(filePath); return ''; },
    }, {
      lstat: async (filePath) => {
        lstatCalls += 1;
        if (lstatCalls === 2) await validation;
        return fsp.lstat(filePath, { bigint: true });
      },
    });
    const saved = await store.persistTransfer(completed(source, 'async-action-1'), 'outgoing');
    let authorized = true;
    const action = store.open(ACCOUNT, CONVERSATION, saved.fileId, () => authorized);
    await new Promise((resolve) => setImmediate(resolve));
    authorized = false;
    releaseValidation();
    await assert.rejects(action, (error) => error.code === 'UNAUTHORIZED');
    assert.deepEqual(opened, []);
  });
});

test('does not open a file replaced by a symlink between validation phases', async () => {
  await withSetup(async ({ directory, persistence }) => {
    const source = path.join(directory, 'safe.pdf');
    await fsp.writeFile(source, 'payload');
    const opened = [];
    const store = new FileHistoryStore(persistence, {
      openPath: async (filePath) => { opened.push(filePath); return ''; },
    });
    const saved = await store.persistTransfer(completed(source, 'race-1'), 'outgoing');
    const originalLstat = store.lstat;
    let calls = 0;
    store.lstat = async (filePath) => {
      calls += 1;
      if (calls === 2) return { isSymbolicLink: () => true, isFile: () => false };
      return originalLstat(filePath);
    };
    await assert.rejects(
      store.open(ACCOUNT, CONVERSATION, saved.fileId),
      (error) => error.code === 'STORAGE_FAILED',
    );
    assert.deepEqual(opened, []);
  });
});

test('blocks executable extensions from the recorded name as well as the local path', async () => {
  await withSetup(async ({ directory, persistence }) => {
    const source = path.join(directory, 'downloaded-file');
    await fsp.writeFile(source, 'payload');
    const opened = [];
    const store = new FileHistoryStore(persistence, {
      openPath: async (filePath) => { opened.push(filePath); return ''; },
    });
    const saved = await store.persistTransfer(
      completed(source, 'blocked-extension-1', ACCOUNT, 'payload.exe'),
      'outgoing',
    );
    await assert.rejects(
      store.open(ACCOUNT, CONVERSATION, saved.fileId),
      (error) => error.code === 'UNSUPPORTED',
    );
    assert.deepEqual(opened, []);
  });
});

test('SQLite failure does not alter the transfer source or create a binary copy', async () => {
  await withSetup(async ({ directory, persistence }) => {
    const source = path.join(directory, 'sqlite-failure.pdf');
    await fsp.writeFile(source, 'payload');
    const store = new FileHistoryStore(persistence, {});
    persistence.upsertFileAsset = () => {
      throw new Error('sqlite unavailable');
    };
    assert.equal(await store.persistTransfer(completed(source, 'failure-1'), 'incoming'), null);
    assert.equal(await fsp.readFile(source, 'utf8'), 'payload');
    assert.equal(fs.readdirSync(directory).some((name) => name === 'media'), false);
  });
});
