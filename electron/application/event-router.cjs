/** @typedef {{isDestroyed: () => boolean, send: (channel: string, payload: unknown) => void}} WebContentsLike */
/** @typedef {{webContents: WebContentsLike}} BrowserWindowLike */
/** @typedef {{getAllWindows: () => BrowserWindowLike[]}} BrowserWindowModuleLike */
/** @typedef {{fromId: (id: number) => WebContentsLike | null}} WebContentsModuleLike */
/** @typedef {{type: string, payload: unknown, correlationId?: string, targetSenderId?: number}} RoutedEvent */

/**
 * @param {{BrowserWindow: BrowserWindowModuleLike, webContents: WebContentsModuleLike}} options
 */
function createEventRouter({ BrowserWindow, webContents }) {
  /** @param {WebContentsLike | null} target @param {RoutedEvent} event @param {boolean} includeCorrelationId */
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

  /** @param {RoutedEvent} event */
  function forwardTransferEvent(event) {
    const target = event.targetSenderId ? webContents.fromId(event.targetSenderId) : null;
    send(target, event, false);
  }

  /** @param {RoutedEvent} event */
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
