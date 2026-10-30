const { refIdFor } = require('./xmpp-stickers.cjs');

function registerStickerMessageHandlers({
  ipcMain,
  assertSender,
  getRuntime,
  historySecurity,
  helpers,
}) {
  const { requestId, validVersion } = helpers;
  const known = new Set([
    'INVALID_INPUT', 'UNAUTHORIZED', 'NOT_CONNECTED', 'TIMEOUT', 'UNSUPPORTED',
    'TRANSPORT_FAILED', 'MEDIA_PREVIEW_UNAVAILABLE', 'MEDIA_TYPE_UNSUPPORTED',
    'MEDIA_SIZE_EXCEEDED', 'MEDIA_DIMENSIONS_INVALID', 'MEDIA_DECODE_FAILED',
    'STORAGE_FAILED', 'RESOURCE_CONSTRAINT', 'CONFLICT', 'INTERNAL',
  ]);
  const messages = {
    INVALID_INPUT: 'La solicitud de sticker no es válida.',
    UNAUTHORIZED: 'La operación de sticker ya no está autorizada.',
    NOT_CONNECTED: 'La cuenta no está conectada.',
    TIMEOUT: 'La operación de sticker excedió el tiempo límite.',
    UNSUPPORTED: 'El servidor no ofrece transporte de stickers compatible.',
    TRANSPORT_FAILED: 'No se pudo enviar el sticker.',
    MEDIA_PREVIEW_UNAVAILABLE: 'El sticker ya no está disponible.',
    MEDIA_TYPE_UNSUPPORTED: 'Solo se permiten PNG/JPEG estáticos.',
    MEDIA_SIZE_EXCEEDED: 'El sticker supera el límite de 2 MiB.',
    MEDIA_DIMENSIONS_INVALID: 'Las dimensiones del sticker no están permitidas.',
    MEDIA_DECODE_FAILED: 'El sticker no se pudo validar de forma segura.',
    STORAGE_FAILED: 'No fue posible guardar el sticker.',
    RESOURCE_CONSTRAINT: 'Se alcanzó un límite de recursos.',
    CONFLICT: 'El sticker cambió durante la operación.',
    INTERNAL: 'No fue posible completar la operación de sticker.',
  };

  function authorize(event, input, requireConversation = false) {
    assertSender(event);
    if (
      !validVersion(input) ||
      typeof input?.requestId !== 'string' || !input.requestId.trim() ||
      typeof input?.accountId !== 'string' || !input.accountId.trim()
    ) throw new Error('INVALID_INPUT');
    if (requireConversation && (typeof input.conversationId !== 'string' || !input.conversationId.trim()))
      throw new Error('INVALID_INPUT');
    if (!historySecurity.authorize(event.sender.id, input.accountId)) throw new Error('UNAUTHORIZED');
  }

  function currentAuthorization(event, accountId) {
    try {
      assertSender(event);
      return historySecurity.authorize(event.sender.id, accountId);
    } catch {
      return false;
    }
  }

  function success(input, value) {
    return { ok: true, value, version: 1, requestId: input.requestId };
  }

  function failure(error, event, input) {
    const raw = error?.code || error?.message;
    const code = known.has(raw) ? raw : 'INTERNAL';
    return {
      ok: false,
      version: 1,
      error: { code, retryable: ['TIMEOUT', 'TRANSPORT_FAILED'].includes(code), requestId: requestId(event, input), message: messages[code] },
    };
  }

  function validateConversationInput(input) {
    if (typeof input.conversationId !== 'string' || !input.conversationId.trim() || input.conversationId.length > 512)
      throw new Error('INVALID_INPUT');
  }

  ipcMain.handle('stickerMessages.discover', async (event, input) => {
    try {
      authorize(event, input);
      const runtime = getRuntime();
      const value = await runtime.xmpp.discoverStickers(input);
      if (!currentAuthorization(event, input.accountId)) throw new Error('UNAUTHORIZED');
      return success(input, {
        accountId: input.accountId,
        supported: true,
        ...(value.serviceJid ? { uploadService: value.serviceJid } : {}),
        ...(value.maxFileSize !== undefined ? { maxFileSize: String(value.maxFileSize) } : {}),
        sessionGeneration: runtime.xmpp.sessionGenerations.get(input.accountId) || 0,
        expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });
    } catch (error) { return failure(error, event, input); }
  });

  ipcMain.handle('stickerMessages.send', async (event, input) => {
    try {
      authorize(event, input, true);
      if (typeof input.clientMessageId !== 'string' || !input.clientMessageId.trim() || input.clientMessageId.length > 512 ||
          typeof input.stickerId !== 'string' || !input.stickerId.trim() || input.stickerId.length > 512)
        throw new Error('INVALID_INPUT');
      const runtime = getRuntime();
      const refId = refIdFor(input.accountId, input.conversationId, input.clientMessageId);
      const existing = runtime.persistence.getStickerMessageRef(input.accountId, refId);
      if (existing) return success(input, runtime.stickerMessages.publicRef(existing));
      const existingClient = runtime.persistence.getStickerMessageRefByClientMessageId(input.accountId, input.clientMessageId);
      if (existingClient) {
        if (existingClient.conversationId !== input.conversationId) throw new Error('CONFLICT');
        return success(input, runtime.stickerMessages.publicRef(existingClient));
      }
      const isAuthorized = () => currentAuthorization(event, input.accountId);
      const sticker = runtime.persistence.getSticker(input.accountId, input.stickerId);
      if (!sticker) throw new Error('MEDIA_PREVIEW_UNAVAILABLE');
      const asset = runtime.stickers.resolveForPreview(input.accountId, input.stickerId);
      const source = {
        ...asset,
        assetId: sticker.assetId,
        name: sticker.name,
        altText: sticker.altText,
      };
      if (!isAuthorized()) throw new Error('UNAUTHORIZED');
      const value = await runtime.xmpp.sendSticker(input, async () => source);
      if (!isAuthorized()) throw new Error('UNAUTHORIZED');
      const saved = runtime.stickerMessages.save({ ...value, sourceStickerId: input.stickerId });
      return success(input, saved);
    } catch (error) { return failure(error, event, input); }
  });

  ipcMain.handle('stickerMessages.load', async (event, input) => {
    try {
      authorize(event, input, true);
      if (typeof input.refId !== 'string' || !input.refId.trim() || input.refId.length > 512)
        throw new Error('INVALID_INPUT');
      const runtime = getRuntime();
      const isAuthorized = () => currentAuthorization(event, input.accountId);
      const stored = runtime.persistence.getStickerMessageRef(input.accountId, input.refId);
      if (!stored || stored.conversationId !== input.conversationId) throw new Error('MEDIA_PREVIEW_UNAVAILABLE');
      const value = await runtime.stickerMessages.load(input.accountId, input.refId, isAuthorized);
      if (!isAuthorized()) throw new Error('UNAUTHORIZED');
      return success(input, value);
    } catch (error) { return failure(error, event, input); }
  });
}

module.exports = { registerStickerMessageHandlers };
