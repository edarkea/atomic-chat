const MAX_EXTERNAL_URL_LENGTH = 4096;

function validateExternalUrl(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_EXTERNAL_URL_LENGTH)
    throw new Error('INVALID_INPUT');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('INVALID_INPUT');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname)
    throw new Error('INVALID_INPUT');
  return url.href;
}

function registerExternalLinkHandlers({ ipcMain, assertSender, shell, helpers }) {
  const { requestId, validVersion } = helpers;
  ipcMain.handle('externalLinks.open', async (event, input) => {
    try {
      assertSender(event);
      if (!validVersion(input) || typeof input?.requestId !== 'string' || !input.requestId.trim())
        throw new Error('INVALID_INPUT');
      const url = validateExternalUrl(input.url);
      if (!shell || typeof shell.openExternal !== 'function') throw new Error('UNSUPPORTED');
      await shell.openExternal(url);
      return { ok: true, value: undefined, version: 1, requestId: input.requestId };
    } catch (error) {
      const raw = error?.code || error?.message;
      const code = ['INVALID_INPUT', 'UNAUTHORIZED', 'UNSUPPORTED'].includes(raw)
        ? raw
        : 'TRANSPORT_FAILED';
      return {
        ok: false,
        version: 1,
        error: {
          code,
          retryable: false,
          requestId: requestId(event, input),
          message:
            code === 'UNSUPPORTED'
              ? 'La apertura de enlaces externos no está disponible.'
              : code === 'UNAUTHORIZED'
                ? 'La ventana no está autorizada.'
                : code === 'INVALID_INPUT'
                  ? 'El enlace no es válido.'
                  : 'No fue posible abrir el enlace.',
        },
      };
    }
  });
}

module.exports = { registerExternalLinkHandlers, validateExternalUrl };
