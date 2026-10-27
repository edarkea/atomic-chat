const { app, BrowserWindow, ipcMain, safeStorage } = require('electron');
const crypto = require('node:crypto');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PersistenceStore } = require('./storage.cjs');
const { SecretStore } = require('./secrets.cjs');
const { XmppAdapter } = require('./xmpp-adapter.cjs');
const { validateXmppTransport } = require('./security-policy.cjs');
const { isAuthorizedSender } = require('./ipc-security.cjs');

let persistence;
let secrets;
let xmpp;

function createWindow() {
  const window = new BrowserWindow({
    width: 1080, height: 720, minWidth: 760, minHeight: 540, resizable: true, maximizable: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, 'preload.cjs') },
  });
  window.removeMenu();
  if (process.env['ATOMIC_CHAT_DEV_SERVER']) window.loadURL(process.env['ATOMIC_CHAT_DEV_SERVER']);
  else window.loadFile(path.join(__dirname, '..', 'dist', 'atomic-chat', 'browser', 'index.html'));
}

function requestId(event, input) { return input?.requestId || `ipc_${Date.now()}_${Math.random().toString(36).slice(2)}`; }
function assertSender(event) { const packagedUrl = pathToFileURL(path.join(__dirname, '..', 'dist', 'atomic-chat', 'browser', 'index.html')).href; const devUrl = process.env.ATOMIC_CHAT_DEV_SERVER ? new URL(process.env.ATOMIC_CHAT_DEV_SERVER).href : ''; if (!isAuthorizedSender(event, BrowserWindow, packagedUrl, devUrl)) throw new Error('UNAUTHORIZED'); }
function validVersion(input) { return input?.version === 1; }
function requireText(value, name) { if (typeof value !== 'string' || !value.trim() || value.length > 512) throw new Error(`INVALID_${name}`); return value.trim(); }
function validateAccountInput(input) { if (!validVersion(input)) throw new Error('UNSUPPORTED'); requireText(input.accountId, 'ACCOUNT'); validateXmppTransport(input.endpoint, app.isPackaged); }

