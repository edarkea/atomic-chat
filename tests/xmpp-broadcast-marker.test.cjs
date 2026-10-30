const test = require('node:test');
const assert = require('node:assert/strict');
const { xml } = require('@xmpp/client');
const {
  BROADCAST_NAMESPACE,
  JIVE_PROPERTIES_NAMESPACE,
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

test('classifies Atomic, Spark and private stanzas without treating server headlines as broadcasts', () => {
  const sent = [];
  const { adapter, events } = createAdapter(sent);
  const messaging = createRosterMessaging(adapter);
  const jiveProperties = xml(
    'properties',
    { xmlns: JIVE_PROPERTIES_NAMESPACE },
    xml(
      'property',
      {},
      xml('name', {}, 'broadcast'),
      xml('value', { type: 'boolean' }, 'true'),
    ),
  );
  const stanzas = [
    xml(
      'message',
      { type: 'normal', from: 'contact@example.invalid/desktop', id: 'spark-normal' },
      xml('body', {}, 'difusión normal'),
    ),
    xml(
      'message',
      { type: 'headline', from: 'contact@example.invalid/desktop', id: 'spark-headline' },
      xml('body', {}, 'alerta'),
    ),
    xml(
      'message',
      { type: 'chat', from: 'contact@example.invalid/desktop', id: 'jive-broadcast' },
      xml('body', {}, 'propiedad'),
      jiveProperties,
    ),
    xml(
      'message',
      { type: 'chat', from: 'contact@example.invalid/desktop', id: 'atomic-broadcast' },
      xml('body', {}, 'atómico'),
      xml('broadcast', { xmlns: BROADCAST_NAMESPACE }),
    ),
    xml(
      'message',
      { type: 'chat', from: 'contact@example.invalid/desktop', id: 'direct' },
      xml('body', {}, 'privado'),
    ),
    xml(
      'message',
      { type: 'headline', from: 'notify.example.invalid', id: 'server-headline' },
      xml('body', {}, 'notificación del servidor'),
    ),
  ];
  stanzas.forEach((stanza) => messaging.handleMessage('receiver@example.invalid', stanza));
  assert.deepEqual(
    events
      .filter((event) => event.type === 'message.received')
      .map((event) => event.payload.classification),
    ['broadcast', 'broadcast', 'broadcast', 'broadcast', 'direct', 'direct'],
  );
});
