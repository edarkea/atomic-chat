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
    try { await fs.symlink(external, privateRoot, 'junction'); } catch (cause) { t.skip(`symlink unavailable: ${cause.code || cause.message}`); return; }
    const coordinator = new FileTransferCoordinator({ selectDestination: async () => destination });
    const record = coordinator.add({ offer: offer('symlink', 0), ownerSenderId: 7 });
    await assert.rejects(() => coordinator.accept(record.offer.transferId, 7));
    assert.equal(record.state, 'failed');
    assert.deepEqual(await fs.readdir(external), []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(external, { recursive: true, force: true });
  }
});

test('C5-FS-04 abandoned parts are removed without touching an active transfer', async () => {
  const context = await setup(0);
  const { coordinator, record, root } = context;
  const privateRoot = path.join(root, '.atomic-chat-transfers');
  const abandoned = path.join(privateRoot, 'abandoned.part');
  await fs.writeFile(abandoned, 'stale');
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