ipcMain.handle('p0.contract.version', (event) => { assertSender(event); return { version: 1 }; });
ipcMain.handle('account.setSecret', (event, input) => { assertSender(event); if (!validVersion(input) || typeof input.credentialRef !== 'string' || typeof input.secret !== 'string' || !input.secret || input.secret.length > 4096) throw new Error('INVALID_INPUT'); secrets.put(input.credentialRef, input.secret); return { ok: true, value: { stored: true }, version: 1, requestId: requestId(event, input) }; });
ipcMain.handle('account.connect', async (event, input) => { assertSender(event); try { validateAccountInput(input); const password = secrets.get(input.credentialRef); const state = await xmpp.connect(input, password); persistence.upsertAccount({ accountId: input.accountId, host: input.endpoint.host, port: input.endpoint.port, tls: input.endpoint.tls ? 1 : 0, credentialRef: input.credentialRef || null, createdAt: new Date().toISOString() }); return { ok: true, value: state, version: 1, requestId: requestId(event, input) }; } catch (error) { console.error('[XMPP-CONNECT-FAILED]', {
  code: error?.code,
  message: error?.message,
  cause: error?.cause?.message,
}); return { ok: false, version: 1, error: { code: error.message === 'secret_unavailable' ? 'STORAGE_FAILED' : 'TRANSPORT_FAILED', retryable: true, requestId: requestId(event, input), message: 'No fue posible conectar con el servidor XMPP.' } }; } });
ipcMain.handle('account.disconnect', async (event, accountId) => { assertSender(event); await xmpp.disconnect(accountId); return { ok: true, value: undefined, version: 1, requestId: requestId(event) }; });
ipcMain.handle('session.getState', (event, accountId) => { assertSender(event); requireText(accountId, 'ACCOUNT'); const state = xmpp.states.get(accountId) || { accountId, status: 'idle', retryable: false, since: new Date().toISOString() }; return { ok: true, value: state, version: 1, requestId: requestId(event) }; });
ipcMain.handle('presence.set', async (event, input) => { assertSender(event); const value = await xmpp.setPresence(input.accountId, input); return { ok: true, value, version: 1, requestId: requestId(event) }; });
ipcMain.handle('roster.list', async (event, accountId) => { assertSender(event); const value = await xmpp.listRoster(accountId); return { ok: true, value, version: 1, requestId: requestId(event) }; });
ipcMain.handle('message.send', async (event, input) => { assertSender(event); if (!validVersion(input)) throw new Error('UNSUPPORTED'); const accountId = requireText(input.accountId, 'ACCOUNT'); if (!xmpp.sessions.has(accountId) || xmpp.states.get(accountId)?.status !== 'connected') throw new Error('NOT_CONNECTED'); const conversationId = requireText(input.conversationId, 'CONVERSATION'); const clientMessageId = requireText(input.clientMessageId, 'MESSAGE_ID'); if (input.body?.kind !== 'text' || typeof input.body.text !== 'string' || !input.body.text.trim()) throw new Error('INVALID_BODY'); const sent = await xmpp.sendMessage(accountId, { ...input, to: conversationId }); const value = { ...sent, id: `msg_${crypto.randomUUID()}`, accountId, conversationId, clientMessageId, senderJid: accountId, status: 'sent' }; persistence.saveMessage(value); return { ok: true, value, version: 1, requestId: requestId(event, input) }; });
ipcMain.handle('messages.list', (event, input) => { assertSender(event); if (!validVersion(input) || !input.accountId || !input.conversationId) throw new Error('INVALID_INPUT'); const values = persistence.listMessages(input.accountId, input.conversationId); return { ok: true, value: values, version: 1, requestId: requestId(event, input) }; });
ipcMain.handle('conversations.list', (event, input) => { assertSender(event); if (!validVersion(input) || !input.accountId) throw new Error('INVALID_INPUT'); const values = persistence.listConversations(input.accountId); return { ok: true, value: values, version: 1, requestId: requestId(event, input) }; });
const preferenceDefaults = { theme: 'atomic', notifications: true, autoLogin: false };
function preferenceScope(key, accountId) { return key === 'autoLogin' ? { scope: 'account', scopeId: accountId } : { scope: 'global', scopeId: 'app' }; }
function validatePreferences(changes) { const allowed = { theme: (value) => value === 'atomic', notifications: (value) => typeof value === 'boolean', autoLogin: (value) => typeof value === 'boolean' }; for (const [key, value] of Object.entries(changes || {})) if (!allowed[key] || !allowed[key](value)) throw new Error('INVALID_INPUT'); }
ipcMain.handle('preferences.get', (event, input) => { assertSender(event); const accountId = input?.accountId || [...xmpp.sessions.keys()][0] || ''; const values = { ...preferenceDefaults }; for (const key of Object.keys(preferenceDefaults)) { const target = preferenceScope(key, accountId); Object.assign(values, persistence.getPreferences(target.scope, target.scopeId)); } return { ok: true, value: values, version: 1, requestId: requestId(event) }; });
ipcMain.handle('preferences.update', (event, input) => { assertSender(event); validatePreferences(input?.changes); const accountId = input?.accountId || [...xmpp.sessions.keys()][0] || ''; for (const [key, value] of Object.entries(input.changes)) { const target = preferenceScope(key, accountId); persistence.updatePreferences(target.scope, target.scopeId, { [key]: value }); } return { ok: true, value: input.changes, version: 1, requestId: requestId(event) }; });
ipcMain.handle('preferences.reset', (event, input) => { assertSender(event); const accountId = input?.accountId || [...xmpp.sessions.keys()][0] || ''; persistence.resetPreferences('global', 'app'); persistence.resetPreferences('account', accountId); return { ok: true, value: preferenceDefaults, version: 1, requestId: requestId(event) }; });

app.whenReady().then(() => {
  persistence = new PersistenceStore(app.getPath('userData'));
  secrets = new SecretStore(safeStorage, app.getPath('userData'));
  xmpp = new XmppAdapter(app.isPackaged);
  xmpp.onEvent((event) => { if (event.type === 'message.received') { try { const message = event.payload; if (message?.id && message?.conversationId && message?.clientMessageId && message?.senderJid && message?.body && message?.createdAt) persistence.saveMessage(message); else console.warn('[PERSISTENCE] Incoming message missing required fields.'); } catch (error) { console.error('[PERSISTENCE] Could not save incoming message:', error.message); } } BrowserWindow.getAllWindows().forEach((window) => window.webContents.send('domain.event', { version: 1, eventId: `evt_${Date.now()}`, type: event.type, payload: event.payload })); });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('before-quit', () => { persistence?.close(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
