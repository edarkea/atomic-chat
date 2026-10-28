const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { xml } = require('@xmpp/client');
const { XmppAdapter } = require('../electron/xmpp-adapter.cjs');
const { FileTransferCoordinator } = require('../electron/file-transfer.cjs');

const SI = 'http://jabber.org/protocol/si';
const FILE = 'http://jabber.org/protocol/si/profile/file-transfer';
const FEATURE = 'http://jabber.org/protocol/feature-neg';
const FORM = 'jabber:x:data';
const IBB = 'http://jabber.org/protocol/ibb';
const STANZA = 'urn:ietf:params:xml:ns:xmpp-stanzas';
const from = 'spark@example.invalid/Spark';

function offer(iqId = 'offer-01', sid = 'sid-01', size = '3') {
  return xml('iq', { type: 'set', id: iqId, from },
    xml('si', { xmlns: SI, id: sid, profile: FILE },
      xml('file', { xmlns: FILE, name: 'fixture.bin', size },
        xml('desc', {}, 'synthetic laboratory fixture')),
      xml('feature', { xmlns: FEATURE },
        xml('x', { xmlns: FORM, type: 'form' },
          xml('field', { var: 'stream-method', type: 'list-single' },
            xml('option', {}, xml('value', {}, IBB)))))));
}

function stanza(kind, id, sid, body = null, seq = 0, blockSize = 61440) {
  const child = kind === 'open'
    ? xml('open', { xmlns: IBB, sid, 'block-size': String(blockSize), stanza: 'iq' })
    : kind === 'data'
      ? xml('data', { xmlns: IBB, sid, seq: String(seq) }, body.toString('base64'))
      : xml('close', { xmlns: IBB, sid });
  return xml('iq', { type: 'set', id, from }, child);
}

async function eventually(predicate, message = 'condition not reached') {
  for (let i = 0; i < 1000; i += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(message);
}

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-int-'));
  const destination = path.join(root, 'received.bin');
  const sent = [];
  const session = { send: async (value) => { sent.push(value); } };
  const coordinator = new FileTransferCoordinator({ selectDestination: async () => destination });
  const adapter = new XmppAdapter(false, null, [], coordinator);
  adapter.sessions.set('account@example.invalid', session);
  adapter.sessionGenerations.set('account@example.invalid', 1);
  adapter.fileOwners.set('account@example.invalid', 7);
  return { root, destination, sent, session, coordinator, adapter, accountId: 'account@example.invalid' };
}

async function captureTrace(run) {
  const previousFlag = process.env.ATOMIC_XMPP_FILE_TRACE;
  const previousInfo = console.info;
  const lines = [];
  process.env.ATOMIC_XMPP_FILE_TRACE = 'true';
  console.info = (...args) => lines.push(args.join(' '));
  try { await run(); } finally { console.info = previousInfo; if (previousFlag === undefined) delete process.env.ATOMIC_XMPP_FILE_TRACE; else process.env.ATOMIC_XMPP_FILE_TRACE = previousFlag; }
  return lines;
}

test('C5-INT-01 SI acceptance and IBB IQ complete the real coordinator path', async () => {
  const ctx = await fixture();
  try {
    ctx.adapter.handleStanza(ctx.accountId, offer('offer-01', 'sid-01', '3'));
    const record = [...ctx.coordinator.records.values()][0];
    assert.ok(record);
    assert.equal(record.state, 'offered');
    assert.equal(ctx.sent.length, 0);

    await ctx.coordinator.accept(record.offer.transferId, 7);
    const pending = ctx.adapter.filePending.get('account@example.invalid|1|spark@example.invalid/Spark|sid-01');
    assert.equal(ctx.sent.length, 1);
    assert.equal(ctx.sent[0].attrs.type, 'result');
    assert.equal(ctx.sent[0].attrs.id, 'offer-01');
    assert.equal(ctx.sent[0].getChild('si', SI).attrs.id, undefined);

    ctx.adapter.handleStanza(ctx.accountId, stanza('open', 'open-01', 'sid-01'));
    ctx.adapter.handleStanza(ctx.accountId, stanza('data', 'data-01', 'sid-01', Buffer.from('abc'), 0));
    ctx.adapter.handleStanza(ctx.accountId, stanza('close', 'close-01', 'sid-01'));
    await pending.protocolQueue;
    assert.equal(record.state, 'completed');
    assert.deepEqual(await fs.readFile(ctx.destination), Buffer.from('abc'));
    const replies = ctx.sent.filter((value) => ['open-01', 'data-01', 'close-01'].includes(value.attrs.id));
    assert.deepEqual(replies.map((value) => [value.attrs.id, value.attrs.type]), [['open-01', 'result'], ['data-01', 'result'], ['close-01', 'result']]);
  } finally {
    await fs.rm(ctx.root, { recursive: true, force: true });
  }
});

