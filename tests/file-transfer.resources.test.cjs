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
    adapter.handleStanza(ACCOUNT, siOffer('resource-offer', 'resource-sid', blockSize * 4));
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
    for (let seq = 0; seq < 8; seq += 1) adapter.handleStanza(ACCOUNT, ibbStanza('data', `resource-data-${seq}`, 'resource-sid', body, seq, blockSize));
    await startedPromise;
    assert.equal(pending.pendingBinaryBytes, blockSize * 4);
    assert.deepEqual(sent.map((stanza) => stanza.attrs.id), ['resource-offer', 'resource-open']);
    release();
    await pending.protocolQueue;
    assert.equal(pending.pendingBinaryBytes, 0);
    assert.equal(record.bytes.toString(), String(blockSize * 4));
    assert.deepEqual(sent.slice(2).map((stanza) => [stanza.attrs.id, stanza.attrs.type]), [
      ['resource-data-0', 'result'],
      ['resource-data-1', 'result'],
      ['resource-data-2', 'result'],
      ['resource-data-3', 'result'],
      ['resource-data-4', 'error'],
      ['resource-data-5', 'error'],
      ['resource-data-6', 'error'],
      ['resource-data-7', 'error'],
    ]);
    assert.equal(record.state, 'transferring');
    assert.equal(adapter.filePending.size, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
