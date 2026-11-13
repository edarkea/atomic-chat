const test = require('node:test');
const assert = require('node:assert/strict');
const { createIpcSenderGuard } = require('../electron/ipc/ipc-sender-guard.cjs');

function fixture({ authorized = true } = {}) {
  const mainFrame = {
    url: authorized ? 'file:///atomic/index.html' : 'file:///external.html',
  };
  const sender = { mainFrame };
  const window = {};
  const BrowserWindow = { fromWebContents: (value) => (value === sender ? window : null) };
  const assertSender = createIpcSenderGuard({
    BrowserWindow,
    packagedUrl: 'file:///atomic/index.html',
  });
  return { assertSender, event: { sender, senderFrame: mainFrame } };
}

test('IPC sender guard accepts the authorized main frame', () => {
  const value = fixture();
  assert.doesNotThrow(() => value.assertSender(value.event));
});

test('IPC sender guard rejects an unauthorized frame with the stable error', () => {
  const value = fixture({ authorized: false });
  value.event.senderFrame = { url: 'file:///external.html' };
  assert.throws(() => value.assertSender(value.event), /UNAUTHORIZED/);
});

test('IPC sender guard rejects missing window or non-main frame', () => {
  const value = fixture();
  value.event.senderFrame = { url: 'file:///atomic/index.html' };
  assert.throws(() => value.assertSender(value.event), /UNAUTHORIZED/);
});
