const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { xml } = require('@xmpp/client');
const { XmppAdapter } = require('../electron/xmpp-adapter.cjs');
const { createXmppResource } = require('../electron/xmpp-session.cjs');
const { CARBONS_NS, DISCO_INFO_NS, FORWARD_NS } = require('../electron/xmpp-carbons.cjs');
const { PersistenceStore } = require('../electron/storage.cjs');

const ACCOUNT = 'me@example.invalid';
const CONTACT = 'friend@example.invalid';

function forwardedCarbon(direction, outerFrom, originalFrom, originalTo, id, text) {
  return xml(
    'message',
    { from: outerFrom, to: `${ACCOUNT}/atomic-test` },
    xml(
      direction,
      { xmlns: CARBONS_NS },
      xml(
        'forwarded',
        { xmlns: FORWARD_NS },
        xml(
          'message',
          { xmlns: 'jabber:client', type: 'chat', from: originalFrom, to: originalTo, id },
          xml('body', {}, text),
        ),
      ),
    ),
  );
}

test('explicit resources are unique and identify Atomic Chat', () => {
  const resources = new Set(Array.from({ length: 32 }, () => createXmppResource()));
  assert.equal(resources.size, 32);
  assert.ok([...resources].every((resource) => /^atomic-[0-9a-f]{16}$/.test(resource)));
});

test('Carbons negotiation discovers support and only enables after IQ result', async () => {
  const adapter = new XmppAdapter();
  const requests = [];
  const session = {
    iqCaller: {
      request: async (request) => {
        requests.push(request);
        return requests.length === 1
          ? xml(
              'iq',
              { type: 'result' },
              xml('query', { xmlns: DISCO_INFO_NS }, xml('feature', { var: CARBONS_NS })),
            )
          : xml('iq', { type: 'result' });
      },
    },
  };

  const state = await adapter.carbons.negotiate(ACCOUNT, session, 'example.invalid', 1);
  assert.equal(state.status, 'enabled');
  assert.equal(requests[0].getChild('query', DISCO_INFO_NS).attrs.xmlns, DISCO_INFO_NS);
  assert.equal(requests[1].getChild('enable', CARBONS_NS).attrs.xmlns, CARBONS_NS);
  const sameSession = await adapter.carbons.negotiate(ACCOUNT, session, 'example.invalid', 1);
  assert.equal(sameSession, state);
  assert.equal(requests.length, 2);
  adapter.carbons.clear(ACCOUNT);
  assert.equal(adapter.carbons.state(ACCOUNT), undefined);
});

test('direct sends carry stable stanza and origin identifiers for Carbon correlation', async () => {
  const adapter = new XmppAdapter();
  const sent = [];
  adapter.states.set(ACCOUNT, { accountId: ACCOUNT, status: 'connected' });
  adapter.sessions.set(ACCOUNT, { send: async (stanza) => sent.push(stanza) });
  await adapter.sendMessage(ACCOUNT, {
    to: CONTACT,
    clientMessageId: 'client-stable-1',
    body: { kind: 'text', text: 'hola' },
  });
  assert.equal(sent[0].attrs.id, 'client-stable-1');
  assert.equal(sent[0].getChild('origin-id', 'urn:xmpp:sid:0').attrs.id, 'client-stable-1');
});

test('reconnect clears the previous Carbon capability state before renegotiating', async () => {
  const adapter = new XmppAdapter();
  const firstSession = {
    iqCaller: {
      request: async () =>
        xml(
          'iq',
          { type: 'result' },
          xml('query', { xmlns: DISCO_INFO_NS }, xml('feature', { var: CARBONS_NS })),
        ),
    },
  };
  adapter.sessions.set(ACCOUNT, firstSession);
  adapter.sessionGenerations.set(ACCOUNT, 1);
  await adapter.carbons.negotiate(ACCOUNT, firstSession, 'example.invalid', 1);
  assert.equal(adapter.carbons.state(ACCOUNT).status, 'enabled');
  assert.equal(adapter.handleSessionEvent(ACCOUNT, firstSession, 'offline'), true);
  assert.equal(adapter.carbons.state(ACCOUNT), undefined);

  const secondSession = {
    iqCaller: {
      request: async () =>
        xml(
          'iq',
          { type: 'result' },
          xml('query', { xmlns: DISCO_INFO_NS }, xml('feature', { var: CARBONS_NS })),
        ),
    },
  };
  adapter.sessions.set(ACCOUNT, secondSession);
  adapter.sessionGenerations.set(ACCOUNT, 2);
  const state = await adapter.carbons.negotiate(ACCOUNT, secondSession, 'example.invalid', 2);
  assert.equal(state.status, 'enabled');
  assert.notEqual(state.session, firstSession);
});

