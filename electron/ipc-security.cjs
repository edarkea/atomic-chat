function isAuthorizedSender(event, BrowserWindow, expectedFileUrl, expectedDevUrl) {
  const frame = event.senderFrame;
  const window = BrowserWindow.fromWebContents(event.sender);
  const mainFrame = event.sender.mainFrame;
  const sameMainFrame = frame === mainFrame || (frame?.frameTreeNodeId !== undefined && frame.frameTreeNodeId === mainFrame?.frameTreeNodeId);
  return Boolean(window && sameMainFrame && (frame?.url === expectedFileUrl || frame?.url === expectedDevUrl));
}

module.exports = { isAuthorizedSender };
