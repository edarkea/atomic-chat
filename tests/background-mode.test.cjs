const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { createBackgroundMode, badgeImage } = require('../electron/background-mode.cjs');

function setup({ closeToTray = true, trayFails = false } = {}) {
  const windows = [];
  const trays = [];
  class Window extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.visible = true;
      this.destroyed = false;
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = {
        url: pathToFileURL(path.resolve('electron/tray-menu.html')).href,
      };
      this.webContents.send = () => {};
      this.webContents.setWindowOpenHandler = (handler) => {
        this.openHandler = handler;
      };
      windows.push(this);
    }
    isDestroyed() {
      return this.destroyed;
    }
    isVisible() {
      return this.visible;
    }
    isMinimized() {
      return false;
    }
    show() {
      this.visible = true;
    }
    hide() {
      this.visible = false;
    }
    focus() {
      this.emit('focus');
    }
    removeMenu() {}
    setPosition() {}
    loadFile() {
      return Promise.resolve();
    }
    destroy() {
      this.destroyed = true;
      this.emit('closed');
    }
  }
  class Tray extends EventEmitter {
    constructor() {
      super();
      if (trayFails) throw new Error('unavailable');
      trays.push(this);
    }
    setImage(image) {
      this.image = image;
    }
    setToolTip(tooltip) {
      this.tooltip = tooltip;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  const bitmap = Buffer.alloc(24 * 24 * 4);
  const normal = {
    resize: () => normal,
    isEmpty: () => false,
    toBitmap: () => Buffer.from(bitmap),
  };
  const nativeImage = { createFromPath: () => normal, createFromBitmap: (bytes) => bytes };
  const app = new EventEmitter();
  app.quitCalls = 0;
  app.quit = () => {
    app.quitCalls++;
    app.emit('before-quit');
  };
  const preferences = { closeToTray, theme: 'atomic' };
  const handlers = new Map();
  const events = [];
  const xmpp = {
    sessions: new Map([['juan@test.invalid', {}]]),
    states: new Map([['juan@test.invalid', { status: 'connected' }]]),
    setPresence: async (accountId, presence) => ({ jid: accountId, ...presence }),
    emit: (event) => events.push(event),
  };
  const service = createBackgroundMode({
    app,
    BrowserWindow: Window,
    Tray,
    nativeImage,
    screen: {
      getCursorScreenPoint: () => ({ x: 100, y: 100 }),
      getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1000, height: 800 } }),
    },
    ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    getPreferences: () => preferences,
    getXmpp: () => xmpp,
    iconPath: 'test.png',
    logger: { warn() {} },
  });
  const window = new Window();
  service.attach(window);
  function close() {
    let prevented = false;
    window.emit('close', {
      preventDefault: () => {
        prevented = true;
      },
    });
    return prevented;
  }
  function openMenu() {
    trays.at(-1).emit('right-click');
    const menu = windows.at(-1);
    return { menu, event: { sender: menu.webContents, senderFrame: menu.webContents.mainFrame } };
  }
  return {
    service,
    window,
    trays,
    preferences,
    handlers,
    app,
    xmpp,
    events,
    close,
    openMenu,
    nativeImage,
    normal,
  };
}

test('closing to tray preserves the window, badges incoming messages and clears on opening', () => {
  const { service, window, trays, close, app } = setup();
  service.markUnread();
  assert.equal(trays[0].tooltip, 'Atomic Chat');
  assert.equal(close(), true);
  assert.equal(window.isVisible(), false);
  assert.equal(app.quitCalls, 0);
  service.markUnread();
  assert.match(trays[0].tooltip, /mensajes nuevos/);
  trays[0].emit('click');
  assert.equal(window.isVisible(), true);
  assert.equal(trays[0].tooltip, 'Atomic Chat');
});

test('closing exits with preference disabled or unavailable system tray', () => {
  for (const options of [{ closeToTray: false }, { trayFails: true }]) {
    const { app, close } = setup(options);
    close();
    assert.equal(app.quitCalls, 1);
    assert.equal(close(), false, 'a real quit must never be intercepted again');
  }
});

test('preference changes create/destroy tray and themed menu securely', async () => {
  const { preferences, service, trays, openMenu, handlers } = setup({ closeToTray: false });
  assert.equal(trays.length, 0);
  preferences.closeToTray = true;
  service.syncPreferences();
  const { menu, event } = openMenu();
  assert.deepEqual(menu.options.webPreferences, {
    preload: path.resolve('electron/tray-preload.cjs'),
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
  });
  assert.deepEqual(menu.openHandler(), { action: 'deny' });
  assert.throws(() => handlers.get('tray.getState')({ ...event, sender: {} }), /UNAUTHORIZED/);
  assert.throws(
    () => handlers.get('tray.getState')({ ...event, senderFrame: { url: event.senderFrame.url } }),
    /UNAUTHORIZED/,
  );
  const originalUrl = event.senderFrame.url;
  event.senderFrame.url = 'https://example.invalid/';
  assert.throws(() => handlers.get('tray.getState')(event), /UNAUTHORIZED/);
  event.senderFrame.url = originalUrl;
  await assert.rejects(handlers.get('tray.action')(event, '__proto__'), /INVALID_INPUT/);
  preferences.closeToTray = false;
  service.syncPreferences();
  assert.equal(trays[0].destroyed, true);
  assert.equal(menu.isDestroyed(), true);
});

test('badge paints a red dot while retaining the base icon', () => {
  const { nativeImage, normal } = setup();
  const bitmap = badgeImage(nativeImage, normal);
  assert.deepEqual([...bitmap.subarray(0, 4)], [0, 0, 0, 0]);
  const center = (19 * 24 + 19) * 4;
  assert.deepEqual([...bitmap.subarray(center, center + 4)], [54, 54, 240, 255]);
});
