/** @typedef {{url: string}} FrameLike */
/** @typedef {{mainFrame: FrameLike}} SenderLike */
/** @typedef {{sender: SenderLike, senderFrame?: FrameLike}} IpcEventLike */
/** @typedef {{fromWebContents: (sender: SenderLike) => object | null}} BrowserWindowLike */

/**
 * @param {IpcEventLike} event
 * @param {BrowserWindowLike} BrowserWindow
 * @param {string} expectedFileUrl
 * @param {string} expectedDevUrl
 */
function isAuthorizedSender(event, BrowserWindow, expectedFileUrl, expectedDevUrl) {
  const frame = event.senderFrame;
  const window = BrowserWindow.fromWebContents(event.sender);

  if (!window || !frame || frame !== event.sender.mainFrame) {
    return false;
  }

  // Autorizar exclusivamente el index.html de Atomic Chat
  // y su URL de directorio, observada en el Renderer.
  const expectedDirectoryUrl = new URL('.', expectedFileUrl).href;

  const allowedUrls = new Set([expectedFileUrl, expectedDirectoryUrl]);

  if (expectedDevUrl) {
    allowedUrls.add(expectedDevUrl);
  }

  return allowedUrls.has(frame.url);
}

module.exports = { isAuthorizedSender };
