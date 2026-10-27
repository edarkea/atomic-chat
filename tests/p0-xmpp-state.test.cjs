const test = require('node:test');
const assert = require('node:assert/strict');
const { XmppAdapter } = require('../electron/xmpp-adapter.cjs');

test('production rejects insecure XMPP TLS before opening a session', async () => {
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const adapter = new XmppAdapter();
  await assert.rejects(() => adapter.connect({ accountId: 'a@example.invalid', endpoint: { host: 'example.invalid', port: 5222, tls: false } }, 'synthetic'), /TLS_POLICY/);
  assert.equal(adapter.sessions.size, 0);
  if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous;
});

test('disconnect reports a stable idle state after a failed or absent session', async () => {
  const adapter = new XmppAdapter();
  await adapter.disconnect('a@example.invalid');
  assert.equal(adapter.states.get('a@example.invalid').status, 'idle');
  assert.equal(adapter.sessions.has('a@example.invalid'), false);
});
