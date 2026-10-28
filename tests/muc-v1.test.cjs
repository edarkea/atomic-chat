const test = require('node:test');
const assert = require('node:assert/strict');
const { XmppAdapter } = require('../electron/xmpp-adapter.cjs');
const { xml } = require('@xmpp/client');

const account = 'operator@example.invalid';
const service = 'conference.example.invalid';
const room = `${'lobby'}@${service}`;
const connected = (adapter, session) => { adapter.sessions.set(account, session); adapter.states.set(account, { accountId: account, status: 'connected', retryable: false, since: new Date().toISOString() }); adapter.sessionDomains.set(account, 'example.invalid'); adapter.sessionGenerations.set(account, 1); };
const discovery = (adapter) => adapter.mucDiscoveries.set(account, new Map([[room, { service, room: 'lobby', jid: room }]]));
const ownPresence = (from = `${room}/operator`) => xml('presence', { from }, xml('x', { xmlns: 'http://jabber.org/protocol/muc#user' }, xml('item', { affiliation: 'member', role: 'participant' }), xml('status', { code: '110' })));

test('MUC discovery queries disco items, validates conference/text + muc, and preserves empty rooms', async () => {
  const calls = [];
  const session = { iqCaller: { request: async (stanza) => { calls.push(stanza.attrs.to); if (stanza.attrs.to === 'example.invalid') return xml('iq', { type: 'result' }, xml('query', { xmlns: 'http://jabber.org/protocol/disco#items' }, xml('item', { jid: service }))); if (stanza.attrs.to === service && stanza.getChild('query').attrs.xmlns === 'http://jabber.org/protocol/disco#info') return xml('iq', { type: 'result' }, xml('query', { xmlns: 'http://jabber.org/protocol/disco#info' }, xml('identity', { category: 'conference', type: 'text' }), xml('feature', { var: 'http://jabber.org/protocol/muc' }))); return xml('iq', { type: 'result' }, xml('query', { xmlns: 'http://jabber.org/protocol/disco#items' })); } } };
  const adapter = new XmppAdapter(); connected(adapter, session);
  const result = await adapter.discoverMuc({ version: 1, requestId: 'discover-1', accountId: account });
  assert.deepEqual(result, []); assert.deepEqual(calls, ['example.invalid', service, service]);
});

test('join remains blocked without operator evidence and does not send presence', async () => {
  let sent = 0; const session = { send: async () => { sent += 1; } }; const adapter = new XmppAdapter(); connected(adapter, session); discovery(adapter);
  await assert.rejects(() => adapter.joinMuc({ version: 1, requestId: 'join-blocked', accountId: account, roomJid: room, nickname: 'operator' }), (error) => error.code === 'UNAUTHORIZED'); assert.equal(sent, 0);
});

test('join registers listeners before presence, accepts own 110, and tracks occupants without real JIDs', async () => {
  const events = []; let adapter; const session = { send: async () => { queueMicrotask(() => adapter.handleStanza(account, xml('presence', { from: `${room}/other` }, xml('x', { xmlns: 'http://jabber.org/protocol/muc#user' }, xml('item', { affiliation: 'member', role: 'participant' })) ))); queueMicrotask(() => adapter.handleStanza(account, ownPresence())); } }; adapter = new XmppAdapter(false, null, [{ accountId: account, service, canCreate: false, source: 'operator', evidence: 'Openfire administrator policy export' }]); connected(adapter, session); discovery(adapter); adapter.onEvent((event) => events.push(event));
  const state = await adapter.joinMuc({ version: 1, requestId: 'join-ok', accountId: account, roomJid: room, nickname: 'operator' });
  assert.equal(state.status, 'joined'); assert.equal(state.selfOccupantJid, `${room}/operator`); assert.equal(state.participants.length, 2); assert.equal(state.participants[0].occupantJid, `${room}/other`); assert.equal(Object.hasOwn(state.participants[0], 'jid'), false); assert.ok(events.some((event) => event.type === 'muc.participantChanged')); assert.ok(events.some((event) => event.type === 'muc.stateChanged' && event.payload.status === 'joined' && event.payload.sessionGeneration === 1));
});

test('210 server nickname is used, 201 is rejected and the unexpected room is left', async () => {
  const sent = []; let adapter; const session = { send: async (stanza) => { sent.push(stanza); if (stanza.attrs.type !== 'unavailable') queueMicrotask(() => adapter.handleStanza(account, xml('presence', { from: `${room}/server-nick` }, xml('x', { xmlns: 'http://jabber.org/protocol/muc#user' }, xml('item', { affiliation: 'member', role: 'participant' }), xml('status', { code: '110' }), xml('status', { code: '210' })) ))); } }; adapter = new XmppAdapter(false, null, [{ accountId: account, service, canCreate: false, source: 'operator', evidence: 'admin evidence' }]); connected(adapter, session); discovery(adapter); const joined = await adapter.joinMuc({ version: 1, requestId: 'join-210', accountId: account, roomJid: room, nickname: 'requested' }); assert.equal(joined.selfOccupantJid, `${room}/server-nick`); await adapter.leaveMuc({ version: 1, requestId: 'leave-210', accountId: account, roomJid: room }); assert.equal(sent.at(-1).attrs.type, 'unavailable');
  const created = 'created@conference.example.invalid'; adapter.mucDiscoveries.get(account).set(created, { service, room: 'created', jid: created }); adapter.mucRooms.get(account).delete(room); const joinCreated = adapter.joinMuc({ version: 1, requestId: 'join-201', accountId: account, roomJid: created, nickname: 'requested' }); await new Promise((resolve) => setImmediate(resolve)); adapter.handleStanza(account, xml('presence', { from: `${created}/requested` }, xml('x', { xmlns: 'http://jabber.org/protocol/muc#user' }, xml('item', { affiliation: 'owner', role: 'moderator' }), xml('status', { code: '201' })))); await assert.rejects(joinCreated, (error) => error.code === 'CONFLICT'); assert.equal(sent.at(-1).attrs.type, 'unavailable');
});

