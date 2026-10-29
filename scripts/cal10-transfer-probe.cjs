const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { FileTransferCoordinator } = require('../electron/file-transfer.cjs');
const { OutgoingFileTransferCoordinator } = require('../electron/file-transfer-outgoing.cjs');

const cycles = Math.max(1, Number.parseInt(process.env.ATOMIC_CAL10_TRANSFER_CYCLES || '250', 10));

function fakeTimer() {
  return { unref() {} };
}

function cancelTimer() {}

function memory() {
  const usage = process.memoryUsage();
  return { rss: usage.rss, heapUsed: usage.heapUsed, external: usage.external };
}

async function run() {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'atomic-chat-cal10-transfer-'));
  const sourcePath = path.join(root, 'source.bin');
  await fsp.writeFile(sourcePath, Buffer.alloc(1024, 7));
  const incoming = new FileTransferCoordinator({
    scheduleTimeout: fakeTimer,
    cancelTimeout: cancelTimer,
    removeTemporary: async () => undefined,
  });
  const outgoing = new OutgoingFileTransferCoordinator({
    scheduleTimeout: fakeTimer,
    cancelTimeout: cancelTimer,
    scheduleProgressTimeout: fakeTimer,
    cancelProgressTimeout: cancelTimer,
    blockSize: 256,
  });
  let incomingEvents = 0;
  let outgoingEvents = 0;
  incoming.onEvent(() => {
    incomingEvents += 1;
  });
  outgoing.onEvent(() => {
    outgoingEvents += 1;
  });
  if (global.gc) global.gc();
  const before = memory();
  const startedAt = process.hrtime.bigint();
  try {
    for (let index = 0; index < cycles; index += 1) {
      const accountId = `account-${index % 2}@example.invalid`;
      const transferId = `incoming-${index}`;
      incoming.add({
        offer: {
          transferId,
          accountId,
          senderJid: `sender-${index}@example.invalid`,
          name: 'source.bin',
          sizeBytes: '1024',
        },
        ownerSenderId: `owner-${index % 2}`,
      });
      await incoming.reject(transferId, 'user_rejected');
      await outgoing.start({
        filePath: sourcePath,
        siSessionId: `si-${index}`,
        ownerSenderId: `owner-${index % 2}`,
        offer: {
          transferId: `outgoing-${index}`,
          accountId,
          conversationId: `peer-${index}@example.invalid`,
          senderJid: accountId,
          recipientJid: `peer-${index}@example.invalid`,
          name: 'source.bin',
          sizeBytes: '0',
          transport: 'ibb',
          offeredAt: new Date().toISOString(),
        },
        transport: {
          sendOffer: async () => undefined,
          sendOpen: async () => undefined,
          sendData: async () => undefined,
          sendClose: async () => undefined,
        },
      });
    }
  } finally {
    await fsp.rm(root, { recursive: true, force: true });
  }
  if (global.gc) global.gc();
  const after = memory();
  const elapsedMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  process.stdout.write(
    `${JSON.stringify({ scenario: 'synthetic-transfer-cycles', cycles, elapsedMs, before, after, retained: { incomingRecords: incoming.records.size, outgoingRecords: outgoing.records.size, incomingEvents, outgoingEvents } })}\n`,
  );
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
