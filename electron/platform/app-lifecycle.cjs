function registerAppLifecycle({ app, BrowserWindow, createWindow, shutdown, openWindow }) {
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
    else openWindow?.();
  });

  let closing = false;
  app.on('before-quit', (event) => {
    if (closing) return;
    closing = true;
    event.preventDefault();
    void shutdown().finally(() => app.exit(0));
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}

module.exports = { registerAppLifecycle };
