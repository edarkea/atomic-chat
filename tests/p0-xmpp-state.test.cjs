const test = require('node:test');
const assert = require('node:assert/strict');
const { XmppAdapter } = require('../electron/xmpp-adapter.cjs');

test('presence modes use available stanzas with RFC show/status children', async () => {
  const adapter = new XmppAdapter(); const sent = []; adapter.sessions.set('a@example.invalid', { send: async (stanza) => sent.push(stanza) });
  for (const [mode, status] of [['chat', undefined], [undefined, undefined], ['away', undefined], ['away', 'Al teléfono'], ['xa', undefined], ['dnd', undefined]]) await adapter.setPresence('a@example.invalid', { availability: 'available', mode, status });
  assert.deepEqual(sent.map((stanza) => stanza.attrs.type), [undefined, undefined, undefined, undefined, undefined, undefined]);
  assert.deepEqual(sent.map((stanza) => stanza.getChildText('show') || undefined), ['chat', undefined, 'away', 'away', 'xa', 'dnd']);
  assert.equal(sent[3].getChildText('status'), 'Al teléfono');
});

test('away, xa and dnd never become unavailable presence', async () => {
  const adapter = new XmppAdapter(); const sent = []; adapter.sessions.set('a@example.invalid', { send: async (stanza) => sent.push(stanza) });
  for (const mode of ['away', 'xa', 'dnd']) await adapter.setPresence('a@example.invalid', { availability: 'available', mode });
  assert.ok(sent.every((stanza) => stanza.attrs.type === undefined));
});

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