test('C5-INT-02 valid offer stays unanswered and rejection is one IQ error', async () => {
  const ctx = await fixture();
  try {
    ctx.adapter.handleStanza(ctx.accountId, offer('offer-02', 'sid-02', '0'));
    const record = [...ctx.coordinator.records.values()][0];
    assert.equal(ctx.sent.length, 0);
    await ctx.coordinator.reject(record.offer.transferId, 'user_rejected');
    assert.equal(ctx.sent.length, 1);
    assert.equal(ctx.sent[0].attrs.id, 'offer-02');
    assert.equal(ctx.sent[0].attrs.type, 'error');
    assert.ok(ctx.sent[0].getChild('error')?.getChild('forbidden', STANZA));
  } finally {
    await fs.rm(ctx.root, { recursive: true, force: true });
  }
});

test('C5-INT-03 84538-byte fixture preserves bytes and SHA-256', async () => {
  const ctx = await fixture();
  try {
    const source = crypto.randomBytes(84538);
    ctx.adapter.handleStanza(ctx.accountId, offer('offer-03', 'sid-03', String(source.length)));
    const record = [...ctx.coordinator.records.values()][0];
    await ctx.coordinator.accept(record.offer.transferId, 7);
    const pending = ctx.adapter.filePending.get('account@example.invalid|1|spark@example.invalid/Spark|sid-03');
    ctx.adapter.handleStanza(ctx.accountId, stanza('open', 'open-03', 'sid-03', null, 0, 61440));
    ctx.adapter.handleStanza(ctx.accountId, stanza('data', 'data-03a', 'sid-03', source.subarray(0, 61440), 0, 61440));
    ctx.adapter.handleStanza(ctx.accountId, stanza('data', 'data-03b', 'sid-03', source.subarray(61440), 1, 61440));
    ctx.adapter.handleStanza(ctx.accountId, stanza('close', 'close-03', 'sid-03'));
    await pending.protocolQueue;
    assert.equal(record.state, 'completed');
    assert.equal(record.bytes.toString(), '84538');
    assert.equal((await crypto.createHash('sha256').update(await fs.readFile(ctx.destination)).digest('hex')), crypto.createHash('sha256').update(source).digest('hex'));
  } finally {
    await fs.rm(ctx.root, { recursive: true, force: true });
  }
});

test('C5-INT-04 deferred write keeps data and close ACKs behind persistence', async () => {
  const ctx = await fixture();
  try {
    ctx.adapter.handleStanza(ctx.accountId, offer('offer-04', 'sid-04', '3'));
    const record = [...ctx.coordinator.records.values()][0];
    await ctx.coordinator.accept(record.offer.transferId, 7);
    const pending = ctx.adapter.filePending.get('account@example.invalid|1|spark@example.invalid/Spark|sid-04');
    ctx.adapter.handleStanza(ctx.accountId, stanza('open', 'open-04', 'sid-04'));
    const originalWrite = record.handle.write.bind(record.handle);
    let release;
    record.handle.write = (...args) => new Promise((resolve, reject) => { release = () => originalWrite(...args).then(resolve, reject); });
    ctx.adapter.handleStanza(ctx.accountId, stanza('data', 'data-04', 'sid-04', Buffer.from('abc'), 0));
    ctx.adapter.handleStanza(ctx.accountId, stanza('close', 'close-04', 'sid-04'));
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(ctx.sent.map((value) => value.attrs.id), ['offer-04', 'open-04']);
    release();
    await pending.protocolQueue;
    assert.equal(record.state, 'completed');
    assert.deepEqual(ctx.sent.filter((value) => value.attrs.type === 'result').map((value) => value.attrs.id), ['offer-04', 'open-04', 'data-04', 'close-04']);
  } finally {
    await fs.rm(ctx.root, { recursive: true, force: true });
  }
});

test('C5-NEG-01 traces SI send attempt and transport failure without sensitive fields', async () => {
  const ctx = await fixture();
  try {
    const lines = await captureTrace(async () => {
      ctx.adapter.handleStanza(ctx.accountId, offer('offer-fail', 'sid-fail', '0'));
      ctx.session.send = async (value) => { if (value.attrs.id === 'offer-fail') throw new Error('send failed'); ctx.sent.push(value); };
      const record = [...ctx.coordinator.records.values()][0];
      await assert.rejects(() => ctx.coordinator.accept(record.offer.transferId, 7));
    });
    assert.ok(lines.some((line) => line.includes('SI_RESULT_TX_ATTEMPT')));
    assert.ok(lines.some((line) => line.includes('SI_RESULT_TX_FAILED')));
    assert.ok(!lines.some((line) => /spark@example|sid-fail|offer-fail|fixture\.bin|<iq|base64/i.test(line)));
  } finally { await fs.rm(ctx.root, { recursive: true, force: true }); }
});

test('C5-NEG-02 observes an unmatched IBB open without exposing identifiers', async () => {
  const ctx = await fixture();
  try {
    const lines = await captureTrace(async () => { ctx.adapter.handleStanza(ctx.accountId, stanza('open', 'open-unknown', 'unknown-sid')); });
    assert.ok(lines.some((line) => line.includes('IBB_OPEN_CANDIDATE_RX')));
    assert.ok(lines.some((line) => line.includes('IBB_OPEN_UNMATCHED')));
    assert.ok(!lines.some((line) => /spark@example|unknown-sid|open-unknown|<iq/i.test(line)));
    assert.equal(ctx.sent.at(-1).attrs.type, 'error');
  } finally { await fs.rm(ctx.root, { recursive: true, force: true }); }
});
