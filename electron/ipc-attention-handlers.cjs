function registerAttentionHandlers({ ipcMain, assertSender, historySecurity, applicationAttention, helpers }) {
  const { requestId, validVersion, requireText } = helpers;

  ipcMain.handle('attention.request', (event, input) => {
    assertSender(event);
    if (
      !validVersion(input) ||
      typeof input.requestId !== 'string' ||
      !input.requestId.trim() ||
      typeof input.accountId !== 'string' ||
      !input.accountId.trim() ||
      typeof input.conversationId !== 'string' ||
      !input.conversationId.trim()
    )
      throw new Error('INVALID_INPUT');
    requireText(input.accountId, 'ACCOUNT');
    requireText(input.conversationId, 'CONVERSATION');
    if (!historySecurity.authorize(event.sender.id, input.accountId)) throw new Error('UNAUTHORIZED');
    applicationAttention.request(input.accountId);
    return { ok: true, value: undefined, version: 1, requestId: requestId(event, input) };
  });

  ipcMain.handle('attention.clear', (event, input) => {
    assertSender(event);
    if (
      !validVersion(input) ||
      typeof input.requestId !== 'string' ||
      !input.requestId.trim() ||
      typeof input.accountId !== 'string' ||
      !input.accountId.trim()
    )
      throw new Error('INVALID_INPUT');
    if (!historySecurity.authorize(event.sender.id, input.accountId)) throw new Error('UNAUTHORIZED');
    applicationAttention.clear(input.accountId);
    return { ok: true, value: undefined, version: 1, requestId: requestId(event, input) };
  });
}

module.exports = { registerAttentionHandlers };
