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
