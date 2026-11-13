const path = require('node:path');
const os = require('node:os');
const fsp = require('node:fs/promises');

const DROPPED_FILE_SOURCE = 'preload-webutils-file-v1';
const CLIPBOARD_FILE_SOURCE = 'preload-clipboard-file-v1';
const MAX_CLIPBOARD_FILE_BYTES = 128 * 1024 * 1024;

function registerFileHandlers({
  ipcMain,
  assertSender,
  getRuntime,
  fileTransfers,
  outgoingFileTransfers,
  localFileActions,
  historySecurity,
  selectFileSource,
  helpers,
}) {
  const { requestId, validVersion, authorizeFileInput, fileResultError } = helpers;

  const authorizeSendInput = (event, input) => {
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
  };

  // Request IDs represent intentions, not file content. Keep pending requests pinned
  // and a bounded window of completed results, including cancellations and errors.
  const sendRequests = new Map();
  const registerSendHandler = (channel, handler) => {
    ipcMain.handle(channel, async (event, input) => {
      try {
        authorizeSendInput(event, input);
        const key = JSON.stringify([event.sender.id, input.accountId, input.requestId]);
        const previous = sendRequests.get(key);
        if (previous) {
          if (previous.channel !== channel || previous.conversationId !== input.conversationId)
            throw new Error('CONFLICT');
          return await previous.result;
        }
        if (sendRequests.size >= 256) {
          const oldest = [...sendRequests].find(([, entry]) => entry.settled);
          if (!oldest) throw new Error('RESOURCE_CONSTRAINT');
          sendRequests.delete(oldest[0]);
        }
        const { xmpp } = getRuntime();
        const scope = {
          session: xmpp.sessions.get(input.accountId),
          generation: xmpp.sessionGenerations?.get(input.accountId),
        };
        const entry = { channel, conversationId: input.conversationId, settled: false };
        entry.result = Promise.resolve()
          .then(() => handler(event, input, scope))
          .catch((error) => fileResultError(error, event, input))
          .finally(() => {
            entry.settled = true;
          });
        sendRequests.set(key, entry);
        return await entry.result;
      } catch (error) {
        return fileResultError(error, event, input);
      }
    });
  };

  const sendFileFromPath = async (event, input, filePath, scope) => {
    authorizeSendInput(event, input);
    if (typeof filePath !== 'string' || !filePath.trim()) throw new Error('INVALID_INPUT');
    const { xmpp } = getRuntime();
    if (
      !xmpp.sessions.has(input.accountId) ||
      xmpp.sessions.get(input.accountId) !== scope.session ||
      xmpp.sessionGenerations?.get(input.accountId) !== scope.generation ||
      xmpp.states.get(input.accountId)?.status !== 'connected'
    )
      throw new Error('NOT_CONNECTED');
    const value = await xmpp.sendFile(input.accountId, {
      filePath,
      fileName: path.basename(filePath),
      conversationId: input.conversationId,
      ownerSenderId: event.sender.id,
    });
    return { ok: true, value, version: 1, requestId: input.requestId };
  };

  const authorizeLocalAction = (event, input) => {
    assertSender(event);
    if (
      !validVersion(input) ||
      typeof input.requestId !== 'string' ||
      !input.requestId.trim() ||
      typeof input.accountId !== 'string' ||
      !input.accountId.trim() ||
      typeof input.transferId !== 'string' ||
      !input.transferId.trim()
    )
      throw new Error('INVALID_INPUT');
    if (!historySecurity.authorize(event.sender.id, input.accountId))
      throw new Error('UNAUTHORIZED');
    if (!localFileActions) throw new Error('UNSUPPORTED');
    return input;
  };

  registerSendHandler('file.send', async (event, input, scope) => {
    try {
      authorizeSendInput(event, input);
      const filePath = await selectFileSource();
      if (!filePath) return { ok: true, value: null, version: 1, requestId: input.requestId };
      return await sendFileFromPath(event, input, filePath, scope);
    } catch (error) {
      return fileResultError(error, event, input);
    }
  });
  registerSendHandler('file.sendDropped', async (event, input, scope) => {
    try {
      if (input?.source !== DROPPED_FILE_SOURCE) throw new Error('INVALID_INPUT');
      return await sendFileFromPath(event, input, input?.filePath, scope);
    } catch (error) {
      return fileResultError(error, event, input);
    }
  });
  registerSendHandler('file.sendClipboard', async (event, input, scope) => {
    let temporaryDirectory;
    try {
      if (input?.source !== CLIPBOARD_FILE_SOURCE) throw new Error('INVALID_INPUT');
      authorizeSendInput(event, input);
      if (
        typeof input.fileName !== 'string' ||
        !input.fileName.trim() ||
        input.fileName.length > 512 ||
        input.fileName !== path.basename(input.fileName) ||
        input.fileName.includes('\0')
      )
        throw new Error('INVALID_INPUT');
      if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0)
        throw new Error('INVALID_INPUT');
      if (input.sizeBytes > MAX_CLIPBOARD_FILE_BYTES) throw new Error('MEDIA_SIZE_EXCEEDED');
      const bytes = Buffer.isBuffer(input.bytes)
        ? input.bytes
        : input.bytes instanceof Uint8Array
          ? Buffer.from(input.bytes)
          : null;
      if (!bytes || bytes.length > MAX_CLIPBOARD_FILE_BYTES) throw new Error('MEDIA_SIZE_EXCEEDED');
      if (bytes.length !== input.sizeBytes) throw new Error('INVALID_INPUT');
      temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'atomic-chat-clipboard-'));
      const filePath = path.join(temporaryDirectory, input.fileName);
      await fsp.writeFile(filePath, bytes, { flag: 'wx' });
      return await sendFileFromPath(event, input, filePath, scope);
    } catch (error) {
      return fileResultError(error, event, input);
    } finally {
      if (temporaryDirectory) await fsp.rm(temporaryDirectory, { recursive: true, force: true });
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
  ipcMain.handle('file.open', async (event, input) => {
    try {
      const request = authorizeLocalAction(event, input);
      await localFileActions.open(event.sender.id, request);
      return { ok: true, value: undefined, version: 1, requestId: request.requestId };
    } catch (error) {
      return fileResultError(error, event, input);
    }
  });
  ipcMain.handle('file.reveal', async (event, input) => {
    try {
      const request = authorizeLocalAction(event, input);
      await localFileActions.reveal(event.sender.id, request);
      return { ok: true, value: undefined, version: 1, requestId: request.requestId };
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
