const test = require('node:test');
const assert = require('node:assert/strict');
const { createHistorySecurity } = require('../electron/history-security.cjs');

const input = (accountId, conversationId = 'contact@example.invalid') => ({ version: 1, requestId: 'request-1', accountId, conversationId, limit: 50, direction: 'older', cursor: null });

test('history authorization isolates two windows and supports disconnected configured access', () => {
  const security = createHistorySecurity('one@example.invalid');
  assert.equal(security.authorize(101, 'one@example.invalid'), true);
  assert.equal(security.authorize(101, 'two@example.invalid'), false);
  assert.equal(security.authorize(202, 'two@example.invalid'), false);
  security.completeConnection(202, security.beginConnection(202, 'connect-2'), 'two@example.invalid');
  assert.equal(security.authorize(202, 'two@example.invalid'), true);
  assert.equal(security.authorize(101, 'two@example.invalid'), false);
});

test('concurrent connections with repeated request ids only commit the latest token', () => {
  const security = createHistorySecurity('');
  const first = security.beginConnection(7, 'same-request'); const second = security.beginConnection(7, 'same-request');
  security.completeConnection(7, first, 'one@example.invalid'); assert.equal(security.authorize(7, 'one@example.invalid'), false);
  security.completeConnection(7, second, 'two@example.invalid'); assert.equal(security.authorize(7, 'two@example.invalid'), true);
  security.destroySender(7); assert.equal(security.authorize(7, 'two@example.invalid'), false);
});

test('cursor integrity and context are validated', () => {
  const security = createHistorySecurity('one@example.invalid'); const value = { accountId: 'one@example.invalid', conversationId: 'a@example.invalid', lower: { createdAt: '2026-01-01', id: '1' }, upper: { createdAt: '2026-01-02', id: '2' } }; const cursor = security.encodeCursor(value);
  assert.deepEqual(security.decodeCursor(cursor, value.accountId, value.conversationId), value);
  assert.throws(() => security.decodeCursor(`${cursor}x`, value.accountId, value.conversationId), /INVALID_INPUT/);
  assert.throws(() => security.decodeCursor(cursor, value.accountId, 'other@example.invalid'), /INVALID_INPUT/);
  assert.throws(() => security.decodeCursor(cursor, 'two@example.invalid', value.conversationId), /INVALID_INPUT/);
  assert.deepEqual(input('one@example.invalid').requestId, 'request-1');
});
