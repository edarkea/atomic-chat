const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { FileTransferCoordinator } = require('../electron/file-transfer.cjs');

function offer(id, size) {
  return { transferId: id, accountId: 'account@example.invalid', conversationId: 'sender@example.invalid', senderJid: 'sender@example.invalid/Spark', name: 'fixture.bin', sizeBytes: String(size), transport: 'ibb', offeredAt: new Date().toISOString() };
}

async function setup(size, options = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-storage-'));
  const destination = path.join(root, 'received.bin');
  const coordinator = new FileTransferCoordinator({ selectDestination: async () => destination, ...options });
  const record = coordinator.add({ offer: offer(`file_${crypto.randomUUID()}`, size), ownerSenderId: 7 });
  await coordinator.accept(record.offer.transferId, 7);
  return { root, destination, coordinator, record };
}

async function parts(root) {
  const directory = path.join(root, '.atomic-chat-transfers');
  try { return (await fs.readdir(directory)).filter((name) => name.endsWith('.part')); } catch (cause) { if (cause.code === 'ENOENT') return []; throw cause; }
}

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

async function setupWithClock(size) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-clock-'));
  const destination = path.join(root, 'received.bin');
  const clock = new FakeClock();
  const coordinator = new FileTransferCoordinator({ selectDestination: async () => destination, scheduleTimeout: clock.setTimeout.bind(clock), cancelTimeout: clock.clearTimeout.bind(clock) });
  const record = coordinator.add({ offer: offer(`clock_${crypto.randomUUID()}`, size), ownerSenderId: 7 });
  return { root, destination, clock, coordinator, record };
}

