function registerPreviewHandlers({ ipcMain, assertSender, historySecurity, previewGrants, helpers }) {
  const { requestId, validVersion } = helpers;

  function authorize(event, input, requirePreview = false) {
    assertSender(event);
    if (
      !validVersion(input) ||
      typeof input?.requestId !== 'string' ||
      !input.requestId.trim() ||
      typeof input?.accountId !== 'string' ||
      !input.accountId.trim() ||
      typeof input?.transferId !== 'string' ||
      !input.transferId.trim()
    )
      throw new Error('INVALID_INPUT');
    if (requirePreview && (typeof input.previewId !== 'string' || !input.previewId.trim()))
      throw new Error('INVALID_INPUT');
    if (!historySecurity.authorize(event.sender.id, input.accountId)) throw new Error('UNAUTHORIZED');
  }

  function errorResult(error, event, input) {
    const raw = error?.code || error?.message;
    const known = new Set([
      'INVALID_INPUT',
      'UNAUTHORIZED',
      'CONFLICT',
      'RESOURCE_CONSTRAINT',
      'MEDIA_PREVIEW_UNAVAILABLE',
      'MEDIA_TYPE_UNSUPPORTED',
      'MEDIA_SIZE_EXCEEDED',
      'MEDIA_DIMENSIONS_INVALID',
      'MEDIA_DECODE_FAILED',
      'MEDIA_REFERENCE_REVOKED',
      'STORAGE_FAILED',
      'INTERNAL',
    ]);
    const code = known.has(raw) ? raw : 'INTERNAL';
    const messages = {
      INVALID_INPUT: 'La solicitud de preview no es válida.',
      UNAUTHORIZED: 'La ventana, cuenta o transferencia no están autorizadas.',
      CONFLICT: 'La secuencia o el estado del preview no es válido.',
      RESOURCE_CONSTRAINT: 'Se alcanzó el límite temporal de previews.',
      MEDIA_PREVIEW_UNAVAILABLE: 'La imagen recibida ya no está disponible.',
      MEDIA_TYPE_UNSUPPORTED: 'Solo se permiten imágenes PNG/JPEG estáticas.',
      MEDIA_SIZE_EXCEEDED: 'La imagen supera el tamaño permitido.',
      MEDIA_DIMENSIONS_INVALID: 'Las dimensiones de la imagen no están permitidas.',
      MEDIA_DECODE_FAILED: 'La imagen no se pudo decodificar de forma segura.',
      MEDIA_REFERENCE_REVOKED: 'La referencia de preview expiró o fue revocada.',
      STORAGE_FAILED: 'No fue posible leer la imagen recibida.',
      INTERNAL: 'No fue posible completar el preview.',
    };
    return {
      ok: false,
      version: 1,
      error: {
        code,
        retryable: code === 'RESOURCE_CONSTRAINT',
        requestId: requestId(event, input),
        message: messages[code],
      },
    };
  }

  ipcMain.handle('preview.get', async (event, input) => {
    try {
      authorize(event, input);
      const value = await previewGrants.get(event.sender.id, input);
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return errorResult(error, event, input);
    }
  });
  ipcMain.handle('preview.open', async (event, input) => {
    try {
      authorize(event, input, true);
      const value = await previewGrants.open(event.sender.id, input);
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return errorResult(error, event, input);
    }
  });
  ipcMain.handle('preview.read', async (event, input) => {
    try {
      authorize(event, input, true);
      if (typeof input.streamId !== 'string' || !input.streamId.trim() || !Number.isInteger(input.sequence) || input.sequence < 0)
        throw new Error('INVALID_INPUT');
      const value = await previewGrants.read(event.sender.id, input);
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return errorResult(error, event, input);
    }
  });
  ipcMain.handle('preview.close', async (event, input) => {
    try {
      authorize(event, input, true);
      if (typeof input.streamId !== 'string' || !input.streamId.trim()) throw new Error('INVALID_INPUT');
      await previewGrants.close(event.sender.id, input);
      return { ok: true, value: undefined, version: 1, requestId: input.requestId };
    } catch (error) {
      return errorResult(error, event, input);
    }
  });
  ipcMain.handle('preview.revoke', async (event, input) => {
    try {
      authorize(event, input, true);
      await previewGrants.revoke(event.sender.id, input);
      return { ok: true, value: undefined, version: 1, requestId: input.requestId };
    } catch (error) {
      return errorResult(error, event, input);
    }
  });
}

module.exports = { registerPreviewHandlers };
