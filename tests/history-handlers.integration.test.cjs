const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const EventEmitter = require('node:events');

function loadHandlers() {
  const handlers = new Map(); const windows = [];
  const app = { isPackaged: false, whenReady: () => Promise.resolve(), on: () => {}, getPath: () => 'synthetic-user-data', quit: () => {}, exit: () => {} };
  class FakeWindow extends EventEmitter { constructor() { super(); this.webContents = new EventEmitter(); this.webContents.id = windows.length + 1; windows.push(this); } removeMenu() {} loadFile() { return Promise.resolve(); } }
  FakeWindow.getAllWindows = () => windows;
  const ipcMain = { handle: (channel, handler) => handlers.set(channel, handler) };
  class FakePersistence {
    constructor() { this.messages = [{ id: 'm1', account_id: 'one@example.invalid', conversation_id: 'contact@example.invalid', created_at: '2026-01-01T00:00:00.000Z' }]; }
    listMessages(accountId, conversationId) { return this.messages.filter((message) => message.account_id === accountId && message.conversation_id === conversationId).map((message) => ({ id: message.id, accountId, conversationId, clientMessageId: message.id, senderJid: conversationId, body: { kind: 'text', text: 'synthetic' }, status: 'sent', createdAt: message.created_at })); }
    listMessagesPage(accountId, conversationId) { return { items: this.listMessages(accountId, conversationId), hasMore: false }; }
    listConversations(accountId) { return this.listMessages(accountId, '').map((message) => ({ accountId, jid: message.conversation_id, lastActivity: message.created_at })); }
    upsertAccount() {} saveMessage() {} close() {} getPreferences() { return {}; } updatePreferences() {} resetPreferences() {}
  }
  class FakeSecrets { put() {} get() { return 'synthetic-secret'; } }
  class FakeXmpp extends EventEmitter { constructor() { super(); this.sessions = new Map(); this.states = new Map(); } onEvent(listener) { this.on('domain-event', listener); } async connect(input) { this.sessions.set(input.accountId, {}); const state = { accountId: input.accountId, status: 'connected', retryable: false, since: new Date().toISOString() }; this.states.set(input.accountId, state); return state; } async disconnect() {} async setPresence() {} async listRoster() { return []; } async sendMessage() {} }
  const electron = { app, BrowserWindow: FakeWindow, ipcMain, safeStorage: {} };
  const replacements = new Map([
    ['electron', electron],
    ['./storage.cjs', { PersistenceStore: FakePersistence }],
    ['./secrets.cjs', { SecretStore: FakeSecrets }],
    ['./xmpp-adapter.cjs', { XmppAdapter: FakeXmpp }],
    ['./ipc-security.cjs', { isAuthorizedSender: () => true }],
    ['./security-policy.cjs', { validateXmppTransport: () => {} }],
  ]);
  const originalLoad = Module._load;
  Module._load = function (request, parent, isMain) { return replacements.has(request) ? replacements.get(request) : originalLoad.call(this, request, parent, isMain); };
  delete require.cache[require.resolve('../electron/main.cjs')];
  require('../electron/main.cjs');
  Module._load = originalLoad;
  return { handlers, windows, FakeWindow };
}

const historyInput = (accountId, conversationId = 'contact@example.invalid') => ({ version: 1, requestId: `req-${accountId}`, accountId, conversationId });

test('registered history handlers enforce sender/account isolation and cursor integrity', async () => {
  process.env.ATOMIC_XMPP_USERNAME = 'one@example.invalid';
  const { handlers } = loadHandlers();
  await new Promise((resolve) => setImmediate(resolve));
  const first = { sender: { id: 101 } }; const second = { sender: { id: 202 } };
  const list = handlers.get('messages.list'); const page = handlers.get('messages.page'); const conversations = handlers.get('conversations.list');
  const own = await list(first, historyInput('one@example.invalid'));
  assert.equal(own.ok, true); assert.equal(own.requestId, 'req-one@example.invalid');
  const foreign = await list(first, historyInput('two@example.invalid'));
  assert.equal(foreign.ok, false); assert.equal(foreign.error.code, 'UNAUTHORIZED');
  const ownConversations = await conversations(first, { ...historyInput('one@example.invalid') }); assert.equal(ownConversations.ok, true);
  const foreignConversations = await conversations(first, { ...historyInput('two@example.invalid') }); assert.equal(foreignConversations.error.code, 'UNAUTHORIZED');
  const firstPage = await page(first, { ...historyInput('one@example.invalid'), limit: 50, direction: 'older', cursor: null }); assert.equal(firstPage.ok, true);
  assert.equal((await page(first, { ...historyInput('one@example.invalid'), limit: 0, direction: 'older', cursor: null })).error.code, 'INVALID_INPUT');
  assert.equal((await page(first, { ...historyInput('one@example.invalid'), limit: 50, direction: 'older', cursor: `${firstPage.value.nextCursor || 'bad'}x` })).error.code, 'INVALID_INPUT');
  assert.equal((await page(second, { ...historyInput('one@example.invalid'), limit: 50, direction: 'older', cursor: null })).error.code, 'UNAUTHORIZED');
});

test('registered account connection changes sender ownership and destruction revokes it', async () => {
  process.env.ATOMIC_XMPP_USERNAME = 'one@example.invalid';
  const { handlers, windows } = loadHandlers(); const connect = handlers.get('account.connect'); const page = handlers.get('messages.page');
  await new Promise((resolve) => setImmediate(resolve));
  const sender = { sender: { id: windows[0].webContents.id } }; const result = await connect(sender, { version: 1, requestId: 'connect-two', accountId: 'two@example.invalid', endpoint: { host: 'example.invalid', port: 5222, tls: true }, credentialRef: 'account:two@example.invalid' });
  assert.equal(result.ok, true); assert.equal(result.requestId, 'connect-two');
  assert.equal((await page(sender, { ...historyInput('two@example.invalid'), limit: 50, direction: 'older', cursor: null })).ok, true);
  const window = windows[0]; window.webContents.emit('destroyed');
  assert.equal((await page(sender, { ...historyInput('two@example.invalid'), limit: 50, direction: 'older', cursor: null })).error.code, 'UNAUTHORIZED');
});
