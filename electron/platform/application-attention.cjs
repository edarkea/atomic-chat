function createApplicationAttention({ BrowserWindow, app }) {
  const requestedAccounts = new Set();
  let dockBounceId;

  function clearNative() {
    BrowserWindow.getAllWindows().forEach((window) => {
      if (!window.isDestroyed()) window.flashFrame(false);
    });
    if (typeof app.dock?.cancelBounce === 'function' && dockBounceId !== undefined) {
      app.dock.cancelBounce(dockBounceId);
      dockBounceId = undefined;
    }
  }

  function acknowledge() {
    requestedAccounts.clear();
    clearNative();
  }

  function request(accountId) {
    const windows = BrowserWindow.getAllWindows();
    if (windows.some((window) => !window.isDestroyed() && window.isFocused())) return false;
    if (requestedAccounts.has(accountId)) return false;
    requestedAccounts.add(accountId);
    windows.forEach((window) => {
      if (!window.isDestroyed()) window.flashFrame(true);
    });
    if (typeof app.dock?.bounce === 'function') dockBounceId = app.dock.bounce('informational');
    return true;
  }

  function clear(accountId) {
    requestedAccounts.delete(accountId);
    if (requestedAccounts.size === 0) clearNative();
  }

  return { request, clear, acknowledge };
}

module.exports = { createApplicationAttention };
