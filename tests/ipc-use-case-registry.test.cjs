const test = require('node:test');
const assert = require('node:assert/strict');
const { IPC_USE_CASES, registerIpcUseCases } = require('../electron/ipc/ipc-use-case-registry.cjs');

test('global IPC use-case registry is unique, ordered and executable', () => {
  assert.deepEqual(
    IPC_USE_CASES.map((useCase) => useCase.name),
    [
      'account',
      'broadcast',
      'muc',
      'file',
      'preview',
      'file-history',
      'stickers',
      'sticker-packs',
      'sticker-messages',
      'history',
      'preferences',
      'connection-profiles',
      'attention',
      'updates',
      'external-links',
      'games',
    ],
  );
  assert.equal(new Set(IPC_USE_CASES.map((useCase) => useCase.name)).size, IPC_USE_CASES.length);
  assert.ok(IPC_USE_CASES.every((useCase) => typeof useCase.register === 'function'));

  const registered = [];
  registerIpcUseCases({
    ipcMain: { handle: (channel) => registered.push(channel) },
    helpers: {},
    marker: true,
  });
  assert.ok(registered.length > 0);
  assert.equal(new Set(registered).size, registered.length);
});
