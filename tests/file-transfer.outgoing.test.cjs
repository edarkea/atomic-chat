const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { xml } = require('@xmpp/client');
const { OutgoingFileTransferCoordinator } = require('../electron/file-transfer-outgoing.cjs');
const { TransferResourceLimiter } = require('../electron/file-transfer-resources.cjs');
const { XmppAdapter } = require('../electron/xmpp-adapter.cjs');

const SI = 'http://jabber.org/protocol/si';
const FILE = 'http://jabber.org/protocol/si/profile/file-transfer';
const FEATURE = 'http://jabber.org/protocol/feature-neg';
const FORM = 'jabber:x:data';
const IBB = 'http://jabber.org/protocol/ibb';
const DISCO = 'http://jabber.org/protocol/disco#info';
const ACCOUNT = 'atomic@example.invalid';
const RECIPIENT = 'spark@example.invalid/Spark';

async function fixture(contents = Buffer.from('Atomic Spark fixture')) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-out-'));
  const filePath = path.join(root, 'fixture.bin');
  await fs.writeFile(filePath, contents);
  return { root, filePath };
}

function offer(transferId = 'file-test') {
  return { transferId, accountId: ACCOUNT, conversationId: 'spark@example.invalid', senderJid: ACCOUNT, recipientJid: RECIPIENT, name: 'fixture.bin', sizeBytes: '0', transport: 'ibb', offeredAt: new Date(0).toISOString() };
}

async function startSimple(coordinator, filePath, calls = {}) {
  return coordinator.start({ filePath, offer: offer(calls.transferId), ownerSenderId: 42, siSessionId: `si_${calls.transferId || 'test'}`, transport: {
    sendOffer: async (record) => { calls.offer = record; },
    sendOpen: async (record, blockSize) => { calls.open = { record, blockSize }; },
    sendData: async (record, block, sequence) => { (calls.data ||= []).push({ record, block: Buffer.from(block), sequence }); },
    sendClose: async (record) => { calls.close = record; },
  } });
}

