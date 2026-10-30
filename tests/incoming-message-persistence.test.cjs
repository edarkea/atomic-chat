const test = require('node:test');
const assert = require('node:assert/strict');
const { createIncomingMessageProcessor } = require('../electron/incoming-message-persistence.cjs');

const message = {
  id: 'message-1',
  accountId: 'receiver@example.invalid',
  conversationId: 'sender@example.invalid',
  clientMessageId: 'client-1',
  senderJid: 'sender@example.invalid',
  body: { kind: 'text', text: 'difusión' },
  status: 'sent',
  createdAt: '2026-10-30T00:00:00.000Z',
};

test('marks incoming messages persisted before forwarding them', () => {
  const saved = [];
  const process = createIncomingMessageProcessor({
    persistence: { saveMessage: (value) => saved.push(value) },
  });
  const result = process({ type: 'message.received', payload: message });
  assert.equal(result.payload.persistenceStatus, 'persisted');
  assert.deepEqual(saved, [{ ...message, classification: 'direct' }]);
});

test('preserves the explicit broadcast classification before persistence', () => {
  const saved = [];
  const process = createIncomingMessageProcessor({
    persistence: { saveMessage: (value) => saved.push(value) },
  });
  const result = process({
    type: 'message.received',
    payload: { ...message, classification: 'broadcast' },
  });
  assert.equal(result.payload.classification, 'broadcast');
  assert.equal(saved[0].classification, 'broadcast');
});

test('keeps incoming messages in memory and exposes storage failure', () => {
  const errors = [];
  const process = createIncomingMessageProcessor({
    persistence: {
      saveMessage: () => {
        throw new Error('SQLITE_BUSY');
      },
    },
    onPersistenceError: (error) => errors.push(error.message),
  });
  const result = process({ type: 'message.received', payload: message });
  assert.equal(result.payload.persistenceStatus, 'memory-only');
  assert.equal(result.payload.errorCode, 'STORAGE_FAILED');
  assert.deepEqual(errors, ['SQLITE_BUSY']);
});