test('C5-FS-01 publication collision preserves the existing file', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-collision-'));
  const destination = path.join(root, 'received.bin');
  const original = Buffer.from('original-content');
  await fs.writeFile(destination, original);
  const coordinator = new FileTransferCoordinator({ selectDestination: async () => destination, beforePublish: async () => { await fs.writeFile(destination, original); } });
  const record = coordinator.add({ offer: offer('collision', 3), ownerSenderId: 7 });
  try {
    await coordinator.accept(record.offer.transferId, 7);
    await coordinator.append(record.offer.transferId, Buffer.from('new'));
    await assert.rejects(() => coordinator.complete(record.offer.transferId));
    assert.deepEqual(await fs.readFile(destination), original);
    assert.equal(record.state, 'failed');
    assert.deepEqual(await parts(root), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('C5-FS-02 cancellation is terminal while a write is suspended', async () => {
  const context = await setup(3);
  const { coordinator, record, root, destination } = context;
  let release;
  const originalWrite = record.handle.write.bind(record.handle);
  record.handle.write = (...args) => new Promise((resolve, reject) => { release = () => originalWrite(...args).then(resolve, reject); });
  try {
    const appendPromise = coordinator.append(record.offer.transferId, Buffer.from('abc'));
    for (let index = 0; index < 100 && !release; index += 1) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(typeof release, 'function');
    const cancelPromise = coordinator.cancel(record.offer.transferId);
    assert.equal(record.state, 'cancelled');
    release();
    await assert.rejects(appendPromise, (cause) => cause.code === 'CONFLICT');
    const cancelled = await cancelPromise;
    assert.equal(cancelled.state, 'cancelled');
    assert.equal(record.bytes.toString(), '0');
    assert.equal(await fs.access(destination).then(() => true, () => false), false);
    assert.deepEqual(await parts(root), []);
    await assert.rejects(() => coordinator.complete(record.offer.transferId));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('C5-FS-03 an existing transfer directory symlink fails closed', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-symlink-'));
  const destination = path.join(root, 'received.bin');
  const privateRoot = path.join(root, '.atomic-chat-transfers');
  const external = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-external-'));
  try {
    const keep = path.join(external, 'keep.part');
    await fs.writeFile(keep, 'do-not-delete');
    try { await fs.symlink(external, privateRoot, 'junction'); } catch (cause) { t.skip(`symlink unavailable: ${cause.code || cause.message}`); return; }
    const coordinator = new FileTransferCoordinator({ selectDestination: async () => destination });
    const record = coordinator.add({ offer: offer('symlink', 0), ownerSenderId: 7 });
    await assert.rejects(() => coordinator.accept(record.offer.transferId, 7));
    assert.equal(record.state, 'failed');
    assert.deepEqual(await fs.readFile(keep, 'utf8'), 'do-not-delete');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(external, { recursive: true, force: true });
  }
});

test('C5-FS-04 abandoned parts are removed without touching an active transfer', async () => {
  const context = await setup(0);
  const { coordinator, record, root } = context;
  const privateRoot = path.join(root, '.atomic-chat-transfers');
  const abandoned = path.join(privateRoot, 'atomic-2147483647-old-abandoned.part');
  const ownerMarker = `${abandoned}.owner`;
  await fs.writeFile(abandoned, 'stale');
  await fs.writeFile(ownerMarker, JSON.stringify({ file: path.basename(abandoned), pid: 2147483647, instanceId: 'old-instance' }));
  try {
    const second = coordinator.add({ offer: offer('cleanup', 0), ownerSenderId: 7 });
    await coordinator.accept(second.offer.transferId, 7);
    assert.equal(await fs.access(record.temporary).then(() => true, () => false), true);
    assert.equal(await fs.access(abandoned).then(() => true, () => false), false);
    await coordinator.cancel(record.offer.transferId);
    await coordinator.cancel(second.offer.transferId);
    assert.deepEqual(await parts(root), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('C5-FS-06 cancellation wins before the publication point', async () => {
  const context = await setup(3);
  const { coordinator, record, root, destination } = context;
  let release;
  const beforePublish = new Promise((resolve) => { release = resolve; });
  const entered = new Promise((resolve) => { coordinator.beforePublish = async () => { resolve(); await beforePublish; }; });
  try {
    await coordinator.append(record.offer.transferId, Buffer.from('abc'));
    const completePromise = coordinator.complete(record.offer.transferId);
    await entered;
    const cancelPromise = coordinator.cancel(record.offer.transferId);
    assert.equal(record.state, 'cancelled');
    release();
    await assert.rejects(completePromise, (cause) => cause.code === 'CONFLICT');
    assert.equal((await cancelPromise).state, 'cancelled');
    assert.equal(await fs.access(destination).then(() => true, () => false), false);
    assert.deepEqual(await parts(root), []);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('C5-FS-06 cancellation during publication reports the confirmed result', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-publishing-'));
  const destination = path.join(root, 'received.bin');
  let release;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const publication = new Promise((resolve) => { release = resolve; });
  const coordinator = new FileTransferCoordinator({
    selectDestination: async () => destination,
    publish: async (temporary, target) => {
      markStarted();
      await publication;
      await fs.link(temporary, target);
    },
  });
  const record = coordinator.add({ offer: offer('publishing', 3), ownerSenderId: 7 });
  try {
    await coordinator.accept(record.offer.transferId, 7);
    await coordinator.append(record.offer.transferId, Buffer.from('abc'));
    const completePromise = coordinator.complete(record.offer.transferId);
    await started;
    assert.equal(record.publicationState, 'publishing');
    const cancelPromise = coordinator.cancel(record.offer.transferId);
    release();
    assert.equal((await completePromise).state, 'completed');
    assert.equal((await cancelPromise).state, 'completed');
    assert.equal(record.state, 'completed');
    assert.deepEqual(await fs.readFile(destination), Buffer.from('abc'));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('C5-FS-06 cleanup failure after publication does not report a false failure', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-cleanup-failure-'));
  const destination = path.join(root, 'received.bin');
  const coordinator = new FileTransferCoordinator({ selectDestination: async () => destination, removeTemporary: async () => { throw new Error('cleanup unavailable'); } });
  const record = coordinator.add({ offer: offer('cleanup-failure', 3), ownerSenderId: 7 });
  try {
    await coordinator.accept(record.offer.transferId, 7);
    await coordinator.append(record.offer.transferId, Buffer.from('abc'));
    const result = await coordinator.complete(record.offer.transferId);
    assert.equal(result.state, 'completed');
    assert.equal(record.state, 'completed');
    assert.deepEqual(await fs.readFile(destination), Buffer.from('abc'));
    assert.equal(await fs.access(record.temporary).then(() => true, () => false), true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('C5-FS-07 pending offers do not consume active-transfer quotas', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-quotas-'));
  let destinationIndex = 0;
  const coordinator = new FileTransferCoordinator({ selectDestination: async () => path.join(root, `received-${destinationIndex++}.bin`) });
  const active = [0, 1].map((id) => coordinator.add({ offer: offer(`active-${id}`, 0), ownerSenderId: 7 }));
  try {
    await Promise.all(active.map((record) => coordinator.accept(record.offer.transferId, 7)));
    const pending = Array.from({ length: 8 }, (_, id) => coordinator.add({ offer: offer(`pending-${id}`, 0), ownerSenderId: 7 }));
    assert.equal(pending.length, 8);
    assert.throws(() => coordinator.add({ offer: offer('pending-over-limit', 0), ownerSenderId: 7 }), (cause) => cause.code === 'RESOURCE_CONSTRAINT');
    await assert.rejects(() => coordinator.accept(pending[0].offer.transferId, 7), (cause) => cause.code === 'RESOURCE_CONSTRAINT');
  } finally {
    await coordinator.cancelAccount('account@example.invalid');
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('C5-FS-07 concurrent accepts reserve the two active slots', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-concurrent-accept-'));
  let destinationIndex = 0;
  const coordinator = new FileTransferCoordinator({ selectDestination: async () => path.join(root, `received-${destinationIndex++}.bin`) });
  const records = [0, 1, 2].map((id) => coordinator.add({ offer: offer(`concurrent-${id}`, 0), ownerSenderId: 7 }));
  try {
    const results = await Promise.allSettled(records.map((record) => coordinator.accept(record.offer.transferId, 7)));
    assert.equal(results.filter((result) => result.status === 'fulfilled').length, 2);
    assert.equal(results.filter((result) => result.status === 'rejected' && result.reason.code === 'RESOURCE_CONSTRAINT').length, 1);
  } finally {
    await coordinator.cancelAccount('account@example.invalid');
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('C5-FINAL-01 uses independent offer, open, idle, and close deadlines', async () => {
  const offerContext = await setupWithClock(0);
  try {
    assert.equal(offerContext.record.timerPhase, 'offer');
    await offerContext.clock.advance(59999);
    assert.equal(offerContext.record.state, 'offered');
    await offerContext.clock.advance(1);
    assert.equal(offerContext.record.state, 'cancelled');
    assert.equal(offerContext.record.endReason, 'timed_out');
  } finally { await fs.rm(offerContext.root, { recursive: true, force: true }); }

  const openContext = await setupWithClock(1);
  try {
    await openContext.coordinator.accept(openContext.record.offer.transferId, 7);
    assert.equal(openContext.record.timerPhase, 'open');
    await openContext.clock.advance(29999);
    assert.equal(openContext.record.state, 'accepted');
    await openContext.clock.advance(1);
    assert.equal(openContext.record.state, 'failed');
    assert.equal(openContext.record.endReason, 'timed_out');
  } finally { await fs.rm(openContext.root, { recursive: true, force: true }); }

  const idleContext = await setupWithClock(6);
  try {
    await idleContext.coordinator.accept(idleContext.record.offer.transferId, 7);
    await idleContext.coordinator.open(idleContext.record.offer.transferId);
    assert.equal(idleContext.record.timerPhase, 'idle');
    await idleContext.clock.advance(59999);
    assert.equal(idleContext.record.state, 'transferring');
    await idleContext.clock.advance(1);
    assert.equal(idleContext.record.state, 'failed');
    assert.equal(idleContext.record.endReason, 'timed_out');
  } finally { await fs.rm(idleContext.root, { recursive: true, force: true }); }

  const closeContext = await setupWithClock(6);
  try {
    await closeContext.coordinator.accept(closeContext.record.offer.transferId, 7);
    await closeContext.coordinator.open(closeContext.record.offer.transferId);
    await closeContext.coordinator.append(closeContext.record.offer.transferId, Buffer.from('abc'));
    assert.equal(closeContext.record.timerPhase, 'idle');
    await closeContext.clock.advance(59000);
    await closeContext.coordinator.append(closeContext.record.offer.transferId, Buffer.from('def'));
    assert.equal(closeContext.record.timerPhase, 'close');
    await closeContext.clock.advance(29999);
    assert.equal(closeContext.record.state, 'transferring');
    await closeContext.clock.advance(1);
    assert.equal(closeContext.record.state, 'failed');
    assert.equal(closeContext.record.endReason, 'timed_out');
  } finally { await fs.rm(closeContext.root, { recursive: true, force: true }); }

  const zeroContext = await setupWithClock(0);
  try {
    await zeroContext.coordinator.accept(zeroContext.record.offer.transferId, 7);
    await zeroContext.coordinator.open(zeroContext.record.offer.transferId);
    assert.equal(zeroContext.record.timerPhase, 'close');
    await zeroContext.clock.advance(29999);
    assert.equal(zeroContext.record.state, 'transferring');
    await zeroContext.clock.advance(1);
    assert.equal(zeroContext.record.state, 'failed');
  } finally { await fs.rm(zeroContext.root, { recursive: true, force: true }); }
});

test('C5-FINAL-02 retries temporary cleanup and preserves completion', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-cleanup-retry-'));
  const destination = path.join(root, 'received.bin');
  let attempts = 0;
  let cleaned;
  const cleanedPromise = new Promise((resolve) => { cleaned = resolve; });
  const coordinator = new FileTransferCoordinator({
    selectDestination: async () => destination,
    cleanupRetryDelay: 0,
    unrefCleanupTimers: false,
    removeTemporary: async (record) => {
      attempts += 1;
      if (attempts === 1) throw new Error('transient cleanup error');
      await fs.rm(record.temporary, { force: true });
      await fs.rm(record.ownerMarker, { force: true });
      cleaned();
    },
  });
  const record = coordinator.add({ offer: offer('cleanup-retry', 3), ownerSenderId: 7 });
  try {
    await coordinator.accept(record.offer.transferId, 7);
    await coordinator.append(record.offer.transferId, Buffer.from('abc'));
    const result = await coordinator.complete(record.offer.transferId);
    assert.equal(result.state, 'completed');
    await cleanedPromise;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(attempts, 2);
    assert.equal(coordinator.cleanupJobs.size, 0);
    assert.equal(coordinator.ownedTemporaries.has(record.temporary), false);
    assert.equal(await fs.access(destination).then(() => true, () => false), true);
    assert.equal(await fs.access(record.temporary).then(() => true, () => false), false);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});

test('C5-FINAL-02 bounds persistent cleanup retries without reverting completed', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-cleanup-persistent-'));
  const destination = path.join(root, 'received.bin');
  let attempts = 0;
  let exhausted;
  const exhaustedPromise = new Promise((resolve) => { exhausted = resolve; });
  const coordinator = new FileTransferCoordinator({
    selectDestination: async () => destination,
    cleanupRetryDelay: 0,
    cleanupRetryLimit: 2,
    unrefCleanupTimers: false,
    removeTemporary: async () => {
      attempts += 1;
      if (attempts === 3) exhausted();
      throw new Error('persistent cleanup error');
    },
  });
  const record = coordinator.add({ offer: offer('cleanup-persistent', 3), ownerSenderId: 7 });
  try {
    await coordinator.accept(record.offer.transferId, 7);
    await coordinator.append(record.offer.transferId, Buffer.from('abc'));
    assert.equal((await coordinator.complete(record.offer.transferId)).state, 'completed');
    await exhaustedPromise;
    assert.equal(record.state, 'completed');
    assert.equal(coordinator.cleanupJobs.size, 0);
    assert.equal(record.cleanupPending, true);
    assert.equal(coordinator.ownedTemporaries.has(record.temporary), true);
    assert.equal(await fs.access(destination).then(() => true, () => false), true);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
