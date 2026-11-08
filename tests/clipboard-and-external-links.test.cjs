const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const { registerFileHandlers } = require('../electron/ipc-file-handlers.cjs');
const { registerExternalLinkHandlers, validateExternalUrl } = require('../electron/ipc-external-link-handlers.cjs');

function resultError(error, _event, input) {
  return {
    ok: false,
    version: 1,
    error: {
      code: error?.code || error?.message || 'INTERNAL',
      retryable: false,
      requestId: input?.requestId || 'generated',
      message: 'safe error',
    },
  };
}

function fileHarness(options = {}) {
  const handlers = new Map();
  let sent;
  const runtime = {
    xmpp: {
      sessions: new Map([['alice@example.test', {}]]),
      states: new Map([['alice@example.test', { status: 'connected' }]]),
      sendFile: async (_accountId, input) => {
        if (options.sendFile) return options.sendFile(input);
        sent = { ...input, bytes: await fsp.readFile(input.filePath) };
        return { transferId: 'clipboard-transfer' };
      },
    },
  };
  registerFileHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    assertSender: () => undefined,
    getRuntime: () => runtime,
    fileTransfers: {},
    outgoingFileTransfers: {},
    localFileActions: {},
    historySecurity: { authorize: options.authorize || (() => true) },
    selectFileSource: options.selectFileSource || (async () => null),
    helpers: {
      validVersion: (input) => input?.version === 1,
      requestId: (_event, input) => input?.requestId || 'generated',
      authorizeFileInput: () => undefined,
      fileResultError: resultError,
    },
  });
  return { handlers, runtime, getSent: () => sent };
}

const sendInput = {
  version: 1, requestId: 'one-intention', accountId: 'alice@example.test',
  conversationId: 'bob@example.test', fileName: 'capture.png',
  sizeBytes: 4, bytes: new Uint8Array([137, 80, 78, 71]), filePath: 'fixture.bin',
};

for (const [channel, source] of [
  ['file.send', undefined],
  ['file.sendDropped', 'preload-webutils-file-v1'],
  ['file.sendClipboard', 'preload-clipboard-file-v1'],
]) {
  test(`C5-INC-04 ${channel} replays pending and terminal requests; new intentions remain possible`, async () => {
    let calls = 0;
    let selections = 0;
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const harness = fileHarness({
      selectFileSource: async () => { selections += 1; return 'fixture.bin'; },
      sendFile: async () => { calls += 1; await gate; return { state: 'cancelled' }; },
    });
    const handler = harness.handlers.get(channel);
    const input = { ...sendInput, source };
    const event = { sender: { id: 7 } };
    const first = handler(event, input);
    const duplicate = handler(event, input);
    release();
    const results = await Promise.all([first, duplicate]);
    assert.deepEqual(results[0], results[1]);
    assert.equal(results[0].ok, true);
    assert.equal(calls, 1);
    assert.deepEqual(await handler(event, input), results[0]);
    assert.equal(calls, 1);
    if (channel === 'file.send') assert.equal(selections, 1);
    await handler(event, { ...input, requestId: 'deliberate-resend' });
    assert.equal(calls, 2);
    const conflict = await handler(event, { ...input, conversationId: 'other@example.test' });
    assert.equal(conflict.error.code, 'CONFLICT');
    assert.equal(calls, 2);
  });
}

test('C5-INC-04 replay checks authorization and preserves a failed result without retry', async () => {
  let authorized = true;
  let calls = 0;
  const harness = fileHarness({ authorize: () => authorized,
    sendFile: async () => { calls += 1; throw new Error('TIMEOUT'); } });
  const handler = harness.handlers.get('file.sendDropped');
  const input = { ...sendInput, source: 'preload-webutils-file-v1' };
  const event = { sender: { id: 7 } };
  const result = await handler(event, input);
  assert.equal(result.error.code, 'TIMEOUT');
  assert.deepEqual(await handler(event, input), result);
  authorized = false;
  assert.equal((await handler(event, input)).error.code, 'UNAUTHORIZED');
  assert.equal(calls, 1);
});

test('C5-INC-04 session replacement during source selection cannot send on the new session', async () => {
  let selected;
  const gate = new Promise((resolve) => { selected = resolve; });
  let calls = 0;
  const harness = fileHarness({ selectFileSource: () => gate,
    sendFile: async () => { calls += 1; } });
  const operation = harness.handlers.get('file.send')({ sender: { id: 7 } }, sendInput);
  harness.runtime.xmpp.sessions.set(sendInput.accountId, {});
  selected('fixture.bin');
  assert.equal((await operation).error.code, 'NOT_CONNECTED');
  assert.equal(calls, 0);
});

test('C5-INC-04 bounded IPC memory pins pending selections and evicts old terminal results', async () => {
  let selected;
  const gate = new Promise((resolve) => { selected = resolve; });
  let selections = 0;
  const harness = fileHarness({ selectFileSource: () => { selections += 1; return selections === 1 ? gate : null; } });
  const handler = harness.handlers.get('file.send');
  const event = { sender: { id: 7 } };
  const pending = handler(event, sendInput);
  await Promise.resolve();
  for (let index = 0; index < 260; index += 1)
    await handler(event, { ...sendInput, requestId: `terminal-${index}` });
  const duplicate = handler(event, sendInput);
  assert.equal(selections, 261);
  selected(null);
  await Promise.all([pending, duplicate]);
  await handler(event, { ...sendInput, requestId: 'terminal-259' });
  assert.equal(selections, 261);
  await handler(event, { ...sendInput, requestId: 'terminal-0' });
  assert.equal(selections, 262);
});

test('clipboard files reach the existing file transport and temporary bytes are removed', async () => {
  const value = fileHarness();
  const result = await value.handlers.get('file.sendClipboard')(
    { sender: { id: 7 } },
    {
      source: 'preload-clipboard-file-v1',
      version: 1,
      requestId: 'clipboard-1',
      accountId: 'alice@example.test',
      conversationId: 'bob@example.test',
      fileName: 'capture.png',
      mimeType: 'image/png',
      sizeBytes: 4,
      bytes: new Uint8Array([137, 80, 78, 71]),
    },
  );
  assert.equal(result.ok, true);
  const sent = value.getSent();
  assert.equal(sent.fileName, 'capture.png');
  assert.deepEqual([...sent.bytes], [137, 80, 78, 71]);
  assert.equal(fs.existsSync(sent.filePath), false);
});

test('external links accept only HTTP(S) URLs and open through the system shell', async () => {
  const handlers = new Map();
  const opened = [];
  registerExternalLinkHandlers({
    ipcMain: { handle: (channel, handler) => handlers.set(channel, handler) },
    assertSender: () => undefined,
    shell: { openExternal: async (url) => opened.push(url) },
    helpers: { validVersion: (input) => input?.version === 1, requestId: (_event, input) => input?.requestId || 'generated' },
  });
  const result = await handlers.get('externalLinks.open')(
    { sender: { id: 7 } },
    { version: 1, requestId: 'link-1', url: 'https://example.test/path' },
  );
  assert.equal(result.ok, true);
  assert.deepEqual(opened, ['https://example.test/path']);
  assert.throws(() => validateExternalUrl('javascript:alert(1)'), { message: 'INVALID_INPUT' });
});
