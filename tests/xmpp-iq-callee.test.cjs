const test = require('node:test');
const assert = require('node:assert/strict');
const { xml } = require('@xmpp/client');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { XmppAdapter } = require('../electron/xmpp-adapter.cjs');
const { FileTransferCoordinator } = require('../electron/file-transfer.cjs');

const SI = 'http://jabber.org/protocol/si';
const FILE = 'http://jabber.org/protocol/si/profile/file-transfer';
const FEATURE = 'http://jabber.org/protocol/feature-neg';
const FORM = 'jabber:x:data';
const IBB = 'http://jabber.org/protocol/ibb';
const STANZA = 'urn:ietf:params:xml:ns:xmpp-stanzas';
const accountId = 'account@example.invalid';
const from = 'sender@example.invalid/Spark';

function offer(iqId, sid, size = '0') {
  return xml('iq', { type: 'set', id: iqId, from },
    xml('si', { xmlns: SI, id: sid, profile: FILE },
      xml('file', { xmlns: FILE, name: 'fixture.bin', size }),
      xml('feature', { xmlns: FEATURE },
        xml('x', { xmlns: FORM, type: 'form' },
          xml('field', { var: 'stream-method', type: 'list-single' },
            xml('option', {}, xml('value', {}, IBB)))))));
}

async function tick() { await new Promise((resolve) => setImmediate(resolve)); }
async function flush() { for (let index = 0; index < 4; index += 1) await tick(); }

for (const outcome of ['reject', 'accept', 'fail', 'timeout']) {
  test(`C5-INC-02 duplicate SI shares one operation before and after ${outcome}`, async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-si-replay-'));
    const timers = [];
    const coordinator = new FileTransferCoordinator({
      selectDestination: async () => path.join(root, 'received.bin'),
      scheduleTimeout: (callback) => { timers.push(callback); return callback; },
      cancelTimeout: () => undefined,
    });
    const adapter = new XmppAdapter(false, null, [], coordinator);
    adapter.sessions.set(accountId, { send: async () => undefined });
    adapter.sessionGenerations.set(accountId, 1);
    adapter.fileOwners.set(accountId, 42);
    const events = [];
    coordinator.onEvent((event) => events.push(event));
    try {
      const first = adapter.handleFileIq(accountId, offer('repeat-iq', 'repeat-sid'));
      const duplicate = adapter.handleFileIq(accountId, offer('repeat-iq', 'repeat-sid'));
      const sameStream = adapter.handleFileIq(accountId, offer('another-iq', 'repeat-sid'));
      assert.equal(coordinator.records.size, 1);
      const record = [...coordinator.records.values()][0];
      if (outcome === 'accept') await coordinator.accept(record.offer.transferId, 42);
      else if (outcome === 'fail') await coordinator.fail(record.offer.transferId, 'storage_failed');
      else if (outcome === 'timeout') { timers[0](); await flush(); }
      else await coordinator.reject(record.offer.transferId);
      const results = await Promise.all([first, duplicate, sameStream]);
      assert.ok(results.every((child) => child.toString() === results[0].toString()));
      if (outcome === 'accept') await coordinator.cancel(record.offer.transferId);
      const replay = await adapter.handleFileIq(accountId, offer('repeat-iq', 'repeat-sid'));
      assert.equal(replay.toString(), results[0].toString());
      const changedPayload = offer('repeat-iq', 'repeat-sid');
      changedPayload.getChild('si', SI).attrs.profile = 'invalid';
      const repeatedIq = await adapter.handleFileIq(accountId, changedPayload);
      assert.equal(repeatedIq.toString(), results[0].toString());
      assert.equal(events.filter((event) => event.type === 'file.offerReceived').length, 1);
      assert.equal(events.filter((event) => ['completed', 'failed', 'cancelled'].includes(event.payload.state)).length, 1);
      assert.equal(coordinator.records.size, 0);
      assert.equal(adapter.filePending.size, 0);
      const lateOpen = await adapter.handleFileIq(accountId, xml('iq',
        { type: 'set', id: 'late-open', from }, xml('open', { xmlns: IBB, sid: 'repeat-sid', 'block-size': '1024' })));
      assert.ok(lateOpen.getChild('item-not-found', STANZA));
      const next = adapter.handleFileIq(accountId, offer('new-iq', 'new-sid'));
      assert.equal(coordinator.records.size, 1);
      await coordinator.reject([...coordinator.records.keys()][0]);
      await next;
      assert.equal(events.filter((event) => event.type === 'file.offerReceived').length, 2);
    } finally { await fs.rm(root, { recursive: true, force: true }); }
  });
}

