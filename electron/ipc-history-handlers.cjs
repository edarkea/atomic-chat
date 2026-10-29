function registerHistoryHandlers({ ipcMain, assertSender, getRuntime, historySecurity, helpers }) {
  const { requestId, authorizeHistoryInput, historyError } = helpers;

  ipcMain.handle('messages.list', (event, input) => {
    assertSender(event);
    try {
      authorizeHistoryInput(event, input);
      if (typeof input.conversationId !== 'string' || !input.conversationId.trim())
        throw new Error('INVALID_INPUT');
      return {
        ok: true,
        value: getRuntime().persistence.listMessages(input.accountId, input.conversationId),
        version: 1,
        requestId: requestId(event, input),
      };
    } catch (error) {
      return historyError(error, event, input);
    }
  });
  ipcMain.handle('messages.page', (event, input) => {
    assertSender(event);
    try {
      authorizeHistoryInput(event, input);
      if (
        typeof input.conversationId !== 'string' ||
        !input.conversationId.trim() ||
        !['older', 'newer'].includes(input.direction) ||
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 100
      )
        throw new Error('INVALID_INPUT');
      const cursor =
        input.cursor == null
          ? null
          : historySecurity.decodeCursor(input.cursor, input.accountId, input.conversationId);
      const position = cursor ? cursor[input.direction === 'older' ? 'lower' : 'upper'] : null;
      const result = getRuntime().persistence.listMessagesPage(
        input.accountId,
        input.conversationId,
        input.limit,
        input.direction,
        position,
      );
      const first = result.items[0];
      const last = result.items[result.items.length - 1];
      const nextCursor =
        first && last
          ? historySecurity.encodeCursor({
              accountId: input.accountId,
              conversationId: input.conversationId,
              lower: { createdAt: first.createdAt, id: first.id },
              upper: { createdAt: last.createdAt, id: last.id },
            })
          : null;
      return {
        ok: true,
        value: { ...result, nextCursor },
        version: 1,
        requestId: input.requestId,
      };
    } catch (error) {
      return historyError(error, event, input);
    }
  });
  ipcMain.handle('conversations.list', (event, input) => {
    assertSender(event);
    try {
      authorizeHistoryInput(event, input);
      return {
        ok: true,
        value: getRuntime().persistence.listConversations(input.accountId),
        version: 1,
        requestId: requestId(event, input),
      };
    } catch (error) {
      return historyError(error, event, input);
    }
  });
}

module.exports = { registerHistoryHandlers };
