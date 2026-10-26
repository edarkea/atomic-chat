const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const path = require('node:path');
const { PersistenceStore } = require('./storage.cjs');
const { SecretStore } = require('./secrets.cjs');
const { XmppAdapter } = require('./xmpp-adapter.cjs');

if (process.env.ATOMIC_XMPP_ALLOW_INSECURE_TLS === 'true') {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  console.warn('WARNING: insecure TLS is enabled; this build is not production-secure.');
}

let persistence;
let secrets;
let xmpp;

function createWindow() {
  const window = new BrowserWindow({
    width: 560, height: 400, minWidth: 560, minHeight: 400, resizable: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  window.removeMenu();
  if (process.env['ATOMIC_CHAT_DEV_SERVER']) window.loadURL(process.env['ATOMIC_CHAT_DEV_SERVER']);
  else window.loadFile(path.join(__dirname, '..', 'dist', 'atomic-chat', 'browser', 'index.html'));
}

function requestId(event) { return typeof event.senderFrame?.url === 'string' ? `ipc_${Date.now()}` : 'ipc_unknown'; }
function assertSender(event) { if (!event.senderFrame) throw new Error('UNAUTHORIZED'); }

ipcMain.handle('p0.contract.version', (event) => { assertSender(event); return { version: 1 }; });
ipcMain.handle('account.setSecret', (event, input) => { assertSender(event); if (!input?.credentialRef || typeof input.secret !== 'string') throw new Error('INVALID_INPUT'); secrets.put(input.credentialRef, input.secret); return { ok: true, version: 1, requestId: requestId(event) }; });
ipcMain.handle('account.connect', async (event, input) => { assertSender(event); try { const password = secrets.get(input.credentialRef); const state = await xmpp.connect(input, password); persistence.upsertAccount({ accountId: input.accountId, host: input.endpoint.host, port: input.endpoint.port, tls: input.endpoint.tls ? 1 : 0, credentialRef: input.credentialRef || null, createdAt: new Date().toISOString() }); const window = BrowserWindow.fromWebContents(event.sender); window?.setResizable(true); window?.setMinimumSize(900, 640); window?.setSize(1280, 820); window?.center(); return { ok: true, value: state, version: 1, requestId: requestId(event) }; } catch (error) { return { ok: false, version: 1, error: { code: error.message === 'secret_unavailable' ? 'STORAGE_FAILED' : 'TRANSPORT_FAILED', retryable: true, requestId: requestId(event), message: 'No fue posible conectar con el servidor XMPP.' } }; } });
ipcMain.handle('account.disconnect', async (event, accountId) => { assertSender(event); await xmpp.disconnect(accountId); return { ok: true, value: undefined, version: 1, requestId: requestId(event) }; });
ipcMain.handle('session.getState', (event, accountId) => { assertSender(event); return { ok: true, value: { accountId, status: xmpp.sessions.has(accountId) ? 'connected' : 'idle', retryable: false, since: new Date().toISOString() }, version: 1, requestId: requestId(event) }; });
ipcMain.handle('presence.set', async (event, input) => { assertSender(event); const value = await xmpp.setPresence(input.accountId, input); return { ok: true, value, version: 1, requestId: requestId(event) }; });
ipcMain.handle('roster.list', async (event, accountId) => { assertSender(event); const value = await xmpp.listRoster(accountId); return { ok: true, value, version: 1, requestId: requestId(event) }; });
ipcMain.handle('message.send', async (event, input) => { assertSender(event); const accountId = input.accountId || [...xmpp.sessions.keys()][0]; const sent = await xmpp.sendMessage(accountId, { ...input, to: input.conversationId }); const value = { ...sent, id: `msg_${Date.now()}`, senderJid: accountId, conversationId: input.conversationId, status: 'sent' }; persistence.saveMessage(value); return { ok: true, value, version: 1, requestId: requestId(event) }; });
ipcMain.handle('messages.list', (event, input) => { assertSender(event); const values = persistence.listMessages(input?.conversationId); return { ok: true, value: values, version: 1, requestId: requestId(event) }; });
const preferenceDefaults = { theme: 'atomic', notifications: true, autoLogin: false };
function preferenceScope(key, accountId) { return key === 'autoLogin' ? { scope: 'account', scopeId: accountId } : { scope: 'global', scopeId: 'app' }; }
function validatePreferences(changes) { const allowed = { theme: (value) => value === 'atomic', notifications: (value) => typeof value === 'boolean', autoLogin: (value) => typeof value === 'boolean' }; for (const [key, value] of Object.entries(changes || {})) if (!allowed[key] || !allowed[key](value)) throw new Error('INVALID_INPUT'); }
ipcMain.handle('preferences.get', (event, input) => { assertSender(event); const accountId = input?.accountId || [...xmpp.sessions.keys()][0] || ''; const values = { ...preferenceDefaults }; for (const key of Object.keys(preferenceDefaults)) { const target = preferenceScope(key, accountId); Object.assign(values, persistence.getPreferences(target.scope, target.scopeId)); } return { ok: true, value: values, version: 1, requestId: requestId(event) }; });
ipcMain.handle('preferences.update', (event, input) => { assertSender(event); validatePreferences(input?.changes); const accountId = input?.accountId || [...xmpp.sessions.keys()][0] || ''; for (const [key, value] of Object.entries(input.changes)) { const target = preferenceScope(key, accountId); persistence.updatePreferences(target.scope, target.scopeId, { [key]: value }); } return { ok: true, value: input.changes, version: 1, requestId: requestId(event) }; });
ipcMain.handle('preferences.reset', (event, input) => { assertSender(event); const accountId = input?.accountId || [...xmpp.sessions.keys()][0] || ''; persistence.resetPreferences('global', 'app'); persistence.resetPreferences('account', accountId); return { ok: true, value: preferenceDefaults, version: 1, requestId: requestId(event) }; });

app.whenReady().then(() => {
  persistence = new PersistenceStore(app.getPath('userData'));
  secrets = new SecretStore(safeStorage, app.getPath('userData'));
  xmpp = new XmppAdapter();
  xmpp.onEvent((event) => { if (event.type === 'message.received') { try { const message = event.payload; if (message?.id && message?.conversationId && message?.clientMessageId && message?.senderJid && message?.body && message?.createdAt) persistence.saveMessage(message); else console.warn('[PERSISTENCE] Incoming message missing required fields.'); } catch (error) { console.error('[PERSISTENCE] Could not save incoming message:', error.message); } } BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('domain.event', { version: 1, eventId: `evt_${Date.now()}`, type: event.type, payload: event.payload })); });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => { persistence?.close(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