test('received Carbon shares the canonical identity of its direct route', () => {
  const adapter = new XmppAdapter();
  const messages = [];
  adapter.onEvent((event) => {
    if (event.type === 'message.received') messages.push(event.payload);
  });
  const direct = xml(
    'message',
    { from: `${CONTACT}/phone`, to: `${ACCOUNT}/atomic-test`, id: 'stable-1' },
    xml('body', {}, 'hola'),
  );
  const carbon = forwardedCarbon(
    'received',
    ACCOUNT,
    `${CONTACT}/phone`,
    ACCOUNT,
    'stable-1',
    'hola',
  );
  adapter.handleStanza(ACCOUNT, direct);
  adapter.handleStanza(ACCOUNT, carbon);

  assert.equal(messages.length, 2);
  assert.equal(messages[0].clientMessageId, messages[1].clientMessageId);
  assert.equal(messages[1].conversationId, CONTACT);
  assert.equal(messages[1].senderJid, CONTACT);
});

test('Carbon and direct copies persist as one message and survive history reads', () => {
  const adapter = new XmppAdapter();
  const messages = [];
  adapter.onEvent((event) => {
    if (event.type === 'message.received') messages.push(event.payload);
  });
  const direct = xml(
    'message',
    { from: `${CONTACT}/phone`, to: `${ACCOUNT}/atomic-test`, id: 'persist-1' },
    xml('body', {}, 'persistente'),
  );
  adapter.handleStanza(
    ACCOUNT,
    forwardedCarbon('received', ACCOUNT, `${CONTACT}/phone`, ACCOUNT, 'persist-1', 'persistente'),
  );
  adapter.handleStanza(ACCOUNT, direct);

  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-chat-carbons-'));
  const store = new PersistenceStore(directory);
  try {
    store.upsertAccount({
      accountId: ACCOUNT,
      host: 'example.invalid',
      port: 5222,
      tls: 1,
      credentialRef: null,
      createdAt: new Date().toISOString(),
    });
    for (const message of messages) store.saveMessage(message);
    assert.equal(store.listMessages(ACCOUNT, CONTACT).length, 1);
    assert.equal(store.listMessages(ACCOUNT, CONTACT)[0].body.text, 'persistente');
  } finally {
    store.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('sent Carbon becomes an outgoing message without accepting an external wrapper', () => {
  const adapter = new XmppAdapter();
  const messages = [];
  adapter.onEvent((event) => {
    if (event.type === 'message.received') messages.push(event.payload);
  });
  adapter.handleStanza(
    ACCOUNT,
    forwardedCarbon('sent', ACCOUNT, ACCOUNT, CONTACT, 'stable-out-1', 'enviado desde Spark'),
  );
  adapter.handleStanza(
    ACCOUNT,
    forwardedCarbon('sent', 'attacker@example.invalid', ACCOUNT, CONTACT, 'bad-1', 'falso'),
  );

  assert.equal(messages.length, 1);
  assert.equal(messages[0].conversationId, CONTACT);
  assert.equal(messages[0].senderJid, ACCOUNT);
  assert.equal(messages[0].body.text, 'enviado desde Spark');
});

test('malformed Carbons are rejected and unsupported servers keep normal messaging available', async () => {
  const adapter = new XmppAdapter();
  const messages = [];
  adapter.onEvent((event) => {
    if (event.type === 'message.received') messages.push(event.payload);
  });
  adapter.handleStanza(
    ACCOUNT,
    xml('message', { from: ACCOUNT }, xml('received', { xmlns: CARBONS_NS })),
  );
  const state = await adapter.carbons.negotiate(
    ACCOUNT,
    {
      iqCaller: {
        request: async () => xml('iq', { type: 'result' }, xml('query', { xmlns: DISCO_INFO_NS })),
      },
    },
    'example.invalid',
    2,
  );
  assert.equal(messages.length, 0);
  assert.equal(state.status, 'unsupported');
});
