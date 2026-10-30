const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { FileTransferCoordinator } = require('../electron/file-transfer.cjs');
const { OutgoingFileTransferCoordinator } = require('../electron/file-transfer-outgoing.cjs');

function timerHarness() {
  const timers = [];
  return {
    timers,
    scheduleTimeout: (callback, delay) => {
      const timer = { callback, delay, cancelled: false, unref: () => undefined };
      timers.push(timer);
      return timer;
    },
    cancelTimeout: (timer) => {
      if (timer) timer.cancelled = true;
    },
  };
}

function incomingOffer() {
  return {
    offer: {
      transferId: 'incoming-timeout',
      accountId: 'a@example.invalid',
      conversationId: 'b@example.invalid',
      senderJid: 'b@example.invalid/resource',
      name: 'fixture.bin',
      sizeBytes: '1',
      transport: 'ibb',
      offeredAt: new Date(0).toISOString(),
    },
    ownerSenderId: 1,
  };
}

test('captures one validated timeout per incoming transfer', async () => {
  const harness = timerHarness();
  const coordinator = new FileTransferCoordinator({
    getTimeoutSeconds: () => 180,
    scheduleTimeout: harness.scheduleTimeout,
    cancelTimeout: harness.cancelTimeout,
  });

  coordinator.add(incomingOffer());

  assert.equal(harness.timers[0].delay, 180000);
  await coordinator.reject('incoming-timeout');
});

test('uses the configured timeout for outgoing protocol phases without creating a total-duration limit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-timeout-'));
  const filePath = path.join(root, 'fixture.bin');
  await fs.writeFile(filePath, 'fixture');
  const harness = timerHarness();
  const coordinator = new OutgoingFileTransferCoordinator({
    getTimeoutSeconds: () => 600,
    scheduleTimeout: harness.scheduleTimeout,
    cancelTimeout: harness.cancelTimeout,
  });
  try {
    const operation = coordinator.start({
      filePath,
      offer: {
        transferId: 'outgoing-timeout',
        accountId: 'a@example.invalid',
        conversationId: 'b@example.invalid',
        senderJid: 'a@example.invalid',
        recipientJid: 'b@example.invalid/resource',
        name: 'fixture.bin',
        sizeBytes: '0',
        transport: 'ibb',
        offeredAt: new Date(0).toISOString(),
      },
      ownerSenderId: 1,
      siSessionId: 'si-timeout',
      transport: {
        sendOffer: () => new Promise(() => undefined),
      },
    });
    await Promise.resolve();
    for (let attempt = 0; attempt < 20 && !harness.timers.length; attempt += 1)
      await new Promise((resolve) => setImmediate(resolve));
    assert.equal(harness.timers[0].delay, 600000);
    harness.timers[0].callback();
    const result = await operation;
    assert.equal(result.endReason, 'timed_out');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
