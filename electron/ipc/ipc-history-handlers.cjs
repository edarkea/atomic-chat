const { createHistoryUseCases } = require('../application/history-use-cases.cjs');

function registerHistoryHandlers({ ipcMain, assertSender, getRuntime, historySecurity, helpers }) {
  const { requestId, authorizeHistoryInput, historyError } = helpers;
  const useCases = createHistoryUseCases({ getRuntime, historySecurity });

  const success = (event, input, value) => ({
    ok: true,
    value,
    version: 1,
    requestId: requestId(event, input),
  });

  const register = (channel, operation) => {
    ipcMain.handle(channel, (event, input) => {
      assertSender(event);
      try {
        authorizeHistoryInput(event, input);
        return success(event, input, operation(input));
      } catch (error) {
        return historyError(error, event, input);
      }
    });
  };

  register('messages.list', (input) => useCases.listMessages(input));
  register('messages.page', (input) => useCases.pageMessages(input));
  register('messages.search', (input) => useCases.searchMessages(input));
  register('messages.around', (input) => useCases.messagesAround(input));

  ipcMain.handle('timeline.page', async (event, input) => {
    assertSender(event);
    try {
      authorizeHistoryInput(event, input);
      return success(event, input, await useCases.timelinePage(input));
    } catch (error) {
      return historyError(error, event, input);
    }
  });

  register('conversations.list', (input) => useCases.listConversations(input));
  register('media.list', (input) => useCases.listMedia(input));
}

module.exports = { registerHistoryHandlers };