test('C5-INC-02 correlation includes account, generation and full sender JID', async () => {
  const coordinator = new FileTransferCoordinator();
  const adapter = new XmppAdapter(false, null, [], coordinator);
  const responses = [];
  responses.push(adapter.handleFileIq(accountId, offer('shared-iq', 'shared-sid')));
  const otherResource = offer('shared-iq', 'shared-sid');
  otherResource.attrs.from = 'sender@example.invalid/Other';
  responses.push(adapter.handleFileIq(accountId, otherResource));
  responses.push(adapter.handleFileIq('another@example.invalid', offer('shared-iq', 'shared-sid')));
  adapter.sessionGenerations.set(accountId, 2);
  responses.push(adapter.handleFileIq(accountId, offer('shared-iq', 'shared-sid')));
  assert.equal(coordinator.records.size, 4);
  for (const id of [...coordinator.records.keys()]) await coordinator.reject(id);
  await Promise.all(responses);
});

test('C5-INC-02 bounded terminal memory never evicts an active negotiation', async () => {
  const coordinator = new FileTransferCoordinator();
  const adapter = new XmppAdapter(false, null, [], coordinator);
  const activeResponse = adapter.handleFileIq(accountId, offer('active-iq', 'active-sid'));
  const activeId = [...coordinator.records.keys()][0];
  let offers = 1;
  coordinator.onEvent((event) => { if (event.type === 'file.offerReceived') offers += 1; });
  for (let index = 0; index < 260; index += 1) {
    const response = adapter.handleFileIq(accountId, offer(`iq-${index}`, `sid-${index}`));
    const id = [...coordinator.records.keys()].find((candidate) => candidate !== activeId);
    await coordinator.reject(id);
    await response;
  }
  const duplicate = adapter.handleFileIq(accountId, offer('active-iq', 'active-sid'));
  assert.equal(coordinator.records.size, 1);
  assert.equal(offers, 261);
  await coordinator.reject(activeId);
  await Promise.all([activeResponse, duplicate]);
  // The oldest terminal entry has been evicted; the most recent remains replayable.
  await adapter.handleFileIq(accountId, offer('iq-259', 'sid-259'));
  assert.equal(coordinator.records.size, 0);
  const evicted = adapter.handleFileIq(accountId, offer('iq-0', 'sid-0'));
  assert.equal(coordinator.records.size, 1);
  await coordinator.reject([...coordinator.records.keys()][0]);
  await evicted;
});

test('C5-INC-02 real middleware replays consistent replies without another visible offer', async () => {
  const coordinator = new FileTransferCoordinator();
  const adapter = new XmppAdapter(false, null, [], coordinator);
  const session = require('@xmpp/client').client({ service: 'xmpp://example.invalid', domain: 'example.invalid' });
  const sent = [];
  session.send = async (stanza) => { sent.push(stanza); };
  adapter.sessions.set(accountId, session);
  adapter.installFileIqHandlers(accountId, session);
  session.emit('element', offer('duplicate', 'duplicate'));
  session.emit('element', offer('duplicate', 'duplicate'));
  assert.equal(coordinator.records.size, 1);
  await coordinator.reject([...coordinator.records.keys()][0]);
  await flush();
  session.emit('element', offer('duplicate', 'duplicate'));
  await flush();
  assert.equal(sent.length, 3);
  assert.ok(sent.every((reply) => reply.getChild('error')?.getChild('forbidden', STANZA)));
  assert.equal(coordinator.records.size, 0);
});

