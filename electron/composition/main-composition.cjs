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
  Tray,
  screen,
} = require('electron');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { PersistenceStore } = require('../persistence/storage.cjs');
const { SecretStore } = require('../security/secrets.cjs');
const { XmppAdapter } = require('../xmpp/xmpp-adapter.cjs');
const { validateXmppTransport } = require('../security/security-policy.cjs');
const { createIpcSenderGuard } = require('../ipc/ipc-sender-guard.cjs');
const { createHistorySecurity } = require('../ipc/history-security.cjs');
const { FileTransferCoordinator } = require('../files/file-transfer.cjs');
const { OutgoingFileTransferCoordinator } = require('../files/file-transfer-outgoing.cjs');
const { FileLocalActionRegistry } = require('../files/file-local-actions.cjs');
const { TransferResourceLimiter } = require('../files/file-transfer-resources.cjs');
const { registerAppLifecycle } = require('../platform/app-lifecycle.cjs');
const { createEventRouter } = require('../application/event-router.cjs');
const { createFileDialogs } = require('../files/file-dialog.cjs');
const { createMainWindow } = require('../platform/main-window.cjs');
const { createRuntime } = require('../application/runtime.cjs');
const { registerIpcHandlers } = require('../ipc/ipc-handlers.cjs');
const { createUpdateService } = require('../platform/update-service.cjs');
const { createApplicationAttention } = require('../platform/application-attention.cjs');
const { createMessageNotifications } = require('../platform/message-notifications.cjs');
const { createBackgroundMode } = require('../platform/background-mode.cjs');
const {
  createIncomingMessageProcessor,
} = require('../application/incoming-message-persistence.cjs');
const { PreviewGrantRegistry } = require('../files/preview-grants.cjs');
const { MediaStore } = require('../files/media-store.cjs');
const { FileHistoryStore } = require('../files/file-history.cjs');
const { StickerStore } = require('../stickers/sticker-store.cjs');
const { StickerPackStore } = require('../stickers/sticker-pack-store.cjs');
const { StickerMessageStore } = require('../stickers/sticker-message-store.cjs');
const { StickerGrantRegistry } = require('../stickers/sticker-grants.cjs');
const { activateStickerStorage } = require('../stickers/sticker-storage-activation.cjs');
const { createConfiguredStickerStorageProvider } = require('../stickers/sticker-storage-http.cjs');
const { persistCompletedTransfer } = require('../files/media-transfer-persistence.cjs');
const { createMainEventSources } = require('../application/main-event-sources.cjs');
const { normalizeTransferTimeout } = require('../files/transfer-timeout.cjs');
const {
  DEFAULT_DOWNLOAD_DIRECTORY_NAME,
  normalizeDownloadDirectory,
} = require('../files/download-directory.cjs');

const fs = require('node:fs');
const { version: applicationVersion } = require('../../package.json');

const electronDirectory = path.resolve(__dirname, '..');

