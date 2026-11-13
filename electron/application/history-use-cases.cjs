const { createHistoryRepository } = require('./history-repository.cjs');

function invalidInput() {
  throw new Error('INVALID_INPUT');
}

function requireConversationId(value) {
  if (typeof value !== 'string' || !value.trim()) invalidInput();
  return value;
}

function requirePageInput(input) {
  requireConversationId(input.conversationId);
  if (
    !['older', 'newer'].includes(input.direction) ||
    !Number.isInteger(input.limit) ||
    input.limit < 1 ||
    input.limit > 100
  )
    invalidInput();
}

function createHistoryUseCases({ getRuntime, historySecurity }) {
  const repository = () => {
    const runtime = getRuntime();
    return runtime.history || createHistoryRepository(runtime);
  };

  return {
    listMessages(input) {
      requireConversationId(input.conversationId);
      return repository().listMessages(input.accountId, input.conversationId);
    },

    pageMessages(input) {
      requirePageInput(input);
      const cursor =
        input.cursor == null
          ? null
          : historySecurity.decodeCursor(input.cursor, input.accountId, input.conversationId);
      const position = cursor ? cursor[input.direction === 'older' ? 'lower' : 'upper'] : null;
      const result = repository().listMessagesPage(
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
      return { ...result, nextCursor };
    },

    searchMessages(input) {
      if (
        typeof input.query !== 'string' ||
        !input.query.trim() ||
        input.query.length > 100 ||
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 50 ||
        !input.scope ||
        !['all', 'conversation'].includes(input.scope.kind) ||
        (input.scope.kind === 'conversation' &&
          (typeof input.scope.conversationId !== 'string' || !input.scope.conversationId.trim()))
      )
        invalidInput();
      const conversationId =
        input.scope.kind === 'conversation'
          ? input.scope.conversationId.trim().split('/')[0].toLowerCase()
          : null;
      const scopeKey = conversationId ? `conversation:${conversationId}` : 'all';
      const cursor =
        input.cursor == null
          ? null
          : historySecurity.decodeSearchCursor(
              input.cursor,
              input.accountId,
              input.query,
              scopeKey,
            );
      const result = repository().searchMessages(
        input.accountId,
        input.query,
        conversationId,
        input.limit,
        cursor,
      );
      const last = result.items[result.items.length - 1];
      return {
        items: result.items,
        nextCursor:
          last && result.hasMore
            ? historySecurity.encodeSearchCursor({
                accountId: input.accountId,
                query: input.query,
                scopeKey,
                createdAt: last.createdAt,
                id: last.messageId,
              })
            : null,
        hasMore: result.hasMore,
      };
    },

    messagesAround(input) {
      if (
        typeof input.conversationId !== 'string' ||
        !input.conversationId.trim() ||
        typeof input.messageId !== 'string' ||
        !input.messageId.trim() ||
        typeof input.createdAt !== 'string' ||
        !Number.isInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > 100
      )
        invalidInput();
      const conversationId = input.conversationId.trim().split('/')[0].toLowerCase();
      return repository().listMessagesAround(
        input.accountId,
        conversationId,
        input.messageId,
        input.createdAt,
        input.limit,
      );
    },

    async timelinePage(input) {
      requirePageInput(input);
      const cursor =
        input.cursor == null
          ? null
          : historySecurity.decodeCursor(input.cursor, input.accountId, input.conversationId);
      const position = cursor ? cursor[input.direction === 'older' ? 'lower' : 'upper'] : null;
      const result = repository().listTimelinePage(
        input.accountId,
        input.conversationId,
        input.limit,
        input.direction,
        position,
      );
      const runtime = getRuntime();
      const items = runtime.fileHistory
        ? await runtime.fileHistory.refreshTimeline(result.items)
        : result.items;
      const first = items[0];
      const last = items[items.length - 1];
      const nextCursor =
        first && last
          ? historySecurity.encodeCursor({
              accountId: input.accountId,
              conversationId: input.conversationId,
              lower: { createdAt: first.sortAt, id: first.id },
              upper: { createdAt: last.sortAt, id: last.id },
            })
          : null;
      return { ...result, items, nextCursor };
    },

    listConversations(input) {
      return repository().listConversations(input.accountId);
    },

    listMedia(input) {
      if (
        input.conversationId !== undefined &&
        (typeof input.conversationId !== 'string' || !input.conversationId.trim())
      )
        invalidInput();
      const limit = input.limit === undefined ? 50 : input.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalidInput();
      return repository().listMedia(input.accountId, input.conversationId, limit);
    },
  };
}

module.exports = { createHistoryUseCases };
