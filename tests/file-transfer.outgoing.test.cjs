const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { xml } = require('@xmpp/client');
const { OutgoingFileTransferCoordinator } = require('../electron/files/file-transfer-outgoing.cjs');
const { TransferResourceLimiter } = require('../electron/files/file-transfer-resources.cjs');
const { XmppAdapter } = require('../electron/xmpp/xmpp-adapter.cjs');

const SI = 'http://jabber.org/protocol/si';
const FILE = 'http://jabber.org/protocol/si/profile/file-transfer';
const FEATURE = 'http://jabber.org/protocol/feature-neg';
const FORM = 'jabber:x:data';
const IBB = 'http://jabber.org/protocol/ibb';
const DISCO = 'http://jabber.org/protocol/disco#info';
const STANZA = 'urn:ietf:params:xml:ns:xmpp-stanzas';
const ACCOUNT = 'atomic@example.invalid';
const RECIPIENT = 'spark@example.invalid/Spark';

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function realIqFixture(onRequest) {
  const context = adapterFixture();
  const session = require('@xmpp/client').client({
    service: 'xmpp://example.invalid',
    domain: 'example.invalid',
  });
  context.adapter.sessions.set(ACCOUNT, session);
  session.send = (request) => onRequest(request, session);
  return { ...context, session };
}

