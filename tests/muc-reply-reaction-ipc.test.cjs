const test = require('node:test');
const assert = require('node:assert/strict');
const { xml } = require('@xmpp/client');
const { XmppAdapter } = require('../electron/xmpp/xmpp-adapter.cjs');
const { registerMucHandlers } = require('../electron/ipc/ipc-muc-handlers.cjs');
const { createIpcHelpers } = require('../electron/ipc/ipc-helpers.cjs');

const account = 'steeven@example.invalid';
const room = 'salatest@conference.example.invalid';
const event = { sender: { id: 7 } };
const SID_NS = 'urn:xmpp:sid:0';
const REPLY_NS = 'urn:xmpp:reply:0';
const REACTIONS_NS = 'urn:xmpp:reactions:0';

function fixture() {
  const sent = [];
  const adapter = new XmppAdapter();
  adapter.sessions.set(account, {
    send: async (stanza) => {
      sent.push(stanza);
    },
  });
  adapter.states.set(account, { accountId: account, status: 'connected' });
  adapter.sessionGenerations.set(account, 1);
  const record = adapter.createMucRoom(
    account,
    { service: 'conference.example.invalid', room: 'salatest', jid: room },
    1,
    'steeven',
    'join-1',
  );
  const ownOccupant = `${room}/steeven`;
  record.state = { ...record.state, status: 'joined', selfOccupantJid: ownOccupant };
  record.participants.set(ownOccupant, {
    occupantJid: ownOccupant,
    nick: 'steeven',
    role: 'participant',
    affiliation: 'member',
    availability: 'available',
  });
  adapter.mucRooms.set(account, new Map([[room, record]]));

  const handlers = new Map();
  const getRuntime = () => ({ xmpp: adapter });
  // Use the production IPC helpers so tests exercise the real authorization,
  // input validation and error.code/error.message normalization.
  const helpers = createIpcHelpers({
    getRuntime,
    historySecurity: {
      authorize: (senderId, accountId) => senderId === 7 && accountId === account,
    },
  });
  registerMucHandlers({
    ipcMain: { handle: (name, handle) => handlers.set(name, handle) },
    assertSender: () => undefined,
    getRuntime,
    helpers,
  });
  return { sent, adapter, handlers, record };
}

function receive(adapter, { stanzaId = 'room-msg-1', by = room, includeStanzaId = true } = {}) {
  adapter.handleMucMessage(
    account,
    xml(
      'message',
      { type: 'groupchat', from: `${room}/barbara`, id: 'sender-message-id' },
      xml('body', {}, 'Hola de Bárbara'),
      ...(includeStanzaId ? [xml('stanza-id', { xmlns: SID_NS, id: stanzaId, by })] : []),
    ),
  );
}

test('MUC IPC reply resolves a room stanza-id and emits a valid groupchat reply', async () => {
  const { adapter, handlers, sent } = fixture();
  receive(adapter);
  const target = adapter.resolveMucMessage(account, room, 'room-msg-1');
  assert.equal(target.stanzaIds[0].id, 'room-msg-1');

  const response = await handlers.get('muc.sendMessage')(event, {
    version: 1,
    requestId: 'reply-1',
    accountId: account,
    roomJid: room,
    clientMessageId: 'client-reply-1',
    body: { kind: 'text', text: 'Gracias' },
    replyToMessageId: 'room-msg-1',
  });

  assert.equal(response.ok, true);
  assert.equal(sent.length, 1);
  const reply = sent[0].getChild('reply', REPLY_NS);
  assert.equal(sent[0].attrs.to, room);
  assert.equal(reply?.attrs?.id, 'room-msg-1');
  assert.equal(reply?.attrs?.to, `${room}/barbara`);
  assert.match(sent[0].getChildText('body'), /Gracias/);
  assert.match(sent[0].getChildText('body'), /Hola de Bárbara/);
  assert.ok(sent[0].getChild('fallback', 'urn:xmpp:fallback:0'));
});

test('MUC IPC reactions resolve a room stanza-id, send emojis and update local state', async () => {
  const { adapter, handlers, sent } = fixture();
  receive(adapter);
  const reactions = [];
  adapter.onEvent((event) => {
    if (event.type === 'reaction.changed') reactions.push(event.payload);
  });

  const response = await handlers.get('muc.react')(event, {
    version: 1,
    requestId: 'react-1',
    accountId: account,
    roomJid: room,
    targetMessageId: 'room-msg-1',
    emojis: ['👍', '👍', '❤️'],
  });

  assert.equal(response.ok, true);
  assert.equal(sent.length, 1);
  const message = sent[0];
  const reaction = message.getChild('reactions', REACTIONS_NS);
  assert.equal(message.attrs.type, 'groupchat');
  assert.equal(message.attrs.to, room);
  assert.equal(reaction?.attrs?.id, 'room-msg-1');
  assert.deepEqual(
    reaction.getChildren('reaction').map((item) => item.getText()),
    ['👍', '❤️'],
  );
  assert.ok(message.getChild('origin-id', SID_NS)?.attrs?.id.startsWith('reaction_'));
  assert.equal(reactions.length, 1);
  assert.equal(reactions[0].targetMessageId, 'room-msg-1');
  assert.deepEqual(
    reactions[0].reactions.map((item) => item.emoji),
    ['👍', '❤️'],
  );
});

test('MUC IPC rejects missing and foreign room stanza IDs instead of using sender IDs', async () => {
  for (const options of [
    { includeStanzaId: false },
    { stanzaId: 'room-msg-1', by: 'other@conference.example.invalid' },
  ]) {
    const { adapter, handlers, sent } = fixture();
    receive(adapter, options);
    const reply = await handlers.get('muc.sendMessage')(event, {
      version: 1,
      requestId: 'reject-reply',
      accountId: account,
      roomJid: room,
      clientMessageId: 'client-1',
      body: { kind: 'text', text: 'No debe salir' },
      replyToMessageId: 'sender-message-id',
    });
    const reaction = await handlers.get('muc.react')(event, {
      version: 1,
      requestId: 'reject-reaction',
      accountId: account,
      roomJid: room,
      targetMessageId: 'sender-message-id',
      emojis: ['👍'],
    });
    assert.equal(reply.ok, false);
    assert.equal(reply.error.code, 'UNSUPPORTED');
    assert.equal(reaction.ok, false);
    assert.equal(reaction.error.code, 'UNSUPPORTED');
    assert.equal(sent.length, 0);
  }
});

test('MUC IPC rejects a different account before referencing or sending a message', async () => {
  const { adapter, handlers, sent } = fixture();
  receive(adapter);
  const response = await handlers.get('muc.react')(event, {
    version: 1,
    requestId: 'wrong-account',
    accountId: 'other@example.invalid',
    roomJid: room,
    targetMessageId: 'room-msg-1',
    emojis: ['👍'],
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'UNAUTHORIZED');
  assert.equal(sent.length, 0);
});
