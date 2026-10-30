function registerStickerHandlers({
  ipcMain,
  assertSender,
  getRuntime,
  historySecurity,
  stickerGrants,
  selectStickerSource,
  helpers,
}) {
  const { requestId, validVersion } = helpers;
  const known = new Set([
    'INVALID_INPUT', 'UNAUTHORIZED', 'CONFLICT', 'RESOURCE_CONSTRAINT', 'STORAGE_FAILED',
    'UNSUPPORTED', 'MEDIA_PREVIEW_UNAVAILABLE', 'MEDIA_TYPE_UNSUPPORTED', 'MEDIA_SIZE_EXCEEDED',
    'MEDIA_DIMENSIONS_INVALID', 'MEDIA_DECODE_FAILED', 'MEDIA_REFERENCE_REVOKED', 'INTERNAL',
  ]);
  const messages = {
    INVALID_INPUT: 'La solicitud de stickers no es válida.',
    UNAUTHORIZED: 'La operación de stickers ya no está autorizada.',
    CONFLICT: 'El estado del sticker no permite esta operación.',
    RESOURCE_CONSTRAINT: 'Se alcanzó el límite local de stickers.',
    STORAGE_FAILED: 'No fue posible guardar o leer el sticker.',
    UNSUPPORTED: 'Esta función no está disponible en esta ventana.',
    MEDIA_PREVIEW_UNAVAILABLE: 'El sticker ya no está disponible.',
    MEDIA_TYPE_UNSUPPORTED: 'Solo se permiten PNG/JPEG estáticos.',
    MEDIA_SIZE_EXCEEDED: 'El sticker supera el límite de 2 MiB.',
    MEDIA_DIMENSIONS_INVALID: 'Las dimensiones del sticker no están permitidas.',
    MEDIA_DECODE_FAILED: 'El sticker no se pudo decodificar de forma segura.',
    MEDIA_REFERENCE_REVOKED: 'La referencia del sticker expiró o fue revocada.',
    INTERNAL: 'No fue posible completar la operación de stickers.',
  };
  function authorize(event, input, options = {}) {
    assertSender(event);
    if (!validVersion(input) || typeof input?.requestId !== 'string' || !input.requestId.trim() || typeof input?.accountId !== 'string' || !input.accountId.trim())
      throw new Error('INVALID_INPUT');
    if (options.sticker && (typeof input.stickerId !== 'string' || !input.stickerId.trim())) throw new Error('INVALID_INPUT');
    if (options.grant && (typeof input.grantId !== 'string' || !input.grantId.trim())) throw new Error('INVALID_INPUT');
    if (options.stream && (typeof input.streamId !== 'string' || !input.streamId.trim() || !Number.isInteger(input.sequence) || input.sequence < 0)) throw new Error('INVALID_INPUT');
    if (!historySecurity.authorize(event.sender.id, input.accountId)) throw new Error('UNAUTHORIZED');
  }
  function resultError(error, event, input) {
    const raw = error?.code || error?.message;
    const code = known.has(raw) ? raw : 'INTERNAL';
    return { ok: false, version: 1, error: { code, retryable: code === 'RESOURCE_CONSTRAINT', requestId: requestId(event, input), message: messages[code] } };
  }
  function success(input, value) { return { ok: true, value, version: 1, requestId: input.requestId }; }

  ipcMain.handle('stickers.import', async (event, input) => {
    try {
      authorize(event, input);
      const sourcePath = await selectStickerSource();
      if (!sourcePath) return success(input, null);
      return success(input, await getRuntime().stickers.importFile(input.accountId, sourcePath));
    } catch (error) { return resultError(error, event, input); }
  });
  ipcMain.handle('stickers.list', async (event, input) => {
    try {
      authorize(event, input);
      if (input.query !== undefined && (typeof input.query !== 'string' || input.query.length > 128)) throw new Error('INVALID_INPUT');
      const limit = input.limit === undefined ? 250 : input.limit;
      if (!Number.isInteger(limit) || limit < 1 || limit > 250) throw new Error('INVALID_INPUT');
      const stickers = getRuntime().stickers.list(input.accountId, input.query || '', limit);
      return success(input, { accountId: input.accountId, collectionId: 'my-stickers', query: input.query || '', stickers });
    } catch (error) { return resultError(error, event, input); }
  });
  ipcMain.handle('stickers.delete', async (event, input) => {
    try { authorize(event, input, { sticker: true }); getRuntime().stickers.delete(input.accountId, input.stickerId); return success(input, undefined); }
    catch (error) { return resultError(error, event, input); }
  });
  ipcMain.handle('stickers.preview.get', async (event, input) => {
    try { authorize(event, input, { sticker: true }); return success(input, await stickerGrants.get(event.sender.id, input)); }
    catch (error) { return resultError(error, event, input); }
  });
  ipcMain.handle('stickers.preview.open', async (event, input) => {
    try { authorize(event, input, { grant: true, sticker: true }); return success(input, await stickerGrants.open(event.sender.id, input)); }
    catch (error) { return resultError(error, event, input); }
  });
  ipcMain.handle('stickers.preview.read', async (event, input) => {
    try { authorize(event, input, { grant: true, sticker: true, stream: true }); return success(input, await stickerGrants.read(event.sender.id, input)); }
    catch (error) { return resultError(error, event, input); }
  });
  ipcMain.handle('stickers.preview.close', async (event, input) => {
    try { authorize(event, input, { grant: true, sticker: true }); if (typeof input.streamId !== 'string' || !input.streamId.trim()) throw new Error('INVALID_INPUT'); await stickerGrants.close(event.sender.id, input); return success(input, undefined); }
    catch (error) { return resultError(error, event, input); }
  });
  ipcMain.handle('stickers.preview.revoke', async (event, input) => {
    try { authorize(event, input, { grant: true, sticker: true }); await stickerGrants.revoke(event.sender.id, input); return success(input, undefined); }
    catch (error) { return resultError(error, event, input); }
  });
}

module.exports = { registerStickerHandlers };
