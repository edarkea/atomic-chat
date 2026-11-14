function createMainEventSources({
  BrowserWindow,
  webContents,
  createEventRouter,
  createIncomingMessageProcessor,
  getRuntime,
  fileTransfers,
  outgoingFileTransfers,
  backgroundMode,
  autoAcceptFileTransfers,
  messageNotifications,
  gameEventPublisher,
}) {
  return {
    attach() {
      const runtime = getRuntime();

      const eventRouter = createEventRouter({ BrowserWindow, webContents });
      const processIncomingMessage = createIncomingMessageProcessor({
        persistence: runtime.persistence,
        onPersistenceError: (error) =>
          console.error(
            '[PERSISTENCE] Could not save incoming message:',
            error?.message || 'STORAGE_FAILED',
          ),
      });
      runtime.media.onEvent((event) => eventRouter.forwardTransferEvent(event));
      fileTransfers.onEvent((event) => {
        eventRouter.forwardTransferEvent(event);
        if (event.type === 'file.offerReceived') backgroundMode.markUnread();
        if (event.type !== 'file.offerReceived' || !autoAcceptFileTransfers()) return;
        void fileTransfers
          .accept(event.payload.transferId, event.targetSenderId)
          .catch((error) =>
            console.warn(
              '[FILE TRANSFER] Automatic acceptance failed:',
              error.code || error.message,
            ),
          );
      });
      outgoingFileTransfers.onEvent(eventRouter.forwardTransferEvent);
      runtime.xmpp.onEvent((event) => {
        if (event.type.startsWith('game.')) {
          gameEventPublisher?.publish(event);
          return;
        }
        if (event.type === 'connection.stateChanged') backgroundMode.updateMenu();
        if (event.type === 'reaction.changed') {
          try {
            runtime.persistence.saveReaction(event.payload);
          } catch (error) {
            console.error(
              '[REACTION_PERSISTENCE] Could not save reaction state:',
              error?.message || 'STORAGE_FAILED',
            );
          }
          eventRouter.forwardXmppEvent(event);
          return;
        }
        if (event.type === 'reaction.rejected') {
          eventRouter.forwardXmppEvent(event);
          return;
        }
        if (event.type === 'sticker.messageReceived') {
          try {
            const persisted = runtime.stickerMessages.save(event.payload);
            if (persisted.direction === 'incoming') backgroundMode.markUnread();
            eventRouter.forwardXmppEvent({ type: event.type, payload: persisted });
            const accountId = persisted.accountId;
            const generation = runtime.xmpp.sessionGenerations.get(accountId) || 0;
            const isAuthorizedSource = () =>
              runtime.xmpp.sessionGenerations.get(accountId) === generation &&
              runtime.xmpp.isStickerSourceAuthorized(accountId, persisted.senderJid);
            if (isAuthorizedSource()) {
              void runtime.stickerMessages
                .load(accountId, persisted.refId, isAuthorizedSource)
                .then((loaded) =>
                  eventRouter.forwardXmppEvent({ type: 'sticker.stateChanged', payload: loaded }),
                )
                .catch((error) => {
                  if (error?.code === 'UNAUTHORIZED') return;
                  const failed = runtime.persistence.markStickerMessageUnavailable(
                    accountId,
                    persisted.refId,
                    error?.code || 'MEDIA_PREVIEW_UNAVAILABLE',
                    new Date().toISOString(),
                  );
                  if (failed)
                    eventRouter.forwardXmppEvent({
                      type: 'sticker.stateChanged',
                      payload: runtime.stickerMessages.publicRef(failed),
                    });
                });
            }
          } catch (error) {
            console.error(
              '[STICKER] Could not save incoming sticker:',
              error?.message || 'STORAGE_FAILED',
            );
          }
          return;
        }
        const processed = processIncomingMessage(event);
        messageNotifications.handle(processed);
        eventRouter.forwardXmppEvent(processed);
      });
    },
  };
}

module.exports = { createMainEventSources };
