function createIncomingMessageProcessor({ persistence, onPersistenceError = () => undefined }) {
  return function process(event) {
    if (event?.type !== 'message.received') return event;
    const message = event.payload;
    const normalizedMessage = {
      ...message,
      classification: message?.classification === 'broadcast' ? 'broadcast' : 'direct',
    };
    if (
      !normalizedMessage?.id ||
      !normalizedMessage?.accountId ||
      !normalizedMessage?.conversationId ||
      !normalizedMessage?.clientMessageId ||
      !normalizedMessage?.senderJid ||
      !normalizedMessage?.body ||
      !normalizedMessage?.createdAt
    ) {
      onPersistenceError(new Error('INVALID_INPUT'), message);
      return {
        ...event,
        payload: { ...normalizedMessage, persistenceStatus: 'memory-only' },
      };
    }
    try {
      persistence.saveMessage(normalizedMessage);
      return { ...event, payload: { ...normalizedMessage, persistenceStatus: 'persisted' } };
    } catch (error) {
      onPersistenceError(error, message);
      return {
        ...event,
        payload: {
          ...normalizedMessage,
          persistenceStatus: 'memory-only',
          errorCode: 'STORAGE_FAILED',
        },
      };
    }
  };
}

module.exports = { createIncomingMessageProcessor };
