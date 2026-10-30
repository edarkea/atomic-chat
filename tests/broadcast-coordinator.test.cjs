const test = require('node:test');
const assert = require('node:assert/strict');
const { createBroadcastCoordinator } = require('../electron/broadcast-coordinator.cjs');

test('coordinator sends unique bare JIDs without invoking persistence', async () => {
  const sent = [];
  const xmpp = {
    sessions: new Map([['a@example.invalid', {}]]),
    states: new Map([['a@example.invalid', { status: 'connected' }]]),
    sendMessage: async (accountId, input) => {
      sent.push({ accountId, input });
    },
  };
  const result = await createBroadcastCoordinator({ xmpp }).send({
    version: 1,
    requestId: 'request-1',
    accountId: 'a@example.invalid',
    broadcastId: 'broadcast-1',
    recipientJids: ['b@example.invalid/mobile', 'b@example.invalid', 'c@example.invalid'],
    body: { kind: 'text', text: 'hola' },
  });
  assert.deepEqual(
    sent.map((item) => item.input.to),
    ['b@example.invalid', 'c@example.invalid'],
  );
  assert.deepEqual(
    sent.map((item) => item.input.mode),
    ['normal', 'normal'],
  );
  assert.deepEqual(
    result.recipients.map((item) => item.status),
    ['submitted', 'submitted'],
  );
  assert.equal(new Set(result.recipients.map((item) => item.clientMessageId)).size, 2);
});

test('coordinator propagates alert mode to every individual XMPP send', async () => {
  const sent = [];
  const xmpp = {
    sessions: new Map([['a@example.invalid', {}]]),
    states: new Map([['a@example.invalid', { status: 'connected' }]]),
    sendMessage: async (_accountId, input) => sent.push(input),
  };
  await createBroadcastCoordinator({ xmpp }).send({
    version: 1,
    requestId: 'request-alert',
    accountId: 'a@example.invalid',
    broadcastId: 'broadcast-alert',
    mode: 'alert',
    recipientJids: ['b@example.invalid'],
    body: { kind: 'text', text: 'alerta' },
  });
  assert.equal(sent[0].mode, 'alert');
  assert.equal(sent[0].broadcast, true);
});

test('coordinator reports uncertain transport errors without retrying automatically', async () => {
  let calls = 0;
  const xmpp = {
    sessions: new Map([['a@example.invalid', {}]]),
    states: new Map([['a@example.invalid', { status: 'connected' }]]),
    sendMessage: async () => {
      calls += 1;
      throw new Error('socket closed after write');
    },
  };
  const result = await createBroadcastCoordinator({ xmpp }).send({
    version: 1,
    requestId: 'request-2',
    accountId: 'a@example.invalid',
    broadcastId: 'broadcast-2',
    recipientJids: ['b@example.invalid'],
    body: { kind: 'text', text: 'hola' },
  });
  assert.equal(calls, 1);
  assert.equal(result.recipients[0].status, 'unknown');
  assert.equal(result.recipients[0].errorCode, 'TRANSPORT_FAILED');
});
