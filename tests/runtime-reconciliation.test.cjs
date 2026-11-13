const test = require('node:test');
const assert = require('node:assert/strict');
const { startRuntimeReconciliation } = require('../electron/application/runtime.cjs');

function deferred() {
  let release;
  const promise = new Promise((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

test('runtime reconciliation waits for media and stickers before settling', async () => {
  const media = deferred();
  const stickers = deferred();
  const logger = { error: () => {} };
  const reconciliation = startRuntimeReconciliation(
    { reconcile: () => media.promise },
    { reconcile: () => stickers.promise },
    logger,
  );
  let settled = false;
  void reconciliation.then(() => {
    settled = true;
  });

  await Promise.resolve();
  assert.equal(settled, false);
  media.release('media-ready');
  await Promise.resolve();
  assert.equal(settled, false);
  stickers.release('stickers-ready');

  const results = await reconciliation;
  assert.deepEqual(results, [
    { status: 'fulfilled', value: 'media-ready' },
    { status: 'fulfilled', value: 'stickers-ready' },
  ]);
});

test('runtime reconciliation observes failures without creating an unhandled rejection', async () => {
  const failure = new Error('reconciliation failed');
  const errors = [];
  const results = await startRuntimeReconciliation(
    {
      reconcile: async () => {
        throw failure;
      },
    },
    { reconcile: async () => 'stickers-ready' },
    { error: (...args) => errors.push(args) },
  );

  assert.equal(results[0].status, 'rejected');
  assert.equal(results[0].reason, failure);
  assert.deepEqual(errors, [['[RUNTIME-RECONCILIATION-FAILED]', failure]]);
});
