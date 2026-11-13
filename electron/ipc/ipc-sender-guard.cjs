const { isAuthorizedSender } = require('./ipc-security.cjs');

/** @typedef {{url: string}} FrameLike */
/** @typedef {{mainFrame: FrameLike}} SenderLike */
/** @typedef {{sender: SenderLike, senderFrame?: FrameLike}} IpcEventLike */
/** @typedef {{fromWebContents: (sender: SenderLike) => object | null}} BrowserWindowLike */

/**
 * @param {{BrowserWindow: BrowserWindowLike, packagedUrl: string, devUrl?: string}} options
 */
function createIpcSenderGuard({ BrowserWindow, packagedUrl, devUrl = '' }) {
  /** @param {IpcEventLike} event */
  return function assertSender(event) {
    if (!isAuthorizedSender(event, BrowserWindow, packagedUrl, devUrl))
      throw new Error('UNAUTHORIZED');
  };
}

module.exports = { createIpcSenderGuard };