test('C5-IQ-01 installed iqCallee fallback is service-unavailable without a handler', async () => {
  const { default: createMiddleware } = await import('@xmpp/middleware');
  const { default: iqCallee } = await import('@xmpp/iq/callee.js');
  const events = new Map();
  const entity = { on(name, listener) { events.set(name, listener); }, emit() {} };
  const middleware = createMiddleware({ entity });
  iqCallee({ middleware, entity });
  const sent = [];
  entity.send = (stanza) => { sent.push(stanza); };
  const incoming = events.get('element');
  incoming(xml('iq', { type: 'set', id: 'offer-01', from: 'sender@example.invalid/Spark' }, xml('si', { xmlns: 'http://jabber.org/protocol/si' })));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].attrs.type, 'error');
  assert.equal(sent[0].getChild('error')?.getChild('service-unavailable', 'urn:ietf:params:xml:ns:xmpp-stanzas') !== undefined, true);
});

test('C5-IQ-02 real client middleware owns SI and sends one deferred rejection', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-iq-callee-'));
  const sent = [];
  const session = require('@xmpp/client').client({ service: 'xmpp://example.invalid', domain: 'example.invalid' });
  session.send = async (stanza) => { sent.push(stanza); };
  const coordinator = new FileTransferCoordinator({ root, selectDestination: async () => null });
  const adapter = new XmppAdapter(false, null, [], coordinator);
  adapter.sessions.set(accountId, session);
  adapter.sessionGenerations.set(accountId, 1);
  adapter.fileOwners.set(accountId, 42);
  adapter.installFileIqHandlers(accountId, session);
  session.on('element', (stanza) => { if (adapter.isFileIq(stanza)) adapter.fileIqHandled.add(stanza); });
  session.on('stanza', (stanza) => adapter.handleStanza(accountId, stanza));
  try {
    const incoming = offer('offer-middleware', 'sid-middleware');
    session.emit('element', incoming);
    session.emit('stanza', incoming);
    await flush();
    const record = [...coordinator.records.values()][0];
    assert.ok(record);
    assert.equal(sent.length, 0);
    await coordinator.reject(record.offer.transferId, 'user_rejected');
    await flush();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].attrs.id, 'offer-middleware');
    assert.equal(sent[0].attrs.type, 'error');
    assert.ok(sent[0].getChild('error')?.getChild('forbidden', STANZA));
    assert.equal(sent[0].getChild('error')?.getChild('service-unavailable', STANZA), undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('C5-IQ-03 real client middleware serializes accepted IBB open and close', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-iq-callee-'));
  const destination = path.join(root, 'received.bin');
  const sent = [];
  const session = require('@xmpp/client').client({ service: 'xmpp://example.invalid', domain: 'example.invalid' });
  session.send = async (stanza) => { sent.push(stanza); };
  const coordinator = new FileTransferCoordinator({ root, selectDestination: async () => destination });
  const adapter = new XmppAdapter(false, null, [], coordinator);
  adapter.sessions.set(accountId, session);
  adapter.sessionGenerations.set(accountId, 1);
  adapter.fileOwners.set(accountId, 42);
  adapter.installFileIqHandlers(accountId, session);
  const originalHandleFileIq = adapter.handleFileIq.bind(adapter);
  let closePromise;
  adapter.handleFileIq = (id, stanza) => { const result = originalHandleFileIq(id, stanza); if (stanza.getChild('close', IBB)) closePromise = result; return result; };
  session.on('element', (stanza) => { if (adapter.isFileIq(stanza)) adapter.fileIqHandled.add(stanza); });
  session.on('stanza', (stanza) => adapter.handleStanza(accountId, stanza));
  try {
    const incoming = offer('offer-middleware-accepted', 'sid-middleware-accepted');
    session.emit('element', incoming);
    session.emit('stanza', incoming);
    const record = [...coordinator.records.values()][0];
    const wrongOpen = xml('iq', { type: 'set', id: 'open-wrong-middleware', from }, xml('open', { xmlns: IBB, sid: 'sid-wrong', 'block-size': '61440', stanza: 'iq' }));
    session.emit('element', wrongOpen);
    session.emit('stanza', wrongOpen);
    await flush();
    assert.equal(sent.filter((stanza) => stanza.attrs.id === 'open-wrong-middleware').length, 1);
    assert.equal(sent.find((stanza) => stanza.attrs.id === 'open-wrong-middleware').attrs.type, 'error');
    await coordinator.accept(record.offer.transferId, 42);
    await flush();
    assert.deepEqual(sent.map((stanza) => [stanza.attrs.id, stanza.attrs.type]), [['open-wrong-middleware', 'error'], ['offer-middleware-accepted', 'result']]);
    const open = xml('iq', { type: 'set', id: 'open-middleware', from }, xml('open', { xmlns: IBB, sid: 'sid-middleware-accepted', 'block-size': '61440', stanza: 'iq' }));
    session.emit('element', open);
    session.emit('stanza', open);
    await flush();
    assert.equal(record.state, 'transferring');
    assert.equal(adapter.filePending.size, 1);
    const close = xml('iq', { type: 'set', id: 'close-middleware', from }, xml('close', { xmlns: IBB, sid: 'sid-middleware-accepted' }));
    session.emit('element', close);
    session.emit('stanza', close);
    await closePromise;
    await flush();
    assert.deepEqual(sent.map((stanza) => [stanza.attrs.id, stanza.attrs.type]), [['open-wrong-middleware', 'error'], ['offer-middleware-accepted', 'result'], ['open-middleware', 'result'], ['close-middleware', 'result']]);
    assert.equal(record.state, 'completed');
    assert.deepEqual(await fs.readFile(destination), Buffer.alloc(0));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('C5-INC-01 premature IBB close reports sender cancellation and removes the partial file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-iq-cancel-'));
  const sent = [];
  const session = require('@xmpp/client').client({ service: 'xmpp://example.invalid', domain: 'example.invalid' });
  session.send = async (stanza) => { sent.push(stanza); };
  const coordinator = new FileTransferCoordinator({ root, selectDestination: async () => path.join(root, 'received.bin') });
  const adapter = new XmppAdapter(false, null, [], coordinator);
  adapter.sessions.set(accountId, session);
  adapter.sessionGenerations.set(accountId, 1);
  adapter.fileOwners.set(accountId, 42);
  adapter.installFileIqHandlers(accountId, session);
  session.on('element', (stanza) => { if (adapter.isFileIq(stanza)) adapter.fileIqHandled.add(stanza); });
  session.on('stanza', (stanza) => adapter.handleStanza(accountId, stanza));
  try {
    const incoming = offer('sender-cancel-si', 'sender-cancel-sid', '3');
    session.emit('element', incoming);
    session.emit('stanza', incoming);
    const transfer = [...coordinator.records.values()][0];
    await coordinator.accept(transfer.offer.transferId, 42);
    for (const child of [
      xml('open', { xmlns: IBB, sid: 'sender-cancel-sid', 'block-size': '1024' }),
      xml('close', { xmlns: IBB, sid: 'sender-cancel-sid' }),
    ]) {
      const stanza = xml('iq', { type: 'set', id: `sender-cancel-${child.name}`, from }, child);
      session.emit('element', stanza);
      session.emit('stanza', stanza);
      for (let index = 0; index < 100 && !sent.some((reply) => reply.attrs.id === stanza.attrs.id); index += 1)
        await tick();
    }
    assert.equal(transfer.state, 'cancelled');
    assert.equal(transfer.endReason, 'cancelled_by_sender');
    assert.equal(sent.find((reply) => reply.attrs.id === 'sender-cancel-close')?.attrs.type, 'result');
    assert.equal(coordinator.records.size, 0);
    await assert.rejects(fs.readFile(path.join(root, 'received.bin')), { code: 'ENOENT' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
