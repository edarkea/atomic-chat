const test = require('node:test');
const assert = require('node:assert/strict');
const { xml } = require('@xmpp/client');
const {
  BROADCAST_NAMESPACE,
  createRosterMessaging,
} = require('../electron/xmpp-roster-messaging.cjs');

function createAdapter(sent) {
  const events = [];
  const session = { send: async (stanza) => sent.push(stanza) };
  const adapter = {
    states: new Map([['receiver@example.invalid', { status: 'connected' }]]),
    rosters: new Map(),
    remoteResources: new Map(),
    pendingPresences: new Map(),
    initialPresencePublished: new Set(),
    bareJid: (jid) => String(jid).split('/')[0],
    require: () => session,
    emit: (event) => events.push(event),
  };
  return { adapter, events };
}

test('adds the Atomic Chat broadcast marker without changing the chat stanza contract', async () => {
  const sent = [];
  const { adapter } = createAdapter(sent);
  const messaging = createRosterMessaging(adapter);
  await messaging.sendMessage('receiver@example.invalid', {
    to: 'contact@example.invalid',
    clientMessageId: 'client-broadcast-1',
    broadcast: true,
    body: { kind: 'text', text: 'hola' },
  });
  const stanza = sent[0];
  assert.equal(stanza.attrs.type, 'chat');
  assert.equal(stanza.attrs.id, 'client-broadcast-1');
  assert.equal(stanza.getChildText('body'), 'hola');
  assert.equal(stanza.getChild('broadcast', BROADCAST_NAMESPACE)?.name, 'broadcast');
});

test('does not mark private messages and classifies incoming stanzas explicitly', async () => {
  const sent = [];
  const { adapter, events } = createAdapter(sent);
  const messaging = createRosterMessaging(adapter);
  await messaging.sendMessage('receiver@example.invalid', {
    to: 'contact@example.invalid',
    clientMessageId: 'client-direct-1',
    body: { kind: 'text', text: 'privado' },
  });
  assert.equal(sent[0].getChild('broadcast', BROADCAST_NAMESPACE), undefined);
  const privateStanza = xml(
    'message',
    { type: 'chat', from: 'contact@example.invalid/resource', id: 'direct-1' },
    xml('body', {}, 'privado'),
  );
  const broadcastStanza = xml(
    'message',
    { type: 'chat', from: 'contact@example.invalid/resource', id: 'broadcast-1' },
    xml('body', {}, 'difusión'),
    xml('broadcast', { xmlns: BROADCAST_NAMESPACE }),
  );
  messaging.handleMessage('receiver@example.invalid', privateStanza);
  messaging.handleMessage('receiver@example.invalid', broadcastStanza);
  assert.deepEqual(
    events
      .filter((event) => event.type === 'message.received')
      .map((event) => event.payload.classification),
    ['direct', 'broadcast'],
  );
});
