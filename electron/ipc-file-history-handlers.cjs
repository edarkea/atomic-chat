function registerFileHistoryHandlers({
  ipcMain,
  assertSender,
  getRuntime,
  historySecurity,
  helpers,
}) {
  const { requestId, validVersion } = helpers;

  function authorize(event, input) {
    assertSender(event);
    if (
      !validVersion(input) ||
      typeof input.requestId !== 'string' ||
      !input.requestId.trim() ||
      typeof input.accountId !== 'string' ||
      !input.accountId.trim() ||
      typeof input.conversationId !== 'string' ||
      !input.conversationId.trim() ||
      typeof input.fileId !== 'string' ||
      !input.fileId.trim()
    )
      throw new Error('INVALID_INPUT');
    if (!historySecurity.authorize(event.sender.id, input.accountId))
      throw new Error('UNAUTHORIZED');
    return input;
  }

  function errorResult(error, event, input) {
    const raw = error?.code || error?.message;
    const code = ['INVALID_INPUT', 'UNAUTHORIZED', 'STORAGE_FAILED', 'UNSUPPORTED'].includes(raw)
      ? raw
      : 'STORAGE_FAILED';
    return {
      ok: false,
      version: 1,
      error: {
        code,
        retryable: false,
        requestId: requestId(event, input),
        message:
          code === 'UNAUTHORIZED'
            ? 'La ventana o la cuenta no están autorizadas para este archivo.'
            : code === 'UNSUPPORTED'
              ? 'Esta acción no está disponible para este archivo.'
              : code === 'INVALID_INPUT'
                ? 'La solicitud de archivo histórico no es válida.'
                : 'El archivo histórico ya no está disponible.',
      },
    };
  }

  for (const [channel, action] of [
    ['fileHistory.open', 'open'],
    ['fileHistory.reveal', 'reveal'],
  ]) {
    ipcMain.handle(channel, async (event, input) => {
      try {
        const request = authorize(event, input);
        const isAuthorized = () => {
          assertSender(event);
          return historySecurity.authorize(event.sender.id, request.accountId);
        };
        await getRuntime().fileHistory[action](
          request.accountId,
          request.conversationId,
          request.fileId,
          isAuthorized,
        );
        if (!isAuthorized()) throw new Error('UNAUTHORIZED');
        return { ok: true, value: undefined, version: 1, requestId: request.requestId };
      } catch (error) {
        return errorResult(error, event, input);
      }
    });
  }
}

module.exports = { registerFileHistoryHandlers };
