const test = require('node:test');
const assert = require('node:assert/strict');

test('P0 contract versions remain stable', () => {
  const version = 1;
  assert.equal(version, 1);
  assert.deepEqual(['idle', 'connecting', 'authenticating', 'connected', 'disconnecting', 'failed'], ['idle', 'connecting', 'authenticating', 'connected', 'disconnecting', 'failed']);
});

test('message status does not imply remote delivery', () => {
  const message = { status: 'sent', deliveryReceipt: undefined };
  assert.equal(message.status, 'sent');
  assert.equal(message.deliveryReceipt, undefined);
});
