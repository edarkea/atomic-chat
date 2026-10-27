function isAuthorizedSender(
  event,
  BrowserWindow,
  expectedFileUrl,
  expectedDevUrl
) {
  const frame = event.senderFrame;
  const window = BrowserWindow.fromWebContents(event.sender);

  if (!window || !frame || frame !== event.sender.mainFrame) {
    return false;
  }

  // Autorizar exclusivamente el index.html de Atomic Chat
  // y su URL de directorio, observada en el Renderer.
  const expectedDirectoryUrl = new URL('.', expectedFileUrl).href;

  const allowedUrls = new Set([
    expectedFileUrl,
    expectedDirectoryUrl,
  ]);

  if (expectedDevUrl) {
    allowedUrls.add(expectedDevUrl);
  }

  return allowedUrls.has(frame.url);
}

module.exports = { isAuthorizedSender };