test('timeout and unavailable cleanup use typed errors and bounded memory', async () => {
  const adapter = new XmppAdapter(); await assert.rejects(() => adapter.withTimeout(new Promise(() => {}), 5, 'TIMEOUT', 'timeout'), (error) => error.code === 'TIMEOUT'); const record = adapter.createMucRoom(account, { service, room: 'lobby', jid: room }, 1, 'operator'); for (let index = 0; index < 250; index += 1) record.seenMessageIds.add(`id-${index}`); assert.equal(record.seenMessageIds.size, 250); record.messageBuffer = Array.from({ length: 250 }, (_, index) => ({ id: index })); record.messageBuffer = record.messageBuffer.slice(-200); assert.equal(record.messageBuffer.length, 200);
});

test('MUC groupchat is isolated from P0 messages, deduplicated by stanza id, and history is memory-only', async () => {
  let adapter; const session = { send: async () => queueMicrotask(() => adapter.handleStanza(account, ownPresence())) }; adapter = new XmppAdapter(false, null, [{ accountId: account, service, canCreate: false, source: 'operator', evidence: 'admin evidence' }]); connected(adapter, session); discovery(adapter); await adapter.joinMuc({ version: 1, requestId: 'join-msg', accountId: account, roomJid: room, nickname: 'operator' });
  const events = []; adapter.onEvent((event) => events.push(event)); const message = (body, extra = {}, ...children) => xml('message', { type: 'groupchat', from: `${room}/other`, id: 'server-1', ...extra }, xml('body', {}, body), ...children);
  adapter.handleStanza(account, message('hello')); adapter.handleStanza(account, message('hello')); adapter.handleStanza(account, message('old', { id: 'server-old' }, xml('delay', { xmlns: 'urn:xmpp:delay' })));
  const mucMessages = events.filter((event) => event.type === 'muc.messageReceived'); assert.equal(mucMessages.length, 2); assert.equal(mucMessages[0].payload.source, 'live'); assert.equal(mucMessages[1].payload.source, 'server-history'); assert.equal(events.some((event) => event.type === 'message.received'), false);
});

test('MUC send enforces joined voice, UTF-8 limit, groupchat target and five-room cap', async () => {
  const sent = []; let adapter; const session = { send: async (stanza) => { sent.push(stanza); if (stanza.is('presence')) queueMicrotask(() => adapter.handleStanza(account, ownPresence())); } }; const policy = { accountId: account, service, canCreate: false, source: 'operator', evidence: 'admin evidence' }; adapter = new XmppAdapter(false, null, [policy]); connected(adapter, session); discovery(adapter); await adapter.joinMuc({ version: 1, requestId: 'join-send', accountId: account, roomJid: room, nickname: 'operator' });
  const receipt = await adapter.sendMucMessage({ version: 1, requestId: 'send-1', accountId: account, roomJid: room, clientMessageId: 'client-1', body: { kind: 'text', text: 'hola' } }); assert.equal(receipt.status, 'sent'); assert.equal(sent.at(-1).attrs.type, 'groupchat'); assert.equal(sent.at(-1).attrs.to, room); assert.equal(sent.at(-1).getChildText('body'), 'hola'); await assert.rejects(() => adapter.sendMucMessage({ version: 1, requestId: 'send-big', accountId: account, roomJid: room, clientMessageId: 'client-2', body: { kind: 'text', text: '😀'.repeat(2000) } }), (error) => error.code === 'INVALID_INPUT');
  adapter.mucRooms.get(account).get(room).participants.get(`${room}/operator`).role = 'visitor'; await assert.rejects(() => adapter.sendMucMessage({ version: 1, requestId: 'send-visitor', accountId: account, roomJid: room, clientMessageId: 'client-3', body: { kind: 'text', text: 'no voice' } }), (error) => error.code === 'UNAUTHORIZED');
  for (let index = 1; index < 5; index += 1) { const jid = `room${index}@${service}`; adapter.mucDiscoveries.get(account).set(jid, { service, room: `room${index}`, jid }); const record = adapter.createMucRoom(account, { service, room: `room${index}`, jid }, 1, 'operator'); record.state = { ...record.state, status: 'joined', selfOccupantJid: `${jid}/operator` }; record.participants.set(`${jid}/operator`, { occupantJid: `${jid}/operator`, nick: 'operator', role: 'participant', affiliation: 'member', availability: 'available' }); adapter.mucRooms.get(account).set(jid, record); }
  const sixth = 'sixth@conference.example.invalid'; adapter.mucDiscoveries.get(account).set(sixth, { service, room: 'sixth', jid: sixth }); await assert.rejects(() => adapter.joinMuc({ version: 1, requestId: 'join-sixth', accountId: account, roomJid: sixth, nickname: 'operator' }), (error) => error.code === 'CONFLICT');
});

test('disconnect clears MUC rooms and prevents stale session events', async () => {
  let stopped = false; const session = { stop: async () => { stopped = true; } }; const adapter = new XmppAdapter(); connected(adapter, session); discovery(adapter); const record = adapter.createMucRoom(account, { service, room: 'lobby', jid: room }, 1, 'operator'); record.state = { ...record.state, status: 'joined' }; adapter.mucRooms.set(account, new Map([[room, record]])); await adapter.disconnect(account); assert.equal(stopped, true); assert.equal(adapter.mucRooms.has(account), false); assert.equal(adapter.mucDiscoveries.has(account), false); assert.equal(adapter.states.get(account).status, 'idle');
});
