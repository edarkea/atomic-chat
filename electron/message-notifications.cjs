const MAX_SEEN_MESSAGES = 2048;
const MAX_ACTIVE_NOTIFICATIONS = 100;
const MAX_PREVIEW_LENGTH = 160;

function sameJid(left, right) {
  if (!left || !right) return false;
  return String(left).split('/')[0].toLowerCase() === String(right).split('/')[0].toLowerCase();
}

function sameOccupant(left, right) {
  if (!left || !right) return false;
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function cleanText(value, maxLength = MAX_PREVIEW_LENGTH) {
  if (typeof value !== 'string') return '';
  const normalized = value
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  const characters = Array.from(normalized);
  return characters.length > maxLength
    ? `${characters.slice(0, maxLength - 1).join('')}…`
    : normalized;
}

function displayNameFromRoster(roster, senderJid) {
  const bareJid = String(senderJid || '')
    .split('/')[0]
    .toLowerCase();
  const contact = roster?.get?.(bareJid) || roster?.get?.(senderJid);
  return cleanText(contact?.name) || cleanText(senderJid, 128);
}

function mucNickname(occupantJid) {
  const parts = String(occupantJid || '').split('/');
  return cleanText(parts.slice(1).join('/') || parts[0], 128);
}

function createMessageNotifications({
  Notification,
  BrowserWindow,
  getPreferences,
  getRoster,
  getMucRoom,
  getIconPath,
}) {
  const seenMessages = new Set();
  const activeNotifications = new Set();

  function isSupported() {
    try {
      return Boolean(Notification && Notification.isSupported?.());
    } catch {
      return false;
    }
  }

  function isWindowFocused() {
    try {
      return Boolean(
        BrowserWindow?.getAllWindows?.().some(
          (window) => !window.isDestroyed() && window.isFocused(),
        ),
      );
    } catch {
      return false;
    }
  }

  function notificationsEnabled() {
    try {
      return getPreferences?.()?.notifications !== false;
    } catch {
      return true;
    }
  }

  function rememberMessage(identity) {
    if (!identity || seenMessages.has(identity)) return false;
    seenMessages.add(identity);
    if (seenMessages.size > MAX_SEEN_MESSAGES)
      seenMessages.delete(seenMessages.values().next().value || '');
    return true;
  }

  function retainNotification(notification) {
    activeNotifications.add(notification);
    if (typeof notification?.on === 'function')
      notification.on('close', () => activeNotifications.delete(notification));
    if (activeNotifications.size > MAX_ACTIVE_NOTIFICATIONS)
      activeNotifications.delete(activeNotifications.values().next().value);
  }

  function show(title, body) {
    if (!title || !body || !isSupported() || isWindowFocused() || !notificationsEnabled())
      return false;
    try {
      const icon = getIconPath?.();
      const notification = new Notification({
        title,
        body,
        ...(icon ? { icon } : {}),
      });
      retainNotification(notification);
      notification.show();
      return true;
    } catch {
      return false;
    }
  }

  function directMessage(event) {
    const message = event.payload;
    if (
      !message ||
      typeof message.accountId !== 'string' ||
      typeof message.conversationId !== 'string' ||
      typeof message.senderJid !== 'string' ||
      message.body?.kind !== 'text' ||
      typeof message.body.text !== 'string' ||
      !message.body.text.trim() ||
      typeof message.id !== 'string' ||
      typeof message.clientMessageId !== 'string' ||
      sameJid(message.senderJid, message.accountId)
    )
      return false;
    const identity = `${message.accountId}|direct|${message.clientMessageId || message.id || ''}`;
    if (!rememberMessage(identity)) return false;
    const title = displayNameFromRoster(getRoster?.(message.accountId), message.senderJid);
    return show(title, cleanText(message.body.text));
  }

  function mucMessage(event) {
    const message = event.payload;
    if (
      !message ||
      message.source !== 'live' ||
      typeof message.accountId !== 'string' ||
      typeof message.roomJid !== 'string' ||
      typeof message.occupantJid !== 'string' ||
      message.body?.kind !== 'text' ||
      typeof message.body.text !== 'string' ||
      !message.body.text.trim() ||
      typeof message.id !== 'string' ||
      !Number.isInteger(message.sessionGeneration) ||
      message.sessionGeneration < 1
    )
      return false;
    const room = getMucRoom?.(message.accountId, message.roomJid);
    const currentGeneration = room?.generation ?? room?.state?.sessionGeneration;
    if (
      !room ||
      room.active === false ||
      message.sessionGeneration !== currentGeneration ||
      sameOccupant(message.occupantJid, room.state?.selfOccupantJid)
    )
      return false;
    const identity = `${message.accountId}|muc|${message.roomJid}|${message.clientMessageId || message.id || ''}`;
    if (!rememberMessage(identity)) return false;
    const title = mucNickname(message.occupantJid);
    const body = `Sala ${cleanText(message.roomJid, 128)}: ${cleanText(message.body.text)}`;
    return show(title, body);
  }

  function handle(event) {
    try {
      if (!event || typeof event !== 'object') return false;
      if (event.type === 'message.received') return directMessage(event);
      if (event.type === 'muc.messageReceived') return mucMessage(event);
      return false;
    } catch {
      return false;
    }
  }

  return { handle };
}

module.exports = {
  createMessageNotifications,
  cleanText,
};
