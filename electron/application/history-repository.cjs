function createHistoryRepository(runtime) {
  const persistence = runtime?.persistence;
  if (!persistence) throw new Error('STORAGE_FAILED');

  return {
    listMessages: (accountId, conversationId) =>
      persistence.listMessages(accountId, conversationId),
    listMessagesPage: (accountId, conversationId, limit, direction, cursor) =>
      persistence.listMessagesPage(accountId, conversationId, limit, direction, cursor),
    searchMessages: (accountId, query, conversationId, limit, cursor) =>
      persistence.searchMessages(accountId, query, conversationId, limit, cursor),
    listMessagesAround: (accountId, conversationId, messageId, createdAt, limit) =>
      persistence.listMessagesAround(accountId, conversationId, messageId, createdAt, limit),
    listTimelinePage: (accountId, conversationId, limit, direction, cursor) =>
      persistence.listTimelinePage(accountId, conversationId, limit, direction, cursor),
    listConversations: (accountId) => persistence.listConversations(accountId),
    listMedia: (accountId, conversationId, limit) => {
      if (!runtime.media || typeof runtime.media.list !== 'function')
        throw new Error('STORAGE_FAILED');
      return runtime.media.list(accountId, conversationId, limit);
    },
  };
}

module.exports = { createHistoryRepository };
