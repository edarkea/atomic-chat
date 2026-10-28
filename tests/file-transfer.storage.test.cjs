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
