const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { xml } = require('@xmpp/client');
const { FileTransferCoordinator } = require('../electron/file-transfer.cjs');
const { XmppAdapter } = require('../electron/xmpp-adapter.cjs');

const SI = 'http://jabber.org/protocol/si';
const FILE = 'http://jabber.org/protocol/si/profile/file-transfer';
const FEATURE = 'http://jabber.org/protocol/feature-neg';
const FORM = 'jabber:x:data';
const IBB = 'http://jabber.org/protocol/ibb';
const ACCOUNT = 'account@example.invalid';
const FROM = 'spark@example.invalid/Spark';

class FakeClock {
  constructor() { this.now = 0; this.nextId = 0; this.jobs = new Map(); }
  setTimeout(callback, milliseconds) {
    const id = ++this.nextId;
    this.jobs.set(id, { callback, due: this.now + milliseconds });
    return id;
  }
  clearTimeout(id) { this.jobs.delete(id); }
  async advance(milliseconds) {
    this.now += milliseconds;
    while (true) {
      const due = [...this.jobs.entries()].filter(([, job]) => job.due <= this.now).sort(([, left], [, right]) => left.due - right.due);
      if (!due.length) break;
      for (const [id, job] of due) {
        if (!this.jobs.delete(id)) continue;
        job.callback();
        for (let index = 0; index < 8; index += 1) await Promise.resolve();
      }
    }
  }
}

function offer(id, size) {
  return { transferId: id, accountId: ACCOUNT, conversationId: 'spark@example.invalid', senderJid: FROM, name: 'fixture.bin', sizeBytes: String(size), transport: 'ibb', offeredAt: new Date().toISOString() };
}

async function coordinatorWithClock(size) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-resources-'));
  const destination = path.join(root, 'received.bin');
  const clock = new FakeClock();
  const coordinator = new FileTransferCoordinator({
    selectDestination: async () => destination,
    scheduleTimeout: clock.setTimeout.bind(clock),
    cancelTimeout: clock.clearTimeout.bind(clock),
    now: () => clock.now,
  });
  const record = coordinator.add({ offer: offer(`resource_${size}_${Math.random()}`, size), ownerSenderId: 7 });
  await coordinator.accept(record.offer.transferId, 7);
  return { root, clock, coordinator, record };
}

function siOffer(iqId, sid, size) {
  return xml('iq', { type: 'set', id: iqId, from: FROM },
    xml('si', { xmlns: SI, id: sid, profile: FILE },
      xml('file', { xmlns: FILE, name: 'fixture.bin', size: String(size) }),
      xml('feature', { xmlns: FEATURE },
        xml('x', { xmlns: FORM, type: 'form' },
          xml('field', { var: 'stream-method', type: 'list-single' },
            xml('option', {}, xml('value', {}, IBB)))))));
}

function ibbStanza(kind, id, sid, body, seq = 0, blockSize = 61440) {
  const child = kind === 'open'
    ? xml('open', { xmlns: IBB, sid, 'block-size': String(blockSize), stanza: 'iq' })
    : kind === 'close'
      ? xml('close', { xmlns: IBB, sid })
      : xml('data', { xmlns: IBB, sid, seq: String(seq) }, body.toString('base64'));
  return xml('iq', { type: 'set', id, from: FROM }, child);
}

test('C5-RES-01 coalesces burst progress to four updates per second and keeps exact bytes', async () => {
  const context = await coordinatorWithClock(32);
  const progress = [];
  const unsubscribe = context.coordinator.onEvent((event) => {
    if (event.type === 'file.stateChanged' && event.payload.state === 'transferring' && event.payload.bytesTransferred !== '0') progress.push({ at: context.clock.now, bytes: event.payload.bytesTransferred });
  });
  try {
    await context.coordinator.open(context.record.offer.transferId);
    for (let burst = 0; burst < 4; burst += 1) {
      for (let block = 0; block < 8; block += 1) await context.coordinator.append(context.record.offer.transferId, Buffer.from([burst * 8 + block]));
      await context.clock.advance(250);
    }
    assert.equal(context.record.bytes.toString(), '32');
    assert.deepEqual(progress, [
      { at: 250, bytes: '8' },
      { at: 500, bytes: '16' },
      { at: 750, bytes: '24' },
      { at: 1000, bytes: '32' },
    ]);
    await context.coordinator.cancel(context.record.offer.transferId);
    await context.clock.advance(1000);
    assert.equal(progress.length, 4);
  } finally {
    unsubscribe();
    await fs.rm(context.root, { recursive: true, force: true });
  }
});

