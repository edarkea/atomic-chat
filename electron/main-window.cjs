function createMainWindow({
  BrowserWindow,
  preloadPath,
  productionHtmlPath,
  devServerUrl,
  onDestroyed,
}) {
  const window = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 760,
    minHeight: 540,
    resizable: true,
    maximizable: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      preload: preloadPath,
    },
  });
  window.removeMenu();
  // Electron no longer permits access to webContents after it has been destroyed.
  const senderId = window.webContents.id;
  window.webContents.once('destroyed', () => onDestroyed(senderId));
  if (devServerUrl) window.loadURL(devServerUrl);
  else window.loadFile(productionHtmlPath);
  return window;
}

module.exports = { createMainWindow };