test('C5-OUT-01 cancelled source selection never opens a transfer', async () => {
  const coordinator = new OutgoingFileTransferCoordinator();
  await assert.rejects(coordinator.start({ filePath: '', offer: offer(), ownerSenderId: 1, siSessionId: 'si-cancel', transport: { sendOffer: () => assert.fail('offer must not be sent') } }), { code: 'INVALID_INPUT' });
  assert.equal(coordinator.records.size, 0);
});
test('C5-OUT-02 streams blocks after SI acceptance with exact bytes and one ACK at a time', async () => {
  const { root, filePath } = await fixture(Buffer.from('abcdef'));
  try {
    const coordinator = new OutgoingFileTransferCoordinator({ blockSize: 2 });
    const calls = {};
    const result = await startSimple(coordinator, filePath, calls);
    assert.equal(result.state, 'completed');
    assert.equal(result.bytesTransferred, '6');
    assert.equal(calls.open.blockSize, 2);
    assert.deepEqual(calls.data.map(({ block, sequence }) => [block.toString(), sequence]), [['ab', 0], ['cd', 1], ['ef', 2]]);
    assert.equal(coordinator.records.size, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('C5-OUT-03 controlled progress is coalesced while terminal bytes remain exact', async () => {
  const { root, filePath } = await fixture(Buffer.from('123')); const timers = []; let clock = 0; const events = [];
  try {
    const coordinator = new OutgoingFileTransferCoordinator({ blockSize: 1, now: () => clock, scheduleProgressTimeout: (callback, delay) => { const timer = { callback, delay, cancelled: false }; timers.push(timer); return timer; }, cancelProgressTimeout: (timer) => { timer.cancelled = true; } });
    coordinator.onEvent((event) => events.push(event.payload));
    await coordinator.start({ filePath, offer: offer('file-progress'), ownerSenderId: 7, siSessionId: 'si-progress', transport: {
      sendOffer: async () => undefined,
      sendOpen: async () => undefined,
      sendData: async (_record, block, sequence) => { if (sequence === 1) { clock = 100; timers.shift()?.callback(); } assert.equal(block.length, 1); },
      sendClose: async () => undefined,
    } });
    const progress = events.filter((event) => event.state === 'transferring');
    assert.ok(progress.length <= 4);
    assert.equal(events.at(-1).state, 'completed');
    assert.equal(events.at(-1).bytesTransferred, '3');
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('C5-OUT-04 sequence wraps at 65535 without changing block order', async () => {
  const { root, filePath } = await fixture(Buffer.from('xy'));
  try {
    const coordinator = new OutgoingFileTransferCoordinator({ blockSize: 1, initialSequence: 65535 }); const calls = {};
    await startSimple(coordinator, filePath, { ...calls, transferId: 'file-wrap' });
    const observed = [];
    const wrapped = new OutgoingFileTransferCoordinator({ blockSize: 1, initialSequence: 65535 });
    await wrapped.start({ filePath, offer: offer('file-wrap-2'), ownerSenderId: 1, siSessionId: 'si-wrap', transport: { sendOffer: async () => undefined, sendOpen: async () => undefined, sendData: async (_record, block, sequence) => observed.push([block.toString(), sequence]), sendClose: async () => undefined } });
    assert.deepEqual(observed, [['x', 65535], ['y', 0]]);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('C5-OUT-05 remote rejection and source mutation fail safely and release resources', async () => {
  const rejected = await fixture(Buffer.from('reject')); const changed = await fixture(Buffer.from('stable'));
  try {
    const rejector = new OutgoingFileTransferCoordinator();
    const rejectedResult = await rejector.start({ filePath: rejected.filePath, offer: offer('file-rejected'), ownerSenderId: 1, siSessionId: 'si-rejected', transport: { sendOffer: async () => { const error = new Error('rejected'); error.code = 'REMOTE_REJECTED'; throw error; } } });
    assert.equal(rejectedResult.state, 'cancelled'); assert.equal(rejectedResult.endReason, 'cancelled_by_sender'); assert.equal(rejector.records.size, 0);
    const mutator = new OutgoingFileTransferCoordinator({ blockSize: 6 });
    const result = await mutator.start({ filePath: changed.filePath, offer: offer('file-mutated'), ownerSenderId: 1, siSessionId: 'si-mutated', transport: { sendOffer: async () => undefined, sendOpen: async () => undefined, sendData: async () => { await fs.appendFile(changed.filePath, Buffer.from('!')); }, sendClose: async () => assert.fail('close must not follow integrity failure') } });
    assert.equal(result.state, 'failed'); assert.equal(result.endReason, 'integrity_failed'); assert.equal(mutator.records.size, 0);
  } finally { await fs.rm(rejected.root, { recursive: true, force: true }); await fs.rm(changed.root, { recursive: true, force: true }); }
});

test('C5-OUT-06 SI timeout is terminal and does not retain the source handle', async () => {
  const { root, filePath } = await fixture(Buffer.from('timeout'));
  try {
    const coordinator = new OutgoingFileTransferCoordinator({ siTimeout: 5 });
    const result = await coordinator.start({ filePath, offer: offer('file-timeout'), ownerSenderId: 1, siSessionId: 'si-timeout', transport: { sendOffer: async () => new Promise(() => undefined) } });
    assert.equal(result.state, 'failed'); assert.equal(result.endReason, 'timed_out'); assert.equal(coordinator.records.size, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('C5-OUT-07 cancellation marks terminal before a deferred data ACK and cleans after it settles', async () => {
  const { root, filePath } = await fixture(Buffer.from('cancel')); let releaseData; let dataStarted = false;
  try {
    const coordinator = new OutgoingFileTransferCoordinator({ iqTimeout: 1000 });
    const startPromise = coordinator.start({ filePath, offer: offer('file-cancel'), ownerSenderId: 1, siSessionId: 'si-cancel', transport: { sendOffer: async () => undefined, sendOpen: async () => undefined, sendData: async () => { dataStarted = true; await new Promise((resolve) => { releaseData = resolve; }); }, sendClose: async () => assert.fail('cancelled transfer must not close') } });
    for (let index = 0; index < 100 && !dataStarted; index += 1) await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(dataStarted, true);
    const cancelPromise = coordinator.cancel('file-cancel');
    assert.equal(coordinator.get('file-cancel').state, 'cancelled');
    releaseData();
    const result = await cancelPromise; await startPromise;
    assert.equal(result.endReason, 'cancelled_by_sender'); assert.equal(coordinator.records.size, 0);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('C5-OUT-08 one shared limiter bounds account and global active transfers', () => {
  const limiter = new TransferResourceLimiter();
  limiter.reserve('a1', ACCOUNT, 'outgoing'); limiter.reserve('a2', ACCOUNT, 'incoming');
  assert.throws(() => limiter.reserve('a3', ACCOUNT, 'outgoing'), { code: 'RESOURCE_CONSTRAINT' });
  limiter.reserve('b1', 'other@example.invalid', 'outgoing'); limiter.reserve('c1', 'third@example.invalid', 'outgoing');
  assert.deepEqual(limiter.counts(ACCOUNT), { account: 2, global: 4 });
  limiter.release('a1'); assert.deepEqual(limiter.counts(ACCOUNT), { account: 1, global: 3 });
});

function adapterFixture({ wrongDiscoFrom = false, unsupported = false } = {}) {
  const adapter = new XmppAdapter(false, null, [], null, new OutgoingFileTransferCoordinator({ blockSize: 3 }));
  const sent = [];
  const session = { iqCaller: { request: async (request) => {
    sent.push(request);
    const child = request.children[0];
    if (child.name === 'query' && child.attrs.xmlns === DISCO) {
      const features = unsupported ? [] : [xml('feature', { var: SI }), xml('feature', { var: FILE }), xml('feature', { var: IBB })];
      return xml('iq', { type: 'result', id: request.attrs.id, from: wrongDiscoFrom ? 'other@example.invalid/Spark' : RECIPIENT }, xml('query', { xmlns: DISCO }, ...features));
    }
    if (child.name === 'si') return xml('iq', { type: 'result', id: request.attrs.id, from: RECIPIENT }, xml('si', { xmlns: SI, id: child.attrs.id }, xml('feature', { xmlns: FEATURE }, xml('x', { xmlns: FORM, type: 'submit' }, xml('field', { var: 'stream-method' }, xml('value', {}, IBB))))));
    return xml('iq', { type: 'result', id: request.attrs.id, from: RECIPIENT });
  } }, send: async () => undefined };
  adapter.sessions.set(ACCOUNT, session); adapter.states.set(ACCOUNT, { status: 'connected' }); adapter.sessionGenerations.set(ACCOUNT, 1); adapter.sessionDomains.set(ACCOUNT, 'example.invalid');
  adapter.rosters.set(ACCOUNT, new Map([['spark@example.invalid', { jid: 'spark@example.invalid', subscription: 'to' }]])); adapter.remoteResources.set(ACCOUNT, new Map([[RECIPIENT, { presence: 'available' }]]));
  return { adapter, sent };
}

test('C5-OUT-09 Spark path performs discovery, SI, open, ordered data and close with independent IDs', async () => {
  const { root, filePath } = await fixture(Buffer.from('hello')); const { adapter, sent } = adapterFixture();
  try {
    const result = await adapter.sendFile(ACCOUNT, { filePath, fileName: 'fixture.bin', conversationId: 'spark@example.invalid', ownerSenderId: 42 });
    assert.equal(result.state, 'completed'); assert.equal(result.bytesTransferred, '5');
    assert.deepEqual(sent.map((iq) => iq.children[0].name), ['query', 'si', 'open', 'data', 'data', 'close']);
    assert.notEqual(sent[1].children[0].attrs.id, result.offer.transferId);
    assert.equal(sent[2].children[0].attrs.sid, sent[1].children[0].attrs.id);
    assert.deepEqual(sent.filter((iq) => iq.children[0].name === 'data').map((iq) => [iq.children[0].attrs.seq, Buffer.from(iq.children[0].getText(), 'base64').toString()]), [['0', 'hel'], ['1', 'lo']]);
    assert.equal(sent.every((iq) => iq.attrs.to === undefined || iq.attrs.to === RECIPIENT), true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('C5-OUT-10 stale or incapable Spark resources are rejected before source transfer', async () => {
  const { root, filePath } = await fixture(Buffer.from('hello'));
  try {
    await assert.rejects(adapterFixture({ wrongDiscoFrom: true }).adapter.sendFile(ACCOUNT, { filePath, fileName: 'fixture.bin', conversationId: 'spark@example.invalid', ownerSenderId: 42 }), { code: 'RECIPIENT_UNAVAILABLE' });
    await assert.rejects(adapterFixture({ unsupported: true }).adapter.sendFile(ACCOUNT, { filePath, fileName: 'fixture.bin', conversationId: 'spark@example.invalid', ownerSenderId: 42 }), { code: 'UNSUPPORTED_METHOD' });
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