test('C5-RES-02 releases terminal records, transient references, and timers after accumulation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-retention-'));
  const destination = path.join(root, 'received.bin');
  const clock = new FakeClock();
  const coordinator = new FileTransferCoordinator({
    selectDestination: async () => destination,
    scheduleTimeout: clock.setTimeout.bind(clock),
    cancelTimeout: clock.clearTimeout.bind(clock),
  });
  let lastRecord;
  try {
    for (let index = 0; index < 64; index += 1) {
      const record = coordinator.add({ offer: offer(`retention-${index}`, 0), ownerSenderId: 7, iq: { synthetic: true }, session: { synthetic: true }, onAccepted: () => undefined });
      lastRecord = record;
      await coordinator.accept(record.offer.transferId, 7);
      await coordinator.cancel(record.offer.transferId);
    }
    assert.equal(coordinator.records.size, 0);
    assert.equal(coordinator.cleanupJobs.size, 0);
    assert.equal(coordinator.ownedTemporaries.size, 0);
    assert.equal(clock.jobs.size, 0);
    assert.equal(lastRecord.handle, undefined);
    assert.equal(lastRecord.iq, undefined);
    assert.equal(lastRecord.session, undefined);
    assert.equal(lastRecord.onAccepted, undefined);
    assert.equal(lastRecord.temporary, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('C5-RES-03 bounds deferred IBB binary reservations and preserves ordered replies', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-buffers-'));
  const destination = path.join(root, 'received.bin');
  const sent = [];
  const session = { send: async (stanza) => { sent.push(stanza); } };
  const blockSize = 61440;
  const coordinator = new FileTransferCoordinator({ selectDestination: async () => destination });
  const adapter = new XmppAdapter(false, null, [], coordinator);
  adapter.sessions.set(ACCOUNT, session);
  adapter.sessionGenerations.set(ACCOUNT, 1);
  adapter.fileOwners.set(ACCOUNT, 7);
  try {
    adapter.handleStanza(ACCOUNT, siOffer('resource-offer', 'resource-sid', blockSize * 5));
    const record = [...coordinator.records.values()][0];
    await coordinator.accept(record.offer.transferId, 7);
    const pending = adapter.filePending.get(`${ACCOUNT}|1|${FROM}|resource-sid`);
    adapter.handleStanza(ACCOUNT, ibbStanza('open', 'resource-open', 'resource-sid'));
    await pending.protocolQueue;

    const originalWrite = record.handle.write.bind(record.handle);
    let release;
    let started;
    const startedPromise = new Promise((resolve) => { started = resolve; });
    let first = true;
    record.handle.write = (...args) => {
      if (!first) return originalWrite(...args);
      first = false;
      started();
      return new Promise((resolve, reject) => { release = () => originalWrite(...args).then(resolve, reject); });
    };
    const body = Buffer.alloc(blockSize, 0x61);
    for (let seq = 0; seq < 4; seq += 1) adapter.handleStanza(ACCOUNT, ibbStanza('data', `resource-data-${seq}`, 'resource-sid', body, seq, blockSize));
    const acceptedQueue = pending.protocolQueue;
    for (let seq = 4; seq < 8; seq += 1) adapter.handleStanza(ACCOUNT, ibbStanza('data', `resource-data-${seq}`, 'resource-sid', body, seq, blockSize));
    await startedPromise;
    assert.equal(pending.pendingBinaryBytes, blockSize * 4);
    assert.strictEqual(pending.protocolQueue, acceptedQueue);
    assert.deepEqual(sent.slice(2).map((stanza) => [stanza.attrs.id, stanza.attrs.type]), [
      ['resource-data-4', 'error'],
      ['resource-data-5', 'error'],
      ['resource-data-6', 'error'],
      ['resource-data-7', 'error'],
    ]);
    release();
    await pending.protocolQueue;
    assert.equal(pending.pendingBinaryBytes, 0);
    assert.equal(record.bytes.toString(), String(blockSize * 4));
    assert.deepEqual(sent.slice(6).map((stanza) => [stanza.attrs.id, stanza.attrs.type]), [
      ['resource-data-0', 'result'],
      ['resource-data-1', 'result'],
      ['resource-data-2', 'result'],
      ['resource-data-3', 'result'],
    ]);
    assert.equal(record.state, 'transferring');
    assert.equal(adapter.filePending.size, 1);

    adapter.handleStanza(ACCOUNT, ibbStanza('data', 'resource-data-retry-4', 'resource-sid', body, 4, blockSize));
    await pending.protocolQueue;
    assert.equal(pending.pendingBinaryBytes, 0);
    assert.equal(record.bytes.toString(), String(blockSize * 5));
    assert.equal(sent.at(-1).attrs.id, 'resource-data-retry-4');
    assert.equal(sent.at(-1).attrs.type, 'result');

    adapter.handleStanza(ACCOUNT, ibbStanza('close', 'resource-close', 'resource-sid'));
    await pending.protocolQueue;
    assert.equal(record.state, 'completed');
    assert.equal(coordinator.records.size, 0);
    assert.equal(adapter.filePending.size, 0);
    assert.equal(sent.at(-1).attrs.id, 'resource-close');
    assert.equal(sent.at(-1).attrs.type, 'result');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('C5-RES-03A bounds data admitted while open is pending and rejects idle pre-open data synchronously', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-preopen-'));
  const destination = path.join(root, 'received.bin');
  const sent = [];
  const session = { send: async (stanza) => { sent.push(stanza); } };
  const coordinator = new FileTransferCoordinator({ selectDestination: async () => destination });
  const adapter = new XmppAdapter(false, null, [], coordinator);
  adapter.sessions.set(ACCOUNT, session);
  adapter.sessionGenerations.set(ACCOUNT, 1);
  adapter.fileOwners.set(ACCOUNT, 7);
  let releaseOpen;
  let openStarted;
  const openStartedPromise = new Promise((resolve) => { openStarted = resolve; });
  const openGate = new Promise((resolve) => { releaseOpen = resolve; });
  try {
    const blockSize = 61440;
    adapter.handleStanza(ACCOUNT, siOffer('preopen-offer', 'preopen-sid', blockSize * 5));
    const record = [...coordinator.records.values()][0];
    await coordinator.accept(record.offer.transferId, 7);
    const pending = adapter.filePending.get(`${ACCOUNT}|1|${FROM}|preopen-sid`);
    const idleQueue = pending.protocolQueue;
    for (let id = 0; id < 4; id += 1) adapter.handleStanza(ACCOUNT, ibbStanza('data', `idle-data-${id}`, 'preopen-sid', Buffer.alloc(blockSize), id, blockSize));
    assert.equal(pending.openState, 'idle');
    assert.equal(pending.pendingBinaryBytes, 0);
    assert.strictEqual(pending.protocolQueue, idleQueue);
    const originalOpen = coordinator.open.bind(coordinator);
    coordinator.open = async (id) => { openStarted(); await openGate; return originalOpen(id); };
    adapter.handleStanza(ACCOUNT, ibbStanza('open', 'preopen-open', 'preopen-sid'));
    await openStartedPromise;
    const openQueue = pending.protocolQueue;
    const body = Buffer.alloc(blockSize, 0x61);
    for (let id = 0; id < 8; id += 1) adapter.handleStanza(ACCOUNT, ibbStanza('data', `preopen-data-${id}`, 'preopen-sid', body, id, blockSize));
    assert.notStrictEqual(pending.protocolQueue, openQueue);
    assert.equal(pending.pendingBinaryBytes, blockSize * 4);
    assert.equal(sent.filter((stanza) => stanza.attrs.type === 'error').length, 8);
    assert.equal(sent.filter((stanza) => stanza.attrs.id === 'preopen-open').length, 0);
    releaseOpen();
    await pending.protocolQueue;
    assert.equal(pending.openState, 'ready');
    assert.equal(pending.pendingBinaryBytes, 0);
    assert.equal(sent.filter((stanza) => stanza.attrs.id === 'preopen-open' && stanza.attrs.type === 'result').length, 1);
    assert.equal(record.bytes.toString(), String(blockSize * 4));

    adapter.handleStanza(ACCOUNT, ibbStanza('data', 'preopen-data-valid', 'preopen-sid', body, 4, blockSize));
    await pending.protocolQueue;
    assert.equal(pending.pendingBinaryBytes, 0);
    assert.equal(record.bytes.toString(), String(blockSize * 5));
    assert.equal(sent.at(-1).attrs.id, 'preopen-data-valid');
    assert.equal(sent.at(-1).attrs.type, 'result');

    adapter.handleStanza(ACCOUNT, ibbStanza('close', 'preopen-close', 'preopen-sid'));
    await pending.protocolQueue;
    assert.equal(record.state, 'completed');
    assert.equal(coordinator.records.size, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('C5-RES-02A storage failure during data releases the terminal path once', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-data-failure-'));
  const destination = path.join(root, 'received.bin');
  const sent = [];
  const session = { send: async (stanza) => { sent.push(stanza); } };
  const coordinator = new FileTransferCoordinator({ selectDestination: async () => destination });
  const adapter = new XmppAdapter(false, null, [], coordinator);
  adapter.sessions.set(ACCOUNT, session);
  adapter.sessionGenerations.set(ACCOUNT, 1);
  adapter.fileOwners.set(ACCOUNT, 7);
  try {
    adapter.handleStanza(ACCOUNT, siOffer('failure-offer', 'failure-sid', 3));
    const record = [...coordinator.records.values()][0];
    await coordinator.accept(record.offer.transferId, 7);
    const pending = adapter.filePending.get(`${ACCOUNT}|1|${FROM}|failure-sid`);
    adapter.handleStanza(ACCOUNT, ibbStanza('open', 'failure-open', 'failure-sid'));
    await pending.protocolQueue;
    record.handle.write = async () => { throw new Error('synthetic write failure'); };
    adapter.handleStanza(ACCOUNT, ibbStanza('data', 'failure-data', 'failure-sid', Buffer.from('abc'), 0));
    await pending.protocolQueue;
    assert.equal(record.state, 'failed');
    assert.equal(coordinator.records.size, 0);
    assert.equal(adapter.filePending.size, 0);
    assert.equal(pending.pendingBinaryBytes, 0);
    assert.deepEqual(sent.filter((stanza) => stanza.attrs.id === 'failure-data').map((stanza) => stanza.attrs.type), ['error']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('C5-RES-02A delayed SI rejection keeps the record until its IQ response finishes', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-si-reject-'));
  const destination = path.join(root, 'received.bin');
  const sent = [];
  let releaseResponse;
  let responseStarted;
  const responseStartedPromise = new Promise((resolve) => { responseStarted = resolve; });
  const responseGate = new Promise((resolve) => { releaseResponse = resolve; });
  const session = { send: async (stanza) => { sent.push(stanza); responseStarted(); await responseGate; } };
  const coordinator = new FileTransferCoordinator({ selectDestination: async () => destination });
  const adapter = new XmppAdapter(false, null, [], coordinator);
  adapter.sessions.set(ACCOUNT, session);
  adapter.sessionGenerations.set(ACCOUNT, 1);
  adapter.fileOwners.set(ACCOUNT, 7);
  try {
    adapter.handleStanza(ACCOUNT, siOffer('reject-offer', 'reject-sid', 0));
    const record = [...coordinator.records.values()][0];
    const pending = adapter.filePending.get(`${ACCOUNT}|1|${FROM}|reject-sid`);
    const rejectPromise = coordinator.reject(record.offer.transferId, 'user_rejected');
    await responseStartedPromise;
    assert.equal(record.state, 'cancelled');
    assert.equal(coordinator.records.size, 1);
    assert.equal(adapter.filePending.size, 0);
    releaseResponse();
    await rejectPromise;
    assert.equal(coordinator.records.size, 0);
    assert.equal(pending.record, record);
    assert.deepEqual(sent.filter((stanza) => stanza.attrs.id === 'reject-offer').map((stanza) => stanza.attrs.type), ['error']);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('C5-RES-02A delayed close response completes once without orphaned resources', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-close-reply-'));
  const destination = path.join(root, 'received.bin');
  const sent = [];
  let releaseClose;
  let closeStarted;
  const closeStartedPromise = new Promise((resolve) => { closeStarted = resolve; });
  const closeGate = new Promise((resolve) => { releaseClose = resolve; });
  const session = { send: async (stanza) => { sent.push(stanza); if (stanza.attrs.id === 'close-delay') { closeStarted(); await closeGate; } } };
  const coordinator = new FileTransferCoordinator({ selectDestination: async () => destination });
  const adapter = new XmppAdapter(false, null, [], coordinator);
  adapter.sessions.set(ACCOUNT, session);
  adapter.sessionGenerations.set(ACCOUNT, 1);
  adapter.fileOwners.set(ACCOUNT, 7);
  try {
    adapter.handleStanza(ACCOUNT, siOffer('close-offer', 'close-sid', 3));
    const record = [...coordinator.records.values()][0];
    await coordinator.accept(record.offer.transferId, 7);
    const pending = adapter.filePending.get(`${ACCOUNT}|1|${FROM}|close-sid`);
    adapter.handleStanza(ACCOUNT, ibbStanza('open', 'close-open', 'close-sid'));
    await pending.protocolQueue;
    adapter.handleStanza(ACCOUNT, ibbStanza('data', 'close-data', 'close-sid', Buffer.from('abc'), 0));
    await pending.protocolQueue;
    adapter.handleStanza(ACCOUNT, ibbStanza('close', 'close-delay', 'close-sid'));
    await closeStartedPromise;
    assert.equal(record.state, 'completed');
    assert.equal(coordinator.records.size, 0);
    assert.equal(adapter.filePending.size, 0);
    assert.equal(coordinator.cleanupJobs.size, 0);
    assert.equal(coordinator.ownedTemporaries.size, 0);
    assert.equal(sent.filter((stanza) => stanza.attrs.id === 'close-delay').length, 1);
    releaseClose();
    await pending.protocolQueue;
    assert.equal(sent.filter((stanza) => stanza.attrs.id === 'close-delay' && stanza.attrs.type === 'result').length, 1);
    assert.equal(record.timer, undefined);
    assert.equal(record.progressTimer, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
