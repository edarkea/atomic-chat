const path = require('node:path');

function registerFileHandlers({
  ipcMain,
  assertSender,
  getRuntime,
  fileTransfers,
  outgoingFileTransfers,
  historySecurity,
  selectFileSource,
  helpers,
}) {
  const { requestId, validVersion, authorizeFileInput, fileResultError } = helpers;

  ipcMain.handle('file.send', async (event, input) => {
    try {
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
      if (!historySecurity.authorize(event.sender.id, input.accountId))
        throw new Error('UNAUTHORIZED');
      const { xmpp } = getRuntime();
      if (
        !xmpp.sessions.has(input.accountId) ||
        xmpp.states.get(input.accountId)?.status !== 'connected'
      )
        throw new Error('NOT_CONNECTED');
      const filePath = await selectFileSource();
      if (!filePath) return { ok: true, value: null, version: 1, requestId: input.requestId };
      const value = await xmpp.sendFile(input.accountId, {
        filePath,
        fileName: path.basename(filePath),
        conversationId: input.conversationId,
        ownerSenderId: event.sender.id,
      });
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return fileResultError(error, event, input);
    }
  });
  ipcMain.handle('file.accept', async (event, input) => {
    try {
      const record = authorizeFileInput(event, input);
      return {
        ok: true,
        value: await fileTransfers.accept(record.offer.transferId, event.sender.id),
        version: 1,
        requestId: input.requestId,
      };
    } catch (error) {
      return fileResultError(error, event, input);
    }
  });
  ipcMain.handle('file.reject', async (event, input) => {
    try {
      const record = authorizeFileInput(event, input);
      return {
        ok: true,
        value: await fileTransfers.reject(record.offer.transferId),
        version: 1,
        requestId: input.requestId,
      };
    } catch (error) {
      return fileResultError(error, event, input);
    }
  });
  ipcMain.handle('file.cancel', async (event, input) => {
    try {
      const record = authorizeFileInput(event, input);
      const value =
        record.direction === 'outgoing'
          ? await outgoingFileTransfers.cancel(record.offer.transferId)
          : await fileTransfers.cancel(record.offer.transferId);
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return fileResultError(error, event, input);
    }
  });
  ipcMain.handle('file.listActive', (event, input) => {
    try {
      assertSender(event);
      if (
        !validVersion(input) ||
        typeof input.requestId !== 'string' ||
        !input.requestId.trim() ||
        typeof input.accountId !== 'string' ||
        !input.accountId.trim() ||
        !historySecurity.authorize(event.sender.id, input.accountId)
      )
        throw new Error('UNAUTHORIZED');
      return {
        ok: true,
        value: [
          ...fileTransfers.list(input.accountId),
          ...outgoingFileTransfers.list(input.accountId),
        ],
        version: 1,
        requestId: input.requestId,
      };
    } catch (error) {
      return fileResultError(error, event, input);
    }
  });
}

module.exports = { registerFileHandlers };