for (const [condition, expectedCode, endReason, application] of [
  ['forbidden', 'REMOTE_REJECTED', 'cancelled_by_receiver'],
  ['not-acceptable', 'UNSUPPORTED_METHOD', 'unsupported_method'],
  ['feature-not-implemented', 'UNSUPPORTED_METHOD', 'unsupported_method'],
  ['service-unavailable', 'UNSUPPORTED_METHOD', 'unsupported_method'],
  ['recipient-unavailable', 'RECIPIENT_UNAVAILABLE', 'network_lost'],
  ['remote-server-timeout', 'TIMEOUT', 'timed_out'],
  ['internal-server-error', 'TRANSPORT_FAILED', 'network_lost'],
  ['bad-request', 'UNSUPPORTED_METHOD', 'unsupported_method', 'no-valid-streams'],
  ['bad-request', 'UNSUPPORTED_METHOD', 'unsupported_method', 'bad-profile'],
]) {
  test(`C5-INC-03 real IQ caller classifies ${condition} without retry`, async () => {
    const { root, filePath } = await fixture();
    const sent = [];
    const { adapter, outgoing, session } = realIqFixture(async (request, client) => {
      sent.push(request);
      queueMicrotask(() =>
        client.emit(
          'element',
          xml(
            'iq',
            { type: 'error', id: request.attrs.id, from: RECIPIENT },
            xml(
              'error',
              { type: 'cancel' },
              xml(condition, { xmlns: STANZA }),
              ...(application ? [xml(application, { xmlns: SI })] : []),
            ),
          ),
        ),
      );
    });
    const states = [];
    outgoing.onEvent((event) => states.push(event.payload.state));
    let observedCode;
    try {
      const result = await outgoing.start({
        filePath,
        offer: offer(),
        siSessionId: 'real-errors',
        transport: {
          sendOffer: async (record) => {
            try {
              return await adapter.sendOutgoingOffer(ACCOUNT, session, 1, record);
            } catch (cause) {
              observedCode = cause.code;
              throw cause;
            }
          },
        },
      });
      assert.equal(observedCode, expectedCode);
      assert.equal(result.endReason, endReason);
      assert.deepEqual(states, ['offering', condition === 'forbidden' ? 'cancelled' : 'failed']);
      assert.equal(sent.length, 1);
      assert.equal(session.iqCaller.handlers.size, 0);
      assert.equal(outgoing.records.size, 0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
}

for (const mode of ['timeout', 'cancel', 'offline', 'disconnect', 'generation', 'pending-send']) {
  test(
    `C5-INC-01 ${mode} prevents a late SI acceptance from starting IBB`,
    { timeout: 2000 },
    async () => {
      const { root, filePath } = await fixture();
      const started = deferred();
      const sendGate = deferred();
      const sent = [];
      const { adapter, outgoing, session } = realIqFixture((request) => {
        sent.push(request);
        started.resolve(request);
        return mode === 'pending-send' ? sendGate.promise : Promise.resolve();
      });
      const limiter = new TransferResourceLimiter();
      outgoing.resourceLimiter = limiter;
      const timers = new Set();
      outgoing.scheduleTimeout = (callback) => {
        timers.add(callback);
        return callback;
      };
      outgoing.cancelTimeout = (callback) => timers.delete(callback);
      const states = [];
      session.stop = async () => undefined;
      outgoing.onEvent((event) => states.push(event.payload.state));
      const operation = outgoing.start({
        filePath,
        offer: offer(),
        siSessionId: 'late-si',
        transport: {
          sendOffer: (record) => adapter.sendOutgoingOffer(ACCOUNT, session, 1, record),
          sendOpen: () => assert.fail('late SI must not open IBB'),
        },
      });
      try {
        const request = await started.promise;
        const record = outgoing.get('file-test');
        if (mode === 'timeout') [...timers][0]();
        else if (mode === 'offline') adapter.handleSessionEvent(ACCOUNT, session, 'offline');
        else if (mode === 'disconnect') {
          // An incoming cleanup must not delay termination of the outgoing request.
          adapter.fileTransfers = { cancelAccount: () => sendGate.promise };
          const disconnect = adapter.disconnect(ACCOUNT);
          await operation;
          sendGate.resolve();
          await disconnect;
        } else if (mode === 'generation') adapter.sessionGenerations.set(ACCOUNT, 2);
        else await outgoing.cancel('file-test');
        if (mode !== 'generation') {
          await operation;
          assert.equal(session.iqCaller.handlers.size, 0);
        }
        session.emit(
          'element',
          xml(
            'iq',
            { type: 'result', id: request.attrs.id, from: RECIPIENT },
            xml(
              'si',
              { xmlns: SI },
              xml(
                'feature',
                { xmlns: FEATURE },
                xml(
                  'x',
                  { xmlns: FORM, type: 'submit' },
                  xml('field', { var: 'stream-method' }, xml('value', {}, IBB)),
                ),
              ),
            ),
          ),
        );
        sendGate.resolve();
        const result = await operation;
        await new Promise((resolve) => setImmediate(resolve));
        assert.equal(
          result.endReason,
          mode === 'timeout'
            ? 'timed_out'
            : ['offline', 'disconnect', 'generation'].includes(mode)
              ? 'network_lost'
              : 'cancelled_by_sender',
        );
        assert.equal(states.length, 2);
        assert.equal(sent.length, 1);
        assert.equal(outgoing.records.size, 0);
        assert.equal(record.handle, undefined);
        assert.equal(record.transport, undefined);
        assert.equal(timers.size, 0);
        assert.equal(limiter.counts(ACCOUNT).global, 0);
      } finally {
        sendGate.resolve();
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  );
}

test('C5-INC-01 installed IQ TimeoutError maps to timed_out and retires its handler', async () => {
  const { adapter, session } = realIqFixture(async () => undefined);
  const record = { offer: offer(), timeoutSeconds: 0.001, abortController: new AbortController() };
  await assert.rejects(
    adapter.requestOutgoingIq(ACCOUNT, session, 1, record, xml('si', { xmlns: SI }), 'si'),
    (cause) => cause.code === 'TIMEOUT' && cause.cause?.name === 'TimeoutError',
  );
  assert.equal(session.iqCaller.handlers.size, 0);
});

for (const phase of ['si', 'open', 'data', 'close']) {
  for (const mode of ['cancel', 'timeout']) {
    test(
      `C5-INC-05 ${mode} during ${phase} preserves local terminality and phase-correct stanzas`,
      { timeout: 2000 },
      async () => {
        const { root, filePath } = await fixture(Buffer.from('abcdef'));
        const started = deferred();
        const sent = [];
        const timers = new Set();
        const { adapter, outgoing, session } = realIqFixture(async (request, client) => {
          sent.push(request);
          if (request.name === 'message') return;
          const name = request.children[0].name;
          if (name === phase) {
            started.resolve(request);
            return;
          }
          const children =
            name === 'si'
              ? [
                  xml(
                    'si',
                    { xmlns: SI },
                    xml(
                      'feature',
                      { xmlns: FEATURE },
                      xml(
                        'x',
                        { xmlns: FORM, type: 'submit' },
                        xml('field', { var: 'stream-method' }, xml('value', {}, IBB)),
                      ),
                    ),
                  ),
                ]
              : [];
          queueMicrotask(() =>
            client.emit(
              'element',
              xml('iq', { type: 'result', id: request.attrs.id, from: RECIPIENT }, ...children),
            ),
          );
        });
        const limiter = new TransferResourceLimiter();
        outgoing.resourceLimiter = limiter;
        outgoing.scheduleTimeout = (callback) => {
          timers.add(callback);
          return callback;
        };
        outgoing.cancelTimeout = (callback) => timers.delete(callback);
        const states = [];
        outgoing.onEvent((event) => states.push(event.payload.state));
        const operation = outgoing.start({
          filePath,
          offer: offer(),
          siSessionId: 'ibb-cancel',
          transport: {
            sendOffer: (record) => adapter.sendOutgoingOffer(ACCOUNT, session, 1, record),
            sendCancellationNotice: (record, reason) =>
              adapter.sendOutgoingCancellationNotice(ACCOUNT, session, 1, record, reason),
            sendOpen: (record, blockSize) =>
              adapter.sendOutgoingOpen(ACCOUNT, session, 1, record, blockSize),
            sendData: (record, block, sequence) =>
              adapter.sendOutgoingData(ACCOUNT, session, 1, record, block, sequence),
            sendClose: (record, options) =>
              adapter.sendOutgoingClose(ACCOUNT, session, 1, record, options),
          },
        });
        try {
          const request = await started.promise;
          const record = outgoing.get('file-test');
          assert.equal(record.activePhase, phase);
          assert.equal(record.ibbOpened, ['data', 'close'].includes(phase));
          if (mode === 'cancel') {
            await Promise.all([outgoing.cancel('file-test'), outgoing.cancel('file-test')]);
          } else {
            [...timers][0]();
          }
          const result = await operation;
          const terminal = mode === 'cancel' ? 'cancelled' : 'failed';
          assert.equal(result.state, terminal);
          assert.equal(result.endReason, mode === 'cancel' ? 'cancelled_by_sender' : 'timed_out');
          assert.equal(outgoing.markTerminal(record, 'cancelled_by_sender'), false);
          assert.equal(outgoing.records.size, 0);
          await new Promise((resolve) => setImmediate(resolve));
          assert.equal(session.iqCaller.handlers.size, 0);
          const children =
            phase === 'si'
              ? [
                  xml(
                    'si',
                    { xmlns: SI },
                    xml(
                      'feature',
                      { xmlns: FEATURE },
                      xml(
                        'x',
                        { xmlns: FORM, type: 'submit' },
                        xml('field', { var: 'stream-method' }, xml('value', {}, IBB)),
                      ),
                    ),
                  ),
                ]
              : [];
          session.emit(
            'element',
            xml('iq', { type: 'result', id: request.attrs.id, from: RECIPIENT }, ...children),
          );
          await new Promise((resolve) => setImmediate(resolve));
          const iqs = sent.filter((item) => item.name === 'iq');
          assert.deepEqual(
            iqs.map((item) => item.children[0].name),
            phase === 'si'
              ? ['si']
              : phase === 'open'
                ? ['si', 'open']
                : phase === 'data'
                  ? ['si', 'open', 'data', 'close']
                  : ['si', 'open', 'data', 'data', 'close'],
          );
          assert.ok(
            iqs.every((item) => item.attrs.type === 'set' && item.attrs.from === undefined),
          );
          const notices = sent.filter((item) => item.name === 'message');
          assert.equal(notices.length, phase === 'si' ? 1 : 0);
          if (notices.length)
            assert.match(notices[0].getChildText('body'), /localmente.*no confirma su cierre/);
          assert.equal(states.filter((state) => state === terminal).length, 1);
          assert.equal(states.at(-1), terminal);
          assert.equal(record.handle, undefined);
          assert.equal(record.transport, undefined);
          assert.equal(timers.size, 0);
          assert.equal(limiter.counts(ACCOUNT).global, 0);
        } finally {
          await fs.rm(root, { recursive: true, force: true });
        }
      },
    );
  }
}

test('C5-INC-01 data acknowledgement timeout closes an already open IBB stream', async () => {
  const { root, filePath } = await fixture(Buffer.from('abcdef'));
  const dataStarted = deferred();
  const cleanupStarted = deferred();
  const sent = [];
  const activeTimers = new Set();
  const { adapter, outgoing, session } = realIqFixture(async (request, client) => {
    sent.push(request);
    const name = request.children[0].name;
    if (name === 'data') {
      dataStarted.resolve();
      return;
    }
    if (name === 'close') cleanupStarted.resolve();
    const children =
      name === 'si'
        ? [
            xml(
              'si',
              { xmlns: SI },
              xml(
                'feature',
                { xmlns: FEATURE },
                xml(
                  'x',
                  { xmlns: FORM, type: 'submit' },
                  xml('field', { var: 'stream-method' }, xml('value', {}, IBB)),
                ),
              ),
            ),
          ]
        : [];
    queueMicrotask(() =>
      client.emit(
        'element',
        xml('iq', { type: 'result', id: request.attrs.id, from: RECIPIENT }, ...children),
      ),
    );
  });
  outgoing.scheduleTimeout = (callback) => {
    const timer = { callback };
    activeTimers.add(timer);
    return timer;
  };
  outgoing.cancelTimeout = (timer) => activeTimers.delete(timer);
  const operation = outgoing.start({
    filePath,
    offer: offer(),
    siSessionId: 'timeout-close',
    transport: {
      sendOffer: (record) => adapter.sendOutgoingOffer(ACCOUNT, session, 1, record),
      sendOpen: (record, blockSize) =>
        adapter.sendOutgoingOpen(ACCOUNT, session, 1, record, blockSize),
      sendData: (record, block, sequence) =>
        adapter.sendOutgoingData(ACCOUNT, session, 1, record, block, sequence),
      sendClose: (record, options) =>
        adapter.sendOutgoingClose(ACCOUNT, session, 1, record, options),
    },
  });
  try {
    await dataStarted.promise;
    [...activeTimers][0].callback();
    const result = await operation;
    assert.equal(result.state, 'failed');
    assert.equal(result.endReason, 'timed_out');
    await cleanupStarted.promise;
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(
      sent.map((request) => request.children[0].name),
      ['si', 'open', 'data', 'close'],
    );
    assert.equal(session.iqCaller.handlers.size, 0);
    assert.equal(outgoing.records.size, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('C5-INC-04 repeated IPC intention produces one actual SI offer and one completion', async () => {
  const { root, filePath } = await fixture();
  const { adapter, outgoing, sent } = adapterFixture();
  const handlers = new Map();
  const states = [];
  outgoing.onEvent((event) => states.push(event.payload.state));
  require('../electron/ipc/ipc-file-handlers.cjs').registerFileHandlers({
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    assertSender: () => undefined,
    getRuntime: () => ({ xmpp: adapter }),
    historySecurity: { authorize: () => true },
    helpers: {
      validVersion: (input) => input?.version === 1,
      fileResultError: (error) => {
        throw error;
      },
    },
  });
  const input = {
    version: 1,
    requestId: 'one-paste',
    accountId: ACCOUNT,
    conversationId: 'spark@example.invalid',
    source: 'preload-webutils-file-v1',
    filePath,
  };
  const invoke = (request) => handlers.get('file.sendDropped')({ sender: { id: 42 } }, request);
  try {
    const results = await Promise.all([invoke(input), invoke(input)]);
    assert.equal(results[0].value.offer.transferId, results[1].value.offer.transferId);
    assert.deepEqual(await invoke(input), results[0]);
    assert.equal(sent.filter((request) => request.children[0].name === 'si').length, 1);
    assert.equal(states.filter((state) => state === 'completed').length, 1);
    const resend = await invoke({ ...input, requestId: 'manual-resend' });
    assert.notEqual(resend.value.offer.transferId, results[0].value.offer.transferId);
    assert.equal(sent.filter((request) => request.children[0].name === 'si').length, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('C5-INC-01 unrelated SI fields cannot authorize an IBB stream', async () => {
  const { root, filePath } = await fixture();
  const { adapter, outgoing, session } = realIqFixture(async (request, client) => {
    queueMicrotask(() =>
      client.emit(
        'element',
        xml(
          'iq',
          { type: 'result', id: request.attrs.id, from: RECIPIENT },
          xml(
            'si',
            { xmlns: SI },
            xml(
              'feature',
              { xmlns: FEATURE },
              xml(
                'x',
                { xmlns: FORM, type: 'submit' },
                xml('field', { var: 'unrelated-field' }, xml('value', {}, IBB)),
              ),
            ),
          ),
        ),
      ),
    );
  });
  try {
    const result = await outgoing.start({
      filePath,
      offer: offer(),
      siSessionId: 'invalid-si',
      transport: {
        sendOffer: (record) => adapter.sendOutgoingOffer(ACCOUNT, session, 1, record),
        sendOpen: () => assert.fail('invalid SI cannot open IBB'),
      },
    });
    assert.equal(result.endReason, 'unsupported_method');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function fixture(contents = Buffer.from('Atomic Spark fixture')) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'atomic-file-out-'));
  const filePath = path.join(root, 'fixture.bin');
  await fs.writeFile(filePath, contents);
  return { root, filePath };
}

function offer(transferId = 'file-test') {
  return {
    transferId,
    accountId: ACCOUNT,
    conversationId: 'spark@example.invalid',
    senderJid: ACCOUNT,
    recipientJid: RECIPIENT,
    name: 'fixture.bin',
    sizeBytes: '0',
    transport: 'ibb',
    offeredAt: new Date(0).toISOString(),
  };
}

async function startSimple(coordinator, filePath, calls = {}) {
  return coordinator.start({
    filePath,
    offer: offer(calls.transferId),
    ownerSenderId: 42,
    siSessionId: `si_${calls.transferId || 'test'}`,
    transport: {
      sendOffer: async (record) => {
        calls.offer = record;
      },
      sendOpen: async (record, blockSize) => {
        calls.open = { record, blockSize };
      },
      sendData: async (record, block, sequence) => {
        (calls.data ||= []).push({ record, block: Buffer.from(block), sequence });
      },
      sendClose: async (record) => {
        calls.close = record;
      },
    },
  });
}

test('C5-OUT-01 cancelled source selection never opens a transfer', async () => {
  const coordinator = new OutgoingFileTransferCoordinator();
  await assert.rejects(
    coordinator.start({
      filePath: '',
      offer: offer(),
      ownerSenderId: 1,
      siSessionId: 'si-cancel',
      transport: { sendOffer: () => assert.fail('offer must not be sent') },
    }),
    { code: 'INVALID_INPUT' },
  );
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
    assert.deepEqual(
      calls.data.map(({ block, sequence }) => [block.toString(), sequence]),
      [
        ['ab', 0],
        ['cd', 1],
        ['ef', 2],
      ],
    );
    assert.equal(coordinator.records.size, 0);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('C5-OUT-03 controlled progress is coalesced while terminal bytes remain exact', async () => {
  const { root, filePath } = await fixture(Buffer.from('123'));
  const timers = [];
  let clock = 0;
  const events = [];
  try {
    const coordinator = new OutgoingFileTransferCoordinator({
      blockSize: 1,
      now: () => clock,
      scheduleProgressTimeout: (callback, delay) => {
        const timer = { callback, delay, cancelled: false };
        timers.push(timer);
        return timer;
      },
      cancelProgressTimeout: (timer) => {
        timer.cancelled = true;
      },
    });
    coordinator.onEvent((event) => events.push(event.payload));
    await coordinator.start({
      filePath,
      offer: offer('file-progress'),
      ownerSenderId: 7,
      siSessionId: 'si-progress',
      transport: {
        sendOffer: async () => undefined,
        sendOpen: async () => undefined,
        sendData: async (_record, block, sequence) => {
          if (sequence === 1) {
            clock = 100;
            timers.shift()?.callback();
          }
          assert.equal(block.length, 1);
        },
        sendClose: async () => undefined,
      },
    });
    const progress = events.filter((event) => event.state === 'transferring');
    assert.ok(progress.length <= 4);
    assert.equal(events.at(-1).state, 'completed');
    assert.equal(events.at(-1).bytesTransferred, '3');
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('C5-OUT-04 sequence wraps at 65535 without changing block order', async () => {
  const { root, filePath } = await fixture(Buffer.from('xy'));
  try {
    const coordinator = new OutgoingFileTransferCoordinator({
      blockSize: 1,
      initialSequence: 65535,
    });
    const calls = {};
    await startSimple(coordinator, filePath, { ...calls, transferId: 'file-wrap' });
    const observed = [];
    const wrapped = new OutgoingFileTransferCoordinator({ blockSize: 1, initialSequence: 65535 });
    await wrapped.start({
      filePath,
      offer: offer('file-wrap-2'),
      ownerSenderId: 1,
      siSessionId: 'si-wrap',
      transport: {
        sendOffer: async () => undefined,
        sendOpen: async () => undefined,
        sendData: async (_record, block, sequence) => observed.push([block.toString(), sequence]),
        sendClose: async () => undefined,
      },
    });
    assert.deepEqual(observed, [
      ['x', 65535],
      ['y', 0],
    ]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('C5-OUT-05 remote rejection and source mutation fail safely and release resources', async () => {
  const rejected = await fixture(Buffer.from('reject'));
  const changed = await fixture(Buffer.from('stable'));
  let closeCount = 0;
  try {
    const rejector = new OutgoingFileTransferCoordinator();
    const rejectedResult = await rejector.start({
      filePath: rejected.filePath,
      offer: offer('file-rejected'),
      ownerSenderId: 1,
      siSessionId: 'si-rejected',
      transport: {
        sendOffer: async () => {
          const error = new Error('rejected');
          error.code = 'REMOTE_REJECTED';
          throw error;
        },
      },
    });
    assert.equal(rejectedResult.state, 'cancelled');
    assert.equal(rejectedResult.endReason, 'cancelled_by_receiver');
    assert.equal(rejector.records.size, 0);
    const mutator = new OutgoingFileTransferCoordinator({ blockSize: 6 });
    const result = await mutator.start({
      filePath: changed.filePath,
      offer: offer('file-mutated'),
      ownerSenderId: 1,
      siSessionId: 'si-mutated',
      transport: {
        sendOffer: async () => undefined,
        sendOpen: async () => undefined,
        sendData: async () => {
          await fs.appendFile(changed.filePath, Buffer.from('!'));
        },
        sendClose: async () => {
          closeCount += 1;
        },
      },
    });
    assert.equal(result.state, 'failed');
    assert.equal(result.endReason, 'integrity_failed');
    assert.equal(mutator.records.size, 0);
    assert.equal(closeCount, 1);
  } finally {
    await fs.rm(rejected.root, { recursive: true, force: true });
    await fs.rm(changed.root, { recursive: true, force: true });
  }
});

test('Outgoing file transfer robustness: SI timeout is terminal and releases the source handle', async () => {
  const { root, filePath } = await fixture(Buffer.from('timeout'));
  let timeoutNoticeCount = 0;
  try {
    const coordinator = new OutgoingFileTransferCoordinator({
      siTimeout: 5,
      scheduleTimeout: (callback, delay) => {
        const timer = setTimeout(callback, delay);
        return { timer, unref: () => undefined };
      },
      cancelTimeout: ({ timer }) => clearTimeout(timer),
    });
    const result = await coordinator.start({
      filePath,
      offer: offer('file-timeout'),
      ownerSenderId: 1,
      siSessionId: 'si-timeout',
      transport: {
        sendOffer: async () => new Promise(() => undefined),
        sendCancellationNotice: async () => {
          timeoutNoticeCount += 1;
        },
      },
    });
    assert.equal(result.state, 'failed');
    assert.equal(result.endReason, 'timed_out');
    assert.equal(coordinator.records.size, 0);
    assert.equal(timeoutNoticeCount, 1);
    await fs.rm(filePath);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Outgoing file transfer robustness: cancellation releases resources without waiting for a deferred data ACK', async () => {
  const { root, filePath } = await fixture(Buffer.from('cancel'));
  let releaseData;
  let dataStarted = false;
  let closeCount = 0;
  try {
    const coordinator = new OutgoingFileTransferCoordinator({ iqTimeout: 1000 });
    const startPromise = coordinator.start({
      filePath,
      offer: offer('file-cancel'),
      ownerSenderId: 1,
      siSessionId: 'si-cancel',
      transport: {
        sendOffer: async () => undefined,
        sendOpen: async () => undefined,
        sendData: async () => {
          dataStarted = true;
          await new Promise((resolve) => {
            releaseData = resolve;
          });
        },
        sendClose: async () => {
          closeCount += 1;
        },
      },
    });
    for (let index = 0; index < 100 && !dataStarted; index += 1)
      await new Promise((resolve) => setTimeout(resolve, 1));
    assert.equal(dataStarted, true);
    const cancelPromise = coordinator.cancel('file-cancel');
    assert.equal(coordinator.get('file-cancel').state, 'cancelled');
    const result = await cancelPromise;
    await startPromise;
    assert.equal(result.endReason, 'cancelled_by_sender');
    assert.equal(coordinator.records.size, 0);
    releaseData();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closeCount, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Outgoing file transfer robustness: one shared limiter bounds account and global active transfers', () => {
  const limiter = new TransferResourceLimiter();
  limiter.reserve('a1', ACCOUNT, 'outgoing');
  limiter.reserve('a2', ACCOUNT, 'incoming');
  assert.throws(() => limiter.reserve('a3', ACCOUNT, 'outgoing'), { code: 'RESOURCE_CONSTRAINT' });
  limiter.reserve('b1', 'other@example.invalid', 'outgoing');
  limiter.reserve('c1', 'third@example.invalid', 'outgoing');
  assert.deepEqual(limiter.counts(ACCOUNT), { account: 2, global: 4 });
  limiter.release('a1');
  assert.deepEqual(limiter.counts(ACCOUNT), { account: 1, global: 3 });
});

function streamMethodsFromOffer(si) {
  const field = si
    .getChild('feature', FEATURE)
    ?.getChild('x', FORM)
    ?.getChildren('field')
    .find((candidate) => candidate.attrs.var === 'stream-method');
  return (
    field
      ?.getChildren('option')
      .flatMap((option) => option.getChildren('value').map((value) => value.getText())) || []
  );
}

function smackAcceptsOffer(si) {
  const feature = si.getChild('feature', FEATURE);
  const form = feature?.getChild('x', FORM);
  const field = form
    ?.getChildren('field')
    .find((candidate) => candidate.attrs.var === 'stream-method');
  const options = field?.getChildren('option') || [];
  return (
    form?.attrs.type === 'form' &&
    field?.attrs.type === 'list-single' &&
    options.length > 0 &&
    options.every((option) => option.getChildren('value').length === 1) &&
    streamMethodsFromOffer(si).includes(IBB)
  );
}

function adapterFixture({
  wrongDiscoFrom = false,
  unsupported = false,
  staleAfterDisco = false,
  timeoutSeconds,
} = {}) {
  const outgoing = new OutgoingFileTransferCoordinator({
    blockSize: 3,
    onCompleted: async () => true,
    ...(timeoutSeconds ? { getTimeoutSeconds: () => timeoutSeconds } : {}),
  });
  const adapter = new XmppAdapter(false, null, [], null, outgoing);
  const sent = [];
  const sentMessages = [];
  const timeouts = [];
  const session = {
    send: async (message) => sentMessages.push(message),
    iqCaller: {
      request: async (request, timeout) => {
        sent.push(request);
        const child = request.children[0];
        timeouts.push({ name: child.name, timeout });
        if (child.name === 'query' && child.attrs.xmlns === DISCO) {
          const features = unsupported
            ? []
            : [
                xml('feature', { var: SI }),
                xml('feature', { var: FILE }),
                xml('feature', { var: IBB }),
              ];
          const response = xml(
            'iq',
            {
              type: 'result',
              id: request.attrs.id,
              from: wrongDiscoFrom ? 'other@example.invalid/Spark' : RECIPIENT,
            },
            xml('query', { xmlns: DISCO }, ...features),
          );
          if (staleAfterDisco) adapter.sessionGenerations.set(ACCOUNT, 2);
          return response;
        }
        if (child.name === 'si') {
          if (!smackAcceptsOffer(child))
            return xml(
              'iq',
              { type: 'error', id: request.attrs.id, from: RECIPIENT },
              xml('error', { type: 'cancel' }, xml('not-acceptable', { xmlns: STANZA })),
            );
          return xml(
            'iq',
            { type: 'result', id: request.attrs.id, from: RECIPIENT },
            xml(
              'si',
              { xmlns: SI, id: child.attrs.id },
              xml(
                'feature',
                { xmlns: FEATURE },
                xml(
                  'x',
                  { xmlns: FORM, type: 'submit' },
                  xml('field', { var: 'stream-method' }, xml('value', {}, IBB)),
                ),
              ),
            ),
          );
        }
        return xml('iq', { type: 'result', id: request.attrs.id, from: RECIPIENT });
      },
    },
  };
  adapter.sessions.set(ACCOUNT, session);
  adapter.states.set(ACCOUNT, { status: 'connected' });
  adapter.sessionGenerations.set(ACCOUNT, 1);
  adapter.sessionDomains.set(ACCOUNT, 'example.invalid');
  adapter.rosters.set(
    ACCOUNT,
    new Map([['spark@example.invalid', { jid: 'spark@example.invalid', subscription: 'to' }]]),
  );
  adapter.remoteResources.set(ACCOUNT, new Map([[RECIPIENT, { presence: 'available' }]]));
  return { adapter, outgoing, sent, sentMessages, timeouts, session };
}

test('C5-OUT-14 SI cancellation notifies the offered resource and includes the Atomic Chat cancel marker', async () => {
  const { adapter, session, sentMessages } = adapterFixture();
  const record = {
    offer: { name: 'bg-dev.png', recipientJid: RECIPIENT },
    siSessionId: 'si-timeout',
  };
  await Promise.all([
    adapter.sendOutgoingCancellationNotice(ACCOUNT, session, 1, record, 'timed_out'),
    adapter.sendOutgoingCancellationNotice(ACCOUNT, session, 1, record, 'cancelled_by_sender'),
  ]);
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].name, 'message');
  assert.equal(sentMessages[0].attrs.type, 'chat');
  assert.equal(sentMessages[0].attrs.to, RECIPIENT);
  assert.match(sentMessages[0].getChildText('body'), /bg-dev\.png.*venció el tiempo de espera/);
  assert.equal(
    sentMessages[0].getChild('cancel', 'urn:atomic-chat:file-transfer:1')?.attrs.sid,
    'si-timeout',
  );
  assert.match(sentMessages[0].getChildText('body'), /localmente.*no confirma su cierre/);
});

test('C5-INC-05 a failed informational notice is not retried', async () => {
  const { adapter, session } = adapterFixture();
  const record = { offer: offer(), siSessionId: 'failed-notice' };
  let attempts = 0;
  session.send = async () => {
    attempts += 1;
    throw new Error('synthetic send failure');
  };
  await assert.rejects(
    adapter.sendOutgoingCancellationNotice(ACCOUNT, session, 1, record, 'timed_out'),
  );
  await adapter.sendOutgoingCancellationNotice(ACCOUNT, session, 1, record, 'cancelled_by_sender');
  assert.equal(attempts, 1);
});

test('C5-INC-05 only an open IBB can use a live cleanup signal after terminality', async () => {
  const { adapter, session, sent } = adapterFixture();
  const record = {
    offer: offer(),
    siSessionId: 'guarded-close',
    terminalRequested: true,
    ibbOpened: false,
    abortController: new AbortController(),
  };
  const controller = new AbortController();
  await assert.rejects(
    adapter.sendOutgoingClose(ACCOUNT, session, 1, record, { signal: controller.signal }),
    { code: 'CANCELLED' },
  );
  record.terminalRequested = false;
  await assert.rejects(adapter.sendOutgoingClose(ACCOUNT, session, 1, record), {
    code: 'CONFLICT',
  });
  record.terminalRequested = true;
  record.ibbOpened = true;
  await assert.rejects(
    adapter.requestOutgoingIq(
      ACCOUNT,
      session,
      1,
      record,
      xml('data', { xmlns: IBB }),
      'data',
      controller.signal,
    ),
    { code: 'CANCELLED' },
  );
  controller.abort();
  await assert.rejects(
    adapter.sendOutgoingClose(ACCOUNT, session, 1, record, { signal: controller.signal }),
    { code: 'CANCELLED' },
  );
  assert.equal(sent.length, 0);
});

test(
  'C5-INC-05 an unanswered abort close expires independently and never reactivates the transfer',
  { timeout: 2000 },
  async () => {
    const { root, filePath } = await fixture();
    const dataStarted = deferred();
    const closeStarted = deferred();
    const sent = [];
    const timers = new Set();
    const { adapter, outgoing, session } = realIqFixture(async (request, client) => {
      sent.push(request);
      const name = request.children[0].name;
      if (name === 'data') {
        dataStarted.resolve();
        return;
      }
      if (name === 'close') {
        closeStarted.resolve(request);
        return;
      }
      const children =
        name === 'si'
          ? [
              xml(
                'si',
                { xmlns: SI },
                xml(
                  'feature',
                  { xmlns: FEATURE },
                  xml(
                    'x',
                    { xmlns: FORM, type: 'submit' },
                    xml('field', { var: 'stream-method' }, xml('value', {}, IBB)),
                  ),
                ),
              ),
            ]
          : [];
      queueMicrotask(() =>
        client.emit(
          'element',
          xml('iq', { type: 'result', id: request.attrs.id, from: RECIPIENT }, ...children),
        ),
      );
    });
    outgoing.scheduleTimeout = (callback) => {
      timers.add(callback);
      return callback;
    };
    outgoing.cancelTimeout = (callback) => timers.delete(callback);
    const operation = outgoing.start({
      filePath,
      offer: offer(),
      siSessionId: 'unanswered-close',
      transport: {
        sendOffer: (record) => adapter.sendOutgoingOffer(ACCOUNT, session, 1, record),
        sendOpen: (record, blockSize) =>
          adapter.sendOutgoingOpen(ACCOUNT, session, 1, record, blockSize),
        sendData: (record, block, sequence) =>
          adapter.sendOutgoingData(ACCOUNT, session, 1, record, block, sequence),
        sendClose: (record, options) =>
          adapter.sendOutgoingClose(ACCOUNT, session, 1, record, options),
      },
    });
    try {
      await dataStarted.promise;
      const record = outgoing.get('file-test');
      await outgoing.cancel('file-test');
      assert.equal((await operation).state, 'cancelled');
      const close = await closeStarted.promise;
      outgoing.closeAbortedStream(record);
      assert.equal(record.handle, undefined);
      assert.equal(outgoing.records.size, 0);
      assert.equal(session.iqCaller.handlers.size, 1);
      assert.equal(timers.size, 1);
      [...timers][0]();
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(session.iqCaller.handlers.size, 0);
      assert.equal(timers.size, 0);
      session.emit('element', xml('iq', { type: 'result', id: close.attrs.id, from: RECIPIENT }));
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(record.state, 'cancelled');
      assert.deepEqual(
        sent.map((item) => item.children[0].name),
        ['si', 'open', 'data', 'close'],
      );
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  },
);

test('Outgoing file transfer robustness: Spark-compatible receiver validates SI options before open, data and close', async () => {
  const { root, filePath } = await fixture(Buffer.from('hello'));
  const { adapter, outgoing, sent } = adapterFixture();
  const states = [];
  outgoing.onEvent((event) => states.push(event.payload.state));
  try {
    const result = await adapter.sendFile(ACCOUNT, {
      filePath,
      fileName: 'fixture.bin',
      conversationId: 'spark@example.invalid',
      ownerSenderId: 42,
    });
    assert.equal(result.state, 'completed');
    assert.equal(result.bytesTransferred, '5');
    assert.deepEqual(result.localActions, { open: true, reveal: true });
    assert.deepEqual(
      sent.map((iq) => iq.children[0].name),
      ['query', 'si', 'open', 'data', 'data', 'close'],
    );
    const si = sent[1].children[0];
    assert.equal(si.getChild('feature', FEATURE)?.getChild('x', FORM)?.attrs.type, 'form');
    const field = si
      .getChild('feature', FEATURE)
      ?.getChild('x', FORM)
      ?.getChildren('field')
      .find((candidate) => candidate.attrs.var === 'stream-method');
    assert.equal(field?.attrs.type, 'list-single');
    assert.equal(field?.getChildren('option').length, 1);
    assert.deepEqual(streamMethodsFromOffer(si), [IBB]);
    assert.equal(
      streamMethodsFromOffer(si).includes('http://jabber.org/protocol/bytestreams'),
      false,
    );
    assert.notEqual(si.attrs.id, result.offer.transferId);
    assert.equal(sent[2].children[0].attrs.sid, si.attrs.id);
    assert.deepEqual(states, ['offering', 'accepted', 'transferring', 'completed']);
    assert.deepEqual(
      sent
        .filter((iq) => iq.children[0].name === 'data')
        .map((iq) => [
          iq.children[0].attrs.seq,
          Buffer.from(iq.children[0].getText(), 'base64').toString(),
        ]),
      [
        ['0', 'hel'],
        ['1', 'lo'],
      ],
    );
    assert.equal(
      sent.every((iq) => iq.attrs.to === undefined || iq.attrs.to === RECIPIENT),
      true,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('C5-OUT-13 passes the configured timeout to the XMPP IQ caller', async () => {
  const { root, filePath } = await fixture(Buffer.from('hello'));
  const { adapter, timeouts } = adapterFixture({ timeoutSeconds: 600 });
  try {
    await adapter.sendFile(ACCOUNT, {
      filePath,
      fileName: 'fixture.bin',
      conversationId: 'spark@example.invalid',
      ownerSenderId: 42,
    });
    const fileIqTimeouts = timeouts
      .filter(({ name }) => ['si', 'open', 'data', 'close'].includes(name))
      .map(({ timeout }) => timeout);
    assert.ok(fileIqTimeouts.length > 0);
    assert.ok(fileIqTimeouts.every((timeout) => timeout === 600000));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Outgoing file transfer robustness: Smack-style inspection rejects a direct field value without an option', () => {
  const malformed = xml(
    'si',
    { xmlns: SI, id: 'si-malformed', profile: FILE },
    xml(
      'feature',
      { xmlns: FEATURE },
      xml(
        'x',
        { xmlns: FORM, type: 'form' },
        xml('field', { var: 'stream-method', type: 'list-single' }, xml('value', {}, IBB)),
      ),
    ),
  );
  assert.equal(smackAcceptsOffer(malformed), false);
});

test('Outgoing file transfer robustness: stale or incapable Spark resources are rejected before source transfer', async () => {
  const { root, filePath } = await fixture(Buffer.from('hello'));
  try {
    await assert.rejects(
      adapterFixture({ wrongDiscoFrom: true }).adapter.sendFile(ACCOUNT, {
        filePath,
        fileName: 'fixture.bin',
        conversationId: 'spark@example.invalid',
        ownerSenderId: 42,
      }),
      { code: 'RECIPIENT_UNAVAILABLE' },
    );
    await assert.rejects(
      adapterFixture({ unsupported: true }).adapter.sendFile(ACCOUNT, {
        filePath,
        fileName: 'fixture.bin',
        conversationId: 'spark@example.invalid',
        ownerSenderId: 42,
      }),
      { code: 'UNSUPPORTED_METHOD' },
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('Outgoing file transfer robustness: a new connection generation aborts before SI and IBB IQs', async () => {
  const { root, filePath } = await fixture(Buffer.from('hello'));
  const { adapter, sent } = adapterFixture({ staleAfterDisco: true });
  try {
    await assert.rejects(
      adapter.sendFile(ACCOUNT, {
        filePath,
        fileName: 'fixture.bin',
        conversationId: 'spark@example.invalid',
        ownerSenderId: 42,
      }),
      { code: 'NOT_CONNECTED' },
    );
    assert.deepEqual(
      sent.map((iq) => iq.children[0].name),
      ['query'],
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
