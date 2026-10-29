const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isTerminalState,
  transferError,
  transferView,
} = require('../electron/file-transfer-utils.cjs');
const { transferView: incomingView } = require('../electron/file-transfer.cjs');
const { transferView: outgoingView } = require('../electron/file-transfer-outgoing.cjs');

function record(overrides = {}) {
  return {
    offer: { transferId: 'file-test', accountId: 'account@example.invalid' },
    state: 'transferring',
    bytes: 9007199254740993123456789n,
    updatedAt: '2026-10-29T00:00:00.000Z',
    ...overrides,
  };
}

test('shared terminal-state predicate covers only the approved terminal states', () => {
  assert.equal(isTerminalState('completed'), true);
  assert.equal(isTerminalState('failed'), true);
  assert.equal(isTerminalState('cancelled'), true);
  assert.equal(isTerminalState('transferring'), false);
  assert.equal(isTerminalState(undefined), false);
});

test('shared transfer view preserves direction, decimal bytes and optional fields', () => {
  const current = record({ endReason: 'timed_out', errorCode: 'TRANSPORT_FAILED' });
  assert.deepEqual(transferView(current, 'incoming'), {
    offer: current.offer,
    direction: 'incoming',
    state: 'transferring',
    bytesTransferred: '9007199254740993123456789',
    endReason: 'timed_out',
    errorCode: 'TRANSPORT_FAILED',
    updatedAt: current.updatedAt,
  });
  assert.equal(transferView(record(), 'outgoing').bytesTransferred, '9007199254740993123456789');
});

test('coordinator view exports preserve incoming and outgoing directions', () => {
  const current = record({ bytes: 42n });
  assert.equal(incomingView(current).direction, 'incoming');
  assert.equal(outgoingView(current).direction, 'outgoing');
  assert.equal(incomingView(current).bytesTransferred, '42');
  assert.equal(outgoingView(current).bytesTransferred, '42');
});

test('shared transfer errors preserve the existing code contract', () => {
  const error = transferError('STORAGE_FAILED', 'storage failed');
  assert.equal(error.message, 'storage failed');
  assert.equal(error.code, 'STORAGE_FAILED');
});