function startMainApplication() {
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
  const stickerStorageActivation = activateStickerStorage({
    environment: process.env,
    providerFactory: (configuration) =>
      createConfiguredStickerStorageProvider({ environment: process.env, configuration }),
  });
  const fileResourceLimiter = new TransferResourceLimiter();
  const {
    selectFileDestination,
    selectFileSource,
    selectStickerSource,
    selectDownloadDirectory,
    selectDefaultFileDestination,
  } = createFileDialogs({ dialog, fsp });
  const localFileActions = new FileLocalActionRegistry({ shell });
  const previewGrants = new PreviewGrantRegistry({
    nativeImage,
    resolveSource: (senderId, input) =>
      runtime.media
        .resolveForPreview(senderId, input)
        .catch(() => localFileActions.resolveForPreview(senderId, input)),
  });
  const stickerGrants = new StickerGrantRegistry({
    resolveSource: (accountId, stickerId) => {
      try {
        return runtime.stickers.resolveForPreview(accountId, stickerId);
      } catch (error) {
        return runtime.stickerMessages.resolveForPreview(accountId, stickerId);
      }
    },
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
      await persistCompletedTransfer({
        record,
        direction,
        media: runtime?.media,
        fileHistory: runtime?.fileHistory,
      });
      return localActions;
    },
    getTimeoutSeconds: currentTransferTimeout,
  });
  const outgoingFileTransfers = new OutgoingFileTransferCoordinator({
    resourceLimiter: fileResourceLimiter,
    onCompleted: async (record, direction) => {
      const localActions = await localFileActions.register(record, direction);
      await persistCompletedTransfer({
        record,
        direction,
        media: runtime?.media,
        fileHistory: runtime?.fileHistory,
      });
      return localActions;
    },
    getTimeoutSeconds: currentTransferTimeout,
  });
  const updateService = createUpdateService({
    app,
    applicationVersion,
    isPackaged: app.isPackaged,
    hasCriticalTransfers: () => fileResourceLimiter.counts('').global > 0,
    logger: console,
  });
  updateService.onStatus((status) => {
    for (const contents of webContents.getAllWebContents()) contents.send('update.status', status);
  });

  const applicationAttention = createApplicationAttention({ BrowserWindow, app });
  const backgroundMode = createBackgroundMode({
    app,
    BrowserWindow,
    Tray,
    nativeImage,
    screen,
    ipcMain,
    getPreferences: () => runtime?.persistence.getPreferences('global', 'app') || {},
    iconPath: path.join(electronDirectory, '..', 'build', 'icons', '128x128.png'),
  });
  const messageNotifications = createMessageNotifications({
    onIncomingMessage: () => backgroundMode.markUnread(),
    Notification,
    BrowserWindow,
    getPreferences: () => runtime?.persistence.getPreferences('global', 'app') || {},
    getRoster: (accountId) => runtime?.xmpp.rosters.get(accountId),
    getMucRoom: (accountId, roomJid) =>
      runtime?.xmpp.mucRooms.get(accountId)?.get(roomJid.toLowerCase()),
    getIconPath: () => {
      const iconPath = path.join(electronDirectory, '..', 'build', 'icons', '128x128.png');
      return fs.existsSync(iconPath) ? iconPath : undefined;
    },
  });
  const mainEventSources = createMainEventSources({
    BrowserWindow,
    webContents,
    createEventRouter,
    createIncomingMessageProcessor,
    getRuntime: () => runtime,
    fileTransfers,
    outgoingFileTransfers,
    backgroundMode,
    autoAcceptFileTransfers,
    messageNotifications,
  });

  const assertSender = createIpcSenderGuard({
    BrowserWindow,
    packagedUrl: pathToFileURL(
      path.join(electronDirectory, '..', 'dist', 'atomic-chat', 'browser', 'index.html'),
    ).href,
    devUrl: process.env.ATOMIC_CHAT_DEV_SERVER
      ? new URL(process.env.ATOMIC_CHAT_DEV_SERVER).href
      : '',
  });

  function createWindow() {
    const mainWindow = createMainWindow({
      BrowserWindow,
      preloadPath: path.join(electronDirectory, 'preload.cjs'),
      productionHtmlPath: path.join(
        electronDirectory,
        '..',
        'dist',
        'atomic-chat',
        'browser',
        'index.html',
      ),
      devServerUrl: process.env.ATOMIC_CHAT_DEV_SERVER,
      onDestroyed: (senderId) => {
        historySecurity.destroySender(senderId);
        localFileActions.clearSender(senderId);
        previewGrants.clearSender(senderId);
        stickerGrants.clearSender(senderId);
      },
    });
    mainWindow.on('focus', applicationAttention.acknowledge);
    backgroundMode.attach(mainWindow);
    return mainWindow;
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
      FileHistoryStore,
      StickerStore,
      StickerPackStore,
      StickerMessageStore,
      nativeImage,
      fileTransfers,
      outgoingFileTransfers,
      shell,
      stickerStorageProvider: stickerStorageActivation.provider,
      stickerStorageConfiguration: stickerStorageActivation.configuration,
    });
    runtime.stickers.setActiveGrantChecker((accountId, assetId) =>
      stickerGrants.hasActiveAsset(accountId, assetId),
    );
    mainEventSources.attach();
    createWindow();
  }

  async function shutdown() {
    backgroundMode.dispose();
    updateService.stop();
    const activeRuntime = runtime;
    await Promise.all(
      [...(activeRuntime?.xmpp.sessions.keys() || [])].map((accountId) =>
        Promise.race([
          activeRuntime.xmpp.disconnect(accountId),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]),
      ),
    );
    await activeRuntime?.reconciliation;
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
    stickerGrants,
    shell,
    historySecurity,
    selectFileSource,
    selectStickerSource,
    selectDownloadDirectory,
    defaultDownloadDirectory,
    applicationAttention,
    updateService,
    onPreferencesChanged: () => backgroundMode.syncPreferences(),
  });
  app.whenReady().then(() => {
    initializeRuntime();
    updateService.start();
  });
  registerAppLifecycle({
    app,
    BrowserWindow,
    createWindow,
    shutdown,
    openWindow: backgroundMode.open,
  });
}

module.exports = { startMainApplication };
