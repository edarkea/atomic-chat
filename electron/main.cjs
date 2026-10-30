const {
  app,
  BrowserWindow,
  Notification,
  ipcMain,
  safeStorage,
  webContents,
  dialog,
  shell,
  nativeImage,
} = require('electron');
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
const { FileLocalActionRegistry } = require('./file-local-actions.cjs');
const { TransferResourceLimiter } = require('./file-transfer-resources.cjs');
const { registerAppLifecycle } = require('./app-lifecycle.cjs');
const { createEventRouter } = require('./event-router.cjs');
const { createFileDialogs } = require('./file-dialog.cjs');
const { createMainWindow } = require('./main-window.cjs');
const { createRuntime } = require('./runtime.cjs');
const { registerIpcHandlers } = require('./ipc-handlers.cjs');
const { createApplicationAttention } = require('./application-attention.cjs');
const { createMessageNotifications } = require('./message-notifications.cjs');
const { createIncomingMessageProcessor } = require('./incoming-message-persistence.cjs');
const { PreviewGrantRegistry } = require('./preview-grants.cjs');
const { MediaStore } = require('./media-store.cjs');
const { normalizeTransferTimeout } = require('./transfer-timeout.cjs');
const {
  DEFAULT_DOWNLOAD_DIRECTORY_NAME,
  normalizeDownloadDirectory,
} = require('./download-directory.cjs');

const fs = require('node:fs');

const atomicDataPath = app.isPackaged
  ? path.join(process.env.PORTABLE_EXECUTABLE_DIR || app.getPath('appData'), 'AtomicChat-Data')
  : path.join(app.getPath('appData'), 'AtomicChat-Dev');
const defaultDownloadDirectory = path.join(
  app.getPath('documents'),
  DEFAULT_DOWNLOAD_DIRECTORY_NAME,
);

fs.mkdirSync(atomicDataPath, { recursive: true });
app.setPath('userData', atomicDataPath);
const historySecurity = createHistorySecurity(process.env.ATOMIC_XMPP_USERNAME || '');
const fileResourceLimiter = new TransferResourceLimiter();
const {
  selectFileDestination,
  selectFileSource,
  selectDownloadDirectory,
  selectDefaultFileDestination,
} = createFileDialogs({ dialog, fsp });
const localFileActions = new FileLocalActionRegistry({ shell });
const previewGrants = new PreviewGrantRegistry({
  nativeImage,
  resolveSource: (senderId, input) =>
    input.mediaId
      ? runtime.media.resolveForPreview(senderId, input)
      : localFileActions.resolveForPreview(senderId, input),
});
let runtime;
const currentTransferTimeout = () => {
  try {
    return normalizeTransferTimeout(
      runtime?.persistence.getPreferences('global', 'app')?.fileTransferTimeoutSeconds,
    );
  } catch {
    return normalizeTransferTimeout(undefined);
  }
};
const currentDownloadDirectory = () => {
  try {
    return normalizeDownloadDirectory(
      runtime?.persistence.getPreferences('global', 'app')?.downloadDirectory,
      defaultDownloadDirectory,
    );
  } catch {
    return defaultDownloadDirectory;
  }
};
const autoAcceptFileTransfers = () => {
  try {
    return runtime?.persistence.getPreferences('global', 'app')?.autoAcceptFileTransfers === true;
  } catch {
    return false;
  }
};
const fileTransfers = new FileTransferCoordinator({
  selectDestination: selectFileDestination,
  getDefaultDirectory: currentDownloadDirectory,
  selectDefaultDestination: selectDefaultFileDestination,
  resourceLimiter: fileResourceLimiter,
  onCompleted: async (record, direction) => {
    const localActions =
      direction === 'incoming' ? await localFileActions.register(record, direction) : false;
    await runtime?.media.persistTransfer(record, direction);
    return localActions;
  },
  getTimeoutSeconds: currentTransferTimeout,
});
const outgoingFileTransfers = new OutgoingFileTransferCoordinator({
  resourceLimiter: fileResourceLimiter,
  onCompleted: async (record, direction) => {
    await runtime?.media.persistTransfer(record, direction);
    return false;
  },
  getTimeoutSeconds: currentTransferTimeout,
});

const applicationAttention = createApplicationAttention({ BrowserWindow, app });
const messageNotifications = createMessageNotifications({
  Notification,
  BrowserWindow,
  getPreferences: () => runtime?.persistence.getPreferences('global', 'app') || {},
  getRoster: (accountId) => runtime?.xmpp.rosters.get(accountId),
  getMucRoom: (accountId, roomJid) =>
    runtime?.xmpp.mucRooms.get(accountId)?.get(roomJid.toLowerCase()),
  getIconPath: () => {
    const iconPath = path.join(__dirname, '..', 'build', 'icons', '128x128.png');
    return fs.existsSync(iconPath) ? iconPath : undefined;
  },
});

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
    onDestroyed: (senderId) => {
      historySecurity.destroySender(senderId);
      localFileActions.clearSender(senderId);
      previewGrants.clearSender(senderId);
    },
  });
  mainWindow.on('focus', applicationAttention.acknowledge);
  return mainWindow;
}

function attachEventSources() {
  const eventRouter = createEventRouter({ BrowserWindow, webContents });
  const processIncomingMessage = createIncomingMessageProcessor({
    persistence: runtime.persistence,
    onPersistenceError: (error) =>
      console.error('[PERSISTENCE] Could not save incoming message:', error?.message || 'STORAGE_FAILED'),
  });
  runtime.media.onEvent((event) => eventRouter.forwardTransferEvent(event));
  fileTransfers.onEvent((event) => {
    eventRouter.forwardTransferEvent(event);
    if (event.type !== 'file.offerReceived' || !autoAcceptFileTransfers()) return;
    void fileTransfers
      .accept(event.payload.transferId, event.targetSenderId)
      .catch((error) =>
        console.warn('[FILE TRANSFER] Automatic acceptance failed:', error.code || error.message),
      );
  });
  outgoingFileTransfers.onEvent(eventRouter.forwardTransferEvent);
  runtime.xmpp.onEvent((event) => {
    const processed = processIncomingMessage(event);
    messageNotifications.handle(processed);
    eventRouter.forwardXmppEvent(processed);
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
    MediaStore,
    nativeImage,
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
  localFileActions,
  previewGrants,
  shell,
  historySecurity,
  selectFileSource,
  selectDownloadDirectory,
  defaultDownloadDirectory,
  applicationAttention,
});
app.whenReady().then(initializeRuntime);
registerAppLifecycle({ app, BrowserWindow, createWindow, shutdown });
