const { app, BrowserWindow, ipcMain, safeStorage, webContents, dialog } = require('electron');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PersistenceStore } = require('./storage.cjs');
const { SecretStore } = require('./secrets.cjs');
const { XmppAdapter } = require('./xmpp-adapter.cjs');
const { validateXmppTransport } = require('./security-policy.cjs');
const { isAuthorizedSender } = require('./ipc-security.cjs');
const { createHistorySecurity } = require('./history-security.cjs');
const { FileTransferCoordinator } = require('./file-transfer.cjs');
const { OutgoingFileTransferCoordinator } = require('./file-transfer-outgoing.cjs');
const { TransferResourceLimiter } = require('./file-transfer-resources.cjs');
const { registerAppLifecycle } = require('./app-lifecycle.cjs');
const { createEventRouter } = require('./event-router.cjs');
const { createFileDialogs } = require('./file-dialog.cjs');
const { createMainWindow } = require('./main-window.cjs');
const { createRuntime } = require('./runtime.cjs');
const { registerIpcHandlers } = require('./ipc-handlers.cjs');
const { createApplicationAttention } = require('./application-attention.cjs');

const historySecurity = createHistorySecurity(process.env.ATOMIC_XMPP_USERNAME || '');
const fileResourceLimiter = new TransferResourceLimiter();
const { selectFileDestination, selectFileSource } = createFileDialogs({ dialog, fsp });
const fileTransfers = new FileTransferCoordinator({
  selectDestination: selectFileDestination,
  resourceLimiter: fileResourceLimiter,
});
const outgoingFileTransfers = new OutgoingFileTransferCoordinator({
  resourceLimiter: fileResourceLimiter,
});

let runtime;
const applicationAttention = createApplicationAttention({ BrowserWindow, app });

function assertSender(event) {
  const packagedUrl = pathToFileURL(
    path.join(__dirname, '..', 'dist', 'atomic-chat', 'browser', 'index.html'),
  ).href;
  const devUrl = process.env.ATOMIC_CHAT_DEV_SERVER
    ? new URL(process.env.ATOMIC_CHAT_DEV_SERVER).href
    : '';
  if (!isAuthorizedSender(event, BrowserWindow, packagedUrl, devUrl))
    throw new Error('UNAUTHORIZED');
}

function createWindow() {
  const mainWindow = createMainWindow({
    BrowserWindow,
    preloadPath: path.join(__dirname, 'preload.cjs'),
    productionHtmlPath: path.join(__dirname, '..', 'dist', 'atomic-chat', 'browser', 'index.html'),
    devServerUrl: process.env.ATOMIC_CHAT_DEV_SERVER,
    onDestroyed: (senderId) => historySecurity.destroySender(senderId),
  });
  mainWindow.on('focus', applicationAttention.acknowledge);
  return mainWindow;
}

function attachEventSources() {
  const eventRouter = createEventRouter({ BrowserWindow, webContents });
  fileTransfers.onEvent(eventRouter.forwardTransferEvent);
  outgoingFileTransfers.onEvent(eventRouter.forwardTransferEvent);
  runtime.xmpp.onEvent((event) => {
    if (event.type === 'message.received') {
      try {
        const message = event.payload;
        if (
          message?.id &&
          message?.conversationId &&
          message?.clientMessageId &&
          message?.senderJid &&
          message?.body &&
          message?.createdAt
        )
          runtime.persistence.saveMessage(message);
        else console.warn('[PERSISTENCE] Incoming message missing required fields.');
      } catch (error) {
        console.error('[PERSISTENCE] Could not save incoming message:', error.message);
      }
    }
    eventRouter.forwardXmppEvent(event);
  });
}

function initializeRuntime() {
  if (runtime) return;
  runtime = createRuntime({
    app,
    safeStorage,
    PersistenceStore,
    SecretStore,
    XmppAdapter,
    fileTransfers,
    outgoingFileTransfers,
  });
  attachEventSources();
  createWindow();
}

async function shutdown() {
  const activeRuntime = runtime;
  await Promise.all(
    [...(activeRuntime?.xmpp.sessions.keys() || [])].map((accountId) =>
      Promise.race([
        activeRuntime.xmpp.disconnect(accountId),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]),
    ),
  );
  activeRuntime?.persistence.close();
}

registerIpcHandlers({
  ipcMain,
  assertSender,
  validateXmppTransport,
  appIsPackaged: app.isPackaged,
  getRuntime: () => runtime,
  fileTransfers,
  outgoingFileTransfers,
  historySecurity,
  selectFileSource,
  applicationAttention,
});
app.whenReady().then(initializeRuntime);
registerAppLifecycle({ app, BrowserWindow, createWindow, shutdown });
