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

function fileHarness() {
  const handlers = new Map();
  let sent;
  const runtime = {
    xmpp: {
      sessions: new Map([['alice@example.test', {}]]),
      states: new Map([['alice@example.test', { status: 'connected' }]]),
      sendFile: async (_accountId, input) => {
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
    historySecurity: { authorize: () => true },
    selectFileSource: async () => null,
    helpers: {
      validVersion: (input) => input?.version === 1,
      requestId: (_event, input) => input?.requestId || 'generated',
      authorizeFileInput: () => undefined,
      fileResultError: resultError,
    },
  });
  return { handlers, getSent: () => sent };
}

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
