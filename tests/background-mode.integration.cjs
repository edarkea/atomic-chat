// Local Electron-only integration. No application runtime, secrets or network connections.
const { app, BrowserWindow, ipcMain, nativeImage, screen } = require('electron');
const { EventEmitter } = require('node:events');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createBackgroundMode } = require('../electron/platform/background-mode.cjs');
const { createMainWindow } = require('../electron/platform/main-window.cjs');

const windows = [];
class HiddenWindow extends BrowserWindow {
  constructor(options) {
    super({ ...options, show: false });
    windows.push(this);
  }
  show() {}
  focus() {}
}
let tray;
class TestTray extends EventEmitter {
  constructor() {
    super();
    tray = this;
  }
  setImage() {}
  setToolTip() {}
  destroy() {}
}

app
  .whenReady()
  .then(async () => {
    const preferences = { closeToTray: true, theme: 'atomic' };
    const background = createBackgroundMode({
      app,
      BrowserWindow: HiddenWindow,
      Tray: TestTray,
      nativeImage,
      screen,
      ipcMain,
      getPreferences: () => preferences,
      iconPath: path.resolve('build/icons/128x128.png'),
    });
    const cleanedSenders = [];
    const main = createMainWindow({
      BrowserWindow: HiddenWindow,
      preloadPath: path.resolve('electron/tray/tray-preload.cjs'),
      devServerUrl: 'about:blank',
      onDestroyed: (senderId) => cleanedSenders.push(senderId),
    });
    const mainSenderId = main.webContents.id;
    if (main.webContents.isLoading())
      await new Promise((resolve) => main.webContents.once('did-finish-load', resolve));
    background.attach(main);
    tray.emit('right-click');
    const popup = windows.at(-1);
    if (popup.webContents.isLoading())
      await new Promise((resolve) => popup.webContents.once('did-finish-load', resolve));
    const state = await popup.webContents.executeJavaScript('window.trayMenu.getState()');
    assert.equal(state.unread, false);
    assert.equal(await popup.webContents.executeJavaScript('typeof require'), 'undefined');
    assert.equal(
      await popup.webContents.executeJavaScript('typeof window.atomicChat'),
      'undefined',
    );
    assert.equal(
      await popup.webContents.executeJavaScript(
        'document.documentElement.scrollHeight <= innerHeight',
      ),
      true,
    );
    preferences.theme = 'atomic-light';
    background.syncPreferences();
    assert.equal(
      await popup.webContents.executeJavaScript('document.querySelectorAll("button").length'),
      2,
    );
    background.markUnread();
    assert.equal(
      (await popup.webContents.executeJavaScript('window.trayMenu.getState()')).unread,
      true,
    );
    main.close();
    assert.equal(main.isDestroyed(), false);
    assert.deepEqual(cleanedSenders, []);
    background.dispose();
    const destroyed = new Promise((resolve) => main.webContents.once('destroyed', resolve));
    main.destroy();
    await destroyed;
    assert.deepEqual(cleanedSenders, [mainSenderId]);
    console.log(
      'PASS: compact tray menu, isolated preload, layout, unread, close-to-tray and window cleanup',
    );
    app.exit(0);
  })
  .catch((error) => {
    console.error(error);
    app.exit(1);
  });
