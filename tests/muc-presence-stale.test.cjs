const test = require('node:test');
const assert = require('node:assert/strict');
const { XmppAdapter } = require('../electron/xmpp/xmpp-adapter.cjs');

test('presence updates do not target occupants after their XMPP session is replaced', async () => {
  const accountId = 'a@example.invalid';
  const adapter = new XmppAdapter();
  const sent = [];
  const nextSession = {
    send: async () => {
      throw new Error('stale update');
    },
  };
  const previousSession = {
    send: async (stanza) => {
      sent.push(stanza);
      adapter.sessions.set(accountId, nextSession);
      adapter.sessionGenerations.set(accountId, 2);
    },
  };
  adapter.sessions.set(accountId, previousSession);
  adapter.sessionGenerations.set(accountId, 1);
  const room = {
    service: 'conference.example.invalid',
    room: 'one',
    jid: 'one@conference.example.invalid',
  };
  const record = adapter.createMucRoom(accountId, room, 1, 'operator');
  record.state = {
    ...record.state,
    status: 'joined',
    selfOccupantJid: `${room.jid}/operator`,
  };
  adapter.mucRooms.set(accountId, new Map([[room.jid, record]]));

  const receipt = await adapter.setPresence(accountId, {
    availability: 'available',
    mode: 'away',
  });

  assert.equal(receipt.mode, 'away');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].attrs.to, undefined);
  assert.equal(adapter.publishedPresences.has(accountId), false);
});
