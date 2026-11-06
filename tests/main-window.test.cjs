const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createMainWindow } = require('../electron/main-window.cjs');

test('cleans up the original sender exactly once without accessing destroyed Electron objects', () => {
  const contents = new EventEmitter();
  let destroyed = false;
  Object.defineProperty(contents, 'id', {
    get() {
      if (destroyed) throw new TypeError('Object has been destroyed');
      return 42;
    },
  });
  class Window {
    get webContents() {
      if (destroyed) throw new TypeError('Object has been destroyed');
      return contents;
    }
    removeMenu() {}
    loadFile() {}
  }
  const cleaned = [];
  createMainWindow({
    BrowserWindow: Window,
    preloadPath: 'preload.cjs',
    productionHtmlPath: 'index.html',
    onDestroyed: (senderId) => cleaned.push(senderId),
  });
  destroyed = true;
  assert.doesNotThrow(() => contents.emit('destroyed'));
  contents.emit('destroyed');
  assert.deepEqual(cleaned, [42]);
});
