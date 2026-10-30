function createIncomingMessageProcessor({ persistence, onPersistenceError = () => undefined }) {
  return function process(event) {
    if (event?.type !== 'message.received') return event;
    const message = event.payload;
    if (
      !message?.id ||
      !message?.accountId ||
      !message?.conversationId ||
      !message?.clientMessageId ||
      !message?.senderJid ||
      !message?.body ||
      !message?.createdAt
    ) {
      onPersistenceError(new Error('INVALID_INPUT'), message);
      return {
        ...event,
        payload: { ...message, persistenceStatus: 'memory-only' },
      };
    }
    try {
      persistence.saveMessage(message);
      return { ...event, payload: { ...message, persistenceStatus: 'persisted' } };
    } catch (error) {
      onPersistenceError(error, message);
      return {
        ...event,
        payload: {
          ...message,
          persistenceStatus: 'memory-only',
          errorCode: 'STORAGE_FAILED',
        },
      };
    }
  };
}

module.exports = { createIncomingMessageProcessor };
