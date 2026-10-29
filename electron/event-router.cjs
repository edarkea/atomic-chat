function createEventRouter({ BrowserWindow, webContents }) {
  function send(target, event, includeCorrelationId) {
    if (!target || target.isDestroyed()) return;
    target.send('domain.event', {
      version: 1,
      eventId: `evt_${Date.now()}`,
      ...(includeCorrelationId ? { correlationId: event.correlationId } : {}),
      type: event.type,
      payload: event.payload,
    });
  }

  function forwardTransferEvent(event) {
    const target = event.targetSenderId ? webContents.fromId(event.targetSenderId) : null;
    send(target, event, false);
  }

  function forwardXmppEvent(event) {
    const { targetSenderId, ...publicEvent } = event;
    if (publicEvent.type.startsWith('file.') && !targetSenderId) return;
    const targets = targetSenderId
      ? [webContents.fromId(targetSenderId)].filter(Boolean)
      : BrowserWindow.getAllWindows().map((window) => window.webContents);
    targets.forEach((target) => send(target, publicEvent, true));
  }

  return { forwardTransferEvent, forwardXmppEvent };
}

module.exports = { createEventRouter };
