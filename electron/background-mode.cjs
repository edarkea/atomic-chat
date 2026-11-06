const path = require('node:path');
const { pathToFileURL } = require('node:url');

function badgeImage(nativeImage, original) {
  const image = original.resize({ width: 24, height: 24 });
  const bitmap = image.toBitmap();
  for (let y = 14; y < 24; y++) {
    for (let x = 14; x < 24; x++) {
      if ((x - 18.5) ** 2 + (y - 18.5) ** 2 > 25) continue;
      const offset = (y * 24 + x) * 4;
      bitmap[offset] = 54;
      bitmap[offset + 1] = 54;
      bitmap[offset + 2] = 240;
      bitmap[offset + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(bitmap, { width: 24, height: 24 });
}

function createBackgroundMode({
  app,
  BrowserWindow,
  Tray,
  nativeImage,
  screen,
  ipcMain,
  getPreferences,
  iconPath,
  logger = console,
}) {
  let mainWindow;
  let tray;
  let menu;
  let quitting = false;
  let unread = false;
  let normalIcon;
  let unreadIcon;
  const menuPath = path.join(__dirname, 'tray-menu.html');
  const menuUrl = pathToFileURL(menuPath).href;

  function enabled() {
    return getPreferences()?.closeToTray === true;
  }
  function snapshot() {
    const preferences = getPreferences();
    return {
      unread,
      theme: preferences.theme,
      customTheme: preferences.customTheme,
    };
  }
  function updateMenu() {
    if (menu && !menu.isDestroyed()) menu.webContents.send('tray.state', snapshot());
  }
  function updateIcon() {
    tray?.setImage(unread ? unreadIcon : normalIcon);
    tray?.setToolTip(unread ? 'Atomic Chat · mensajes nuevos' : 'Atomic Chat');
    updateMenu();
  }
  function open() {
    menu?.hide();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
  function ensureMenu() {
    if (menu && !menu.isDestroyed()) return menu;
    menu = new BrowserWindow({
      width: 276,
      height: 110,
      show: false,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: '#020d07',
      webPreferences: {
        preload: path.join(__dirname, 'tray-preload.cjs'),
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    menu.removeMenu();
    menu.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    menu.webContents.on('will-navigate', (event) => event.preventDefault());
    menu.on('blur', () => menu?.hide());
    menu.on('closed', () => {
      menu = undefined;
    });
    void menu.loadFile(menuPath).catch(() => {
      logger.warn('[TRAY] Could not load menu');
      menu?.destroy();
      open();
    });
    return menu;
  }
  function showMenu() {
    const popup = ensureMenu();
    const point = screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(point).workArea;
    popup.setPosition(
      Math.max(area.x, Math.min(point.x, area.x + area.width - 276)),
      Math.max(area.y, Math.min(point.y, area.y + area.height - 110)),
    );
    updateMenu();
    popup.show();
    popup.focus();
  }
  function syncPreferences() {
    if (!enabled()) {
      tray?.destroy();
      tray = undefined;
      menu?.destroy();
      return;
    }
    if (!tray) {
      try {
        normalIcon = nativeImage.createFromPath(iconPath).resize({ width: 24, height: 24 });
        if (normalIcon.isEmpty()) throw new Error('EMPTY_ICON');
        unreadIcon = badgeImage(nativeImage, normalIcon);
        tray = new Tray(normalIcon);
        tray.on('click', open);
        tray.on('double-click', open);
        tray.on('right-click', showMenu);
      } catch {
        tray?.destroy();
        tray = undefined;
        logger.warn('[TRAY] System tray unavailable; closing will exit');
      }
    }
    updateIcon();
  }
  function assertMenu(event) {
    if (
      !menu ||
      menu.isDestroyed() ||
      event.sender !== menu.webContents ||
      event.senderFrame !== menu.webContents.mainFrame ||
      event.senderFrame.url !== menuUrl
    )
      throw new Error('UNAUTHORIZED');
  }
  ipcMain.handle('tray.getState', (event) => {
    assertMenu(event);
    return snapshot();
  });
  ipcMain.handle('tray.action', async (event, action) => {
    assertMenu(event);
    if (action === 'open') {
      open();
      return { ok: true };
    }
    if (action === 'quit') {
      app.quit();
      return { ok: true };
    }
    if (action === 'hide') {
      menu.hide();
      return { ok: true };
    }
    throw new Error('INVALID_INPUT');
  });
  app.on('before-quit', () => {
    quitting = true;
  });

  return {
    syncPreferences,
    open,
    attach(window) {
      mainWindow = window;
      window.on('close', (event) => {
        if (quitting) return;
        event.preventDefault();
        if (enabled()) syncPreferences();
        if (enabled() && tray) {
          menu?.hide();
          window.hide();
        } else app.quit();
      });
      window.on('focus', () => {
        unread = false;
        updateIcon();
      });
      syncPreferences();
    },
    markUnread() {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return;
      unread = true;
      updateIcon();
    },
    updateMenu,
    dispose() {
      quitting = true;
      tray?.destroy();
      tray = undefined;
      menu?.destroy();
    },
  };
}

module.exports = { createBackgroundMode, badgeImage };
