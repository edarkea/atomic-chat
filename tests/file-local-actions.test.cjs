const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { FileLocalActionRegistry } = require('../electron/file-local-actions.cjs');

const ACCOUNT = 'one@example.invalid';
const PATH = 'C:\\AtomicChat\\received\\report.pdf';

function stats(overrides = {}) {
  return {
    dev: 1,
    ino: 2,
    size: 42,
    mtimeMs: 100,
    ctimeMs: 100,
    birthtimeMs: 90,
    isFile: () => true,
    isSymbolicLink: () => false,
    ...overrides,
  };
}

function completedRecord(overrides = {}) {
  return {
    state: 'completed',
    ownerSenderId: 7,
    destination: PATH,
    offer: { transferId: 'file-1', accountId: ACCOUNT },
    ...overrides,
  };
}

test('completed references open and reveal through injected shell APIs', async () => {
  const opened = [];
  const revealed = [];
  const registry = new FileLocalActionRegistry({
    lstat: async () => stats(),
    shell: {
      openPath: async (filePath) => {
        opened.push(filePath);
        return '';
      },
      showItemInFolder: (filePath) => revealed.push(filePath),
    },
  });
  assert.equal(await registry.register(completedRecord(), 'incoming'), true);
  await registry.open(7, { accountId: ACCOUNT, transferId: 'file-1' });
  await registry.reveal(7, { accountId: ACCOUNT, transferId: 'file-1' });
  assert.deepEqual(opened, [PATH]);
  assert.deepEqual(revealed, [PATH]);
});

test('physical-link cleanup keeps an incoming completed file openable and revealable', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'atomic-chat-c5-'));
  const temporary = path.join(directory, 'atomic-source.part');
  const destination = path.join(directory, 'theme.html');
  const opened = [];
  const revealed = [];
  try {
    await fsp.writeFile(temporary, 'x'.repeat(84538));
    await fsp.link(temporary, destination);
    const registry = new FileLocalActionRegistry({
      shell: {
        openPath: async (filePath) => {
          opened.push(filePath);
          return '';
        },
        showItemInFolder: (filePath) => revealed.push(filePath),
      },
    });
    assert.equal(await registry.register(completedRecord({ destination }), 'incoming'), true);
    await fsp.unlink(temporary);
    await registry.open(7, { accountId: ACCOUNT, transferId: 'file-1' });
    await registry.reveal(7, { accountId: ACCOUNT, transferId: 'file-1' });
    assert.deepEqual(opened, [destination]);
    assert.deepEqual(revealed, [destination]);
  } finally {
    await fsp.rm(directory, { recursive: true, force: true });
  }
});

test('ctime changes from legitimate cleanup do not invalidate an incoming reference', async () => {
  let calls = 0;
  const opened = [];
  const revealed = [];
  const registry = new FileLocalActionRegistry({
    lstat: async () => stats({ ctimeMs: ++calls }),
    shell: {
      openPath: async (filePath) => {
        opened.push(filePath);
        return '';
      },
      showItemInFolder: (filePath) => revealed.push(filePath),
    },
  });
  assert.equal(await registry.register(completedRecord(), 'incoming'), true);
  await registry.open(7, { accountId: ACCOUNT, transferId: 'file-1' });
  await registry.reveal(7, { accountId: ACCOUNT, transferId: 'file-1' });
  assert.deepEqual(opened, [PATH]);
  assert.deepEqual(revealed, [PATH]);
});

test('outgoing completed references use the original source file', async () => {
  const opened = [];
  const revealed = [];
  const sourcePath = 'relative/source/report.pdf';
  const registry = new FileLocalActionRegistry({
    lstat: async () => stats(),
    shell: {
      openPath: async (filePath) => {
        opened.push(filePath);
        return '';
      },
      showItemInFolder: (filePath) => revealed.push(filePath),
    },
  });
  assert.equal(
    await registry.register(completedRecord({ sourcePath, destination: undefined }), 'outgoing'),
    true,
  );
  await registry.open(7, { accountId: ACCOUNT, transferId: 'file-1' });
  await registry.reveal(7, { accountId: ACCOUNT, transferId: 'file-1' });
  assert.equal(opened.length, 1);
  assert.deepEqual(revealed, opened);
});

test('unknown, foreign, failed, symbolic and replaced references are rejected', async () => {
  let current = stats();
  const shell = { openPath: async () => '' };
  const registry = new FileLocalActionRegistry({ lstat: async () => current, shell });
  assert.equal(await registry.register(completedRecord(), 'incoming'), true);
  await assert.rejects(
    registry.open(8, { accountId: ACCOUNT, transferId: 'file-1' }),
    (error) => error.code === 'UNAUTHORIZED',
  );
  await assert.rejects(
    registry.open(7, { accountId: 'two@example.invalid', transferId: 'file-1' }),
    (error) => error.code === 'UNAUTHORIZED',
  );
  await assert.rejects(
    registry.open(7, { accountId: ACCOUNT, transferId: 'unknown' }),
    (error) => error.code === 'UNAUTHORIZED',
  );
  current = stats({ isSymbolicLink: () => true });
  await assert.rejects(
    registry.open(7, { accountId: ACCOUNT, transferId: 'file-1' }),
    (error) => error.code === 'STORAGE_FAILED',
  );
  current = stats({ mtimeMs: 101 });
  await assert.rejects(
    registry.open(7, { accountId: ACCOUNT, transferId: 'file-1' }),
    (error) => error.code === 'STORAGE_FAILED',
  );
  assert.equal(await registry.register(completedRecord({ state: 'failed' }), 'incoming'), false);
});

test('registry is bounded and references are removed with the authorized renderer', async () => {
  const registry = new FileLocalActionRegistry({
    maxReferences: 1,
    lstat: async () => stats(),
    shell: { openPath: async () => '' },
  });
  assert.equal(await registry.register(completedRecord(), 'incoming'), true);
  assert.equal(
    await registry.register(
      completedRecord({ offer: { transferId: 'file-2', accountId: ACCOUNT } }),
      'incoming',
    ),
    true,
  );
  await assert.rejects(
    registry.open(7, { accountId: ACCOUNT, transferId: 'file-1' }),
    (error) => error.code === 'UNAUTHORIZED',
  );
  await registry.open(7, { accountId: ACCOUNT, transferId: 'file-2' });
  registry.clearSender(7);
  await assert.rejects(
    registry.open(7, { accountId: ACCOUNT, transferId: 'file-2' }),
    (error) => error.code === 'UNAUTHORIZED',
  );
});
