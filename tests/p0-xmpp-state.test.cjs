const test = require('node:test');
const assert = require('node:assert/strict');
const { XmppAdapter } = require('../electron/xmpp-adapter.cjs');
const { xml } = require('@xmpp/client');
const { validateXmppTransport } = require('../electron/security-policy.cjs');

function incoming(from, body, id) { return xml('message', { from, to: 'a@example.invalid/resource', ...(id ? { id } : {}) }, xml('body', {}, body)); }

test('incoming messages without stanza ids remain distinct, including identical text', () => {
  const adapter = new XmppAdapter(); const messages = []; adapter.onEvent((event) => { if (event.type === 'message.received') messages.push(event.payload); });
  adapter.handleStanza('a@example.invalid', incoming('b@example.invalid/phone', 'mismo'));
  adapter.handleStanza('a@example.invalid', incoming('b@example.invalid/phone', 'mismo'));
  assert.equal(messages.length, 2); assert.notEqual(messages[0].clientMessageId, messages[1].clientMessageId);
});

test('explicit stanza ids are deterministic and isolated by account and sender', () => {
  const adapter = new XmppAdapter(); const messages = []; adapter.onEvent((event) => { if (event.type === 'message.received') messages.push(event.payload); });
  adapter.handleStanza('a@example.invalid', incoming('b@example.invalid/phone', 'uno', 'same-id'));
  adapter.handleStanza('a@example.invalid', incoming('b@example.invalid/phone', 'uno', 'same-id'));
  adapter.handleStanza('a@example.invalid', incoming('c@example.invalid/tablet', 'uno', 'same-id'));
  adapter.handleStanza('other@example.invalid', incoming('b@example.invalid/phone', 'uno', 'same-id'));
  assert.equal(new Set(messages.map((message) => message.clientMessageId)).size, 3);
  assert.equal(messages[0].clientMessageId, messages[1].clientMessageId);
});

test('remote presence parses show/status only for authorized roster contacts', () => {
  const adapter = new XmppAdapter(); const events = []; adapter.rosters.set('a@example.invalid', new Map([['b@example.invalid', { jid: 'b@example.invalid', subscription: 'both' }]])); adapter.remoteResources.set('a@example.invalid', new Map()); adapter.onEvent((event) => { if (event.type === 'presence.changed') events.push(event.payload); });
  adapter.handleStanza('a@example.invalid', xml('presence', { from: 'b@example.invalid/phone' }, xml('show', {}, 'away'), xml('status', {}, 'Al teléfono')));
  adapter.handleStanza('a@example.invalid', xml('presence', { from: 'b@example.invalid/phone', type: 'subscribe' }));
  assert.equal(events.length, 1); assert.equal(events[0].accountId, 'a@example.invalid'); assert.equal(events[0].mode, 'away'); assert.equal(events[0].status, 'Al teléfono');
});

test('remote presence remains available while one of two resources disconnects', () => {
  const adapter = new XmppAdapter(); const events = []; adapter.rosters.set('a@example.invalid', new Map([['b@example.invalid', { jid: 'b@example.invalid', subscription: 'to' }]])); adapter.remoteResources.set('a@example.invalid', new Map()); adapter.onEvent((event) => { if (event.type === 'presence.changed') events.push(event.payload); });
  adapter.handleStanza('a@example.invalid', xml('presence', { from: 'b@example.invalid/one' })); adapter.handleStanza('a@example.invalid', xml('presence', { from: 'b@example.invalid/two' })); adapter.handleStanza('a@example.invalid', xml('presence', { from: 'b@example.invalid/one', type: 'unavailable' }));
  assert.equal(events.at(-1).availability, 'available'); adapter.handleStanza('a@example.invalid', xml('presence', { from: 'b@example.invalid/two', type: 'unavailable' })); assert.equal(events.at(-1).availability, 'unavailable');
});

test('roster refresh preserves authorized resources and publishes initial presence once', async () => {
  const adapter = new XmppAdapter(); const sent = []; const roster = () => xml('iq', { type: 'result' }, xml('query', { xmlns: 'jabber:iq:roster' }, xml('item', { jid: 'b@example.invalid', subscription: 'both' })));
  adapter.sessions.set('a@example.invalid', { send: async (stanza) => sent.push(stanza), iqCaller: { request: async () => roster() } });
  await adapter.listRoster('a@example.invalid'); adapter.handleStanza('a@example.invalid', xml('presence', { from: 'b@example.invalid/one' }, xml('show', {}, 'away'), xml('status', {}, 'ocupado'))); await adapter.listRoster('a@example.invalid');
  assert.equal(sent.length, 1); assert.equal(adapter.remoteResources.get('a@example.invalid').size, 1);
  adapter.sessions.get('a@example.invalid').iqCaller.request = async () => xml('iq', { type: 'result' }, xml('query', { xmlns: 'jabber:iq:roster' })); await adapter.listRoster('a@example.invalid'); assert.equal(adapter.remoteResources.get('a@example.invalid').size, 0);
});

