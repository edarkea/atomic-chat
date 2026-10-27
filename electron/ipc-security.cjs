function isAuthorizedSender(event, BrowserWindow, expectedFileUrl, expectedDevUrl) {
  const frame = event.senderFrame;
  const window = BrowserWindow.fromWebContents(event.sender);
  return Boolean(window && frame === event.sender.mainFrame && (frame.url === expectedFileUrl || frame.url === expectedDevUrl));
}

module.exports = { isAuthorizedSender };
