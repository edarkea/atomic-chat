const test = require('node:test');
const assert = require('node:assert/strict');
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