test('roster refresh revokes resources when subscription is withdrawn', async () => {
  const adapter = new XmppAdapter(); const events = []; const roster = (subscription) => xml('iq', { type: 'result' }, xml('query', { xmlns: 'jabber:iq:roster' }, xml('item', { jid: 'b@example.invalid', subscription })));
  const session = { send: async () => {}, iqCaller: { request: async () => roster('both') } }; adapter.sessions.set('a@example.invalid', session); adapter.onEvent((event) => { if (event.type === 'presence.changed') events.push(event.payload); });
  await adapter.listRoster('a@example.invalid'); adapter.handleStanza('a@example.invalid', xml('presence', { from: 'b@example.invalid/one' })); session.iqCaller.request = async () => roster('none'); await adapter.listRoster('a@example.invalid'); adapter.handleStanza('a@example.invalid', xml('presence', { from: 'b@example.invalid/two' }));
  assert.equal(adapter.remoteResources.get('a@example.invalid').size, 0); assert.equal(events.length, 1);
});

test('initial presence is authorized before a remote presence arrives during roster publication', async () => {
  const adapter = new XmppAdapter(); const events = []; const session = { iqCaller: { request: async () => xml('iq', { type: 'result' }, xml('query', { xmlns: 'jabber:iq:roster' }, xml('item', { jid: 'b@example.invalid', subscription: 'both' }))) }, send: async () => adapter.handleStanza('a@example.invalid', xml('presence', { from: 'b@example.invalid/desktop' }, xml('show', {}, 'dnd'))) }; adapter.sessions.set('a@example.invalid', session); adapter.onEvent((event) => { if (event.type === 'presence.changed') events.push(event.payload); }); await adapter.listRoster('a@example.invalid'); assert.equal(events[0].mode, 'dnd');
});

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

test('chat states use XEP-0085 and never become message history', async () => {
  const adapter = new XmppAdapter(); const sent = []; const states = [];
  adapter.states.set('a@example.invalid', { status: 'connected' });
  adapter.sessions.set('a@example.invalid', { send: async (stanza) => sent.push(stanza) });
  adapter.onEvent((event) => { if (event.type === 'chatState.changed') states.push(event.payload); });
  await adapter.sendChatState('a@example.invalid', { to: 'b@example.invalid', state: 'composing' });
  assert.equal(sent[0].attrs.type, 'chat'); assert.equal(sent[0].getChild('composing').attrs.xmlns, 'http://jabber.org/protocol/chatstates');
  adapter.handleStanza('a@example.invalid', xml('message', { from: 'b@example.invalid/phone', type: 'chat' }, xml('composing', { xmlns: 'http://jabber.org/protocol/chatstates' })));
  adapter.handleStanza('a@example.invalid', xml('message', { from: 'a@example.invalid/other', type: 'chat' }, xml('composing', { xmlns: 'http://jabber.org/protocol/chatstates' })));
  assert.deepEqual(states.map((state) => state.state), ['composing']);
});

test('production rejects an unsupported cleartext transport before opening a session', async () => {
  const adapter = new XmppAdapter(true);
  await assert.rejects(() => adapter.connect({ accountId: 'a@example.invalid', endpoint: { host: 'example.invalid', port: 5222, tls: true, transport: 'plain' } }, 'synthetic'), /TRANSPORT_INCOMPATIBLE/);
  assert.equal(adapter.sessions.size, 0);
});

test('legacy tls=false configuration adapts to secure STARTTLS', () => {
  const transport = validateXmppTransport({ host: 'example.invalid', port: 5222, tls: false }, true);
  assert.equal(transport.transport, 'starttls');
  assert.equal(transport.rejectUnauthorized, true);
  assert.equal(validateXmppTransport({ host: 'example.invalid', port: 5222, tls: true }, true).transport, 'starttls');
  assert.equal(validateXmppTransport({ host: 'example.invalid', port: 5223, tls: true }, true).transport, 'direct-tls');
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
