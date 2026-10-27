const test = require('node:test');
const assert = require('node:assert/strict');
const { XmppAdapter } = require('../electron/xmpp-adapter.cjs');

test('production rejects insecure XMPP TLS before opening a session', async () => {
  const adapter = new XmppAdapter(true);
  await assert.rejects(() => adapter.connect({ accountId: 'a@example.invalid', endpoint: { host: 'example.invalid', port: 5222, tls: false } }, 'synthetic'), /TLS_POLICY/);
  assert.equal(adapter.sessions.size, 0);
});

test('disconnect reports a stable idle state after a failed or absent session', async () => {
  const adapter = new XmppAdapter();
  await adapter.disconnect('a@example.invalid');
  assert.equal(adapter.states.get('a@example.invalid').status, 'idle');
  assert.equal(adapter.sessions.has('a@example.invalid'), false);
});

test('sending without a connected state is rejected even if a stale session entry exists', async () => {
  const adapter = new XmppAdapter();
  adapter.sessions.set('a@example.invalid', { send: async () => { throw new Error('should_not_send'); } });
  adapter.states.set('a@example.invalid', { accountId: 'a@example.invalid', status: 'failed', retryable: true, since: new Date().toISOString() });
  await assert.rejects(() => adapter.sendMessage('a@example.invalid', { to: 'b@example.invalid', body: { kind: 'text', text: 'x' } }), /not_connected/);
});
