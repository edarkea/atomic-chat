function registerStickerPackHandlers({ ipcMain, assertSender, getRuntime, historySecurity, helpers }) {
  const { requestId, validVersion } = helpers;
  const known = new Set([
    'INVALID_INPUT', 'UNAUTHORIZED', 'CONFLICT', 'STORAGE_FAILED', 'MEDIA_PREVIEW_UNAVAILABLE', 'INTERNAL',
  ]);
  const messages = {
    INVALID_INPUT: 'La solicitud del paquete no es válida.',
    UNAUTHORIZED: 'La operación del paquete ya no está autorizada.',
    CONFLICT: 'El paquete o borrador cambió. Vuelve a cargarlo.',
    STORAGE_FAILED: 'No fue posible guardar el paquete local.',
    MEDIA_PREVIEW_UNAVAILABLE: 'El paquete o borrador ya no está disponible.',
    INTERNAL: 'No fue posible completar la operación del paquete.',
  };
  function authorize(event, input) {
    assertSender(event);
    if (!validVersion(input) || typeof input?.requestId !== 'string' || !input.requestId.trim() || typeof input?.accountId !== 'string' || !input.accountId.trim())
      throw new Error('INVALID_INPUT');
    if (!historySecurity.authorize(event.sender.id, input.accountId)) throw new Error('UNAUTHORIZED');
  }
  function currentAuthorization(event, input) {
    try { assertSender(event); return historySecurity.authorize(event.sender.id, input.accountId); } catch { return false; }
  }
  function id(value) {
    if (typeof value !== 'string' || !value.trim() || value.length > 512) throw new Error('INVALID_INPUT');
    return value.trim();
  }
  function validateIds(value, allowEmpty = false) {
    if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.length > 250 || value.some((item) => typeof item !== 'string' || !item.trim() || item.length > 512))
      throw new Error('INVALID_INPUT');
    if (new Set(value.map((item) => item.trim())).size !== value.length) throw new Error('CONFLICT');
  }
  function validateText(value, max, allowEmpty = true) {
    if (value === undefined) return;
    if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value) || (!allowEmpty && !value.trim())) throw new Error('INVALID_INPUT');
  }
  function validatePackSave(input) {
    validateText(input.name, 128, false);
    validateText(input.description, 1024);
    validateIds(input.stickerIds, false);
    if (!Number.isInteger(input.revision) || input.revision < 0) throw new Error('INVALID_INPUT');
    if (input.packId !== undefined) id(input.packId);
  }
  function validateRevision(input) { if (!Number.isInteger(input.revision) || input.revision < 1) throw new Error('INVALID_INPUT'); }
  function resultError(cause, event, input) {
    const raw = cause?.code || cause?.message;
    const code = known.has(raw) ? raw : 'INTERNAL';
    return { ok: false, version: 1, error: { code, retryable: code === 'CONFLICT', requestId: requestId(event, input), message: messages[code] } };
  }
  function success(input, value) { return { ok: true, value, version: 1, requestId: input.requestId }; }

  ipcMain.handle('stickerPacks.list', async (event, input) => {
    try { authorize(event, input); return success(input, await getRuntime().stickerPacks.list(input.accountId, () => currentAuthorization(event, input))); }
    catch (cause) { return resultError(cause, event, input); }
  });
  ipcMain.handle('stickerPacks.get', async (event, input) => {
    try { authorize(event, input); const packId = id(input.packId); return success(input, await getRuntime().stickerPacks.get(input.accountId, packId, () => currentAuthorization(event, input))); }
    catch (cause) { return resultError(cause, event, input); }
  });
  ipcMain.handle('stickerPacks.save', async (event, input) => {
    try { authorize(event, input); validatePackSave(input); return success(input, await getRuntime().stickerPacks.save(input, () => currentAuthorization(event, input))); }
    catch (cause) { return resultError(cause, event, input); }
  });
  ipcMain.handle('stickerPacks.delete', async (event, input) => {
    try { authorize(event, input); const packId = id(input.packId); validateRevision(input); await getRuntime().stickerPacks.delete(input.accountId, packId, input.revision, () => currentAuthorization(event, input)); return success(input, undefined); }
    catch (cause) { return resultError(cause, event, input); }
  });
  ipcMain.handle('stickerDrafts.list', async (event, input) => {
    try { authorize(event, input); return success(input, await getRuntime().stickerPacks.listDrafts(input.accountId, () => currentAuthorization(event, input))); }
    catch (cause) { return resultError(cause, event, input); }
  });
  ipcMain.handle('stickerDrafts.create', async (event, input) => {
    try { authorize(event, input); const basePackId = input.basePackId === undefined ? undefined : id(input.basePackId); return success(input, await getRuntime().stickerPacks.createDraft(input.accountId, basePackId, () => currentAuthorization(event, input))); }
    catch (cause) { return resultError(cause, event, input); }
  });
  ipcMain.handle('stickerDrafts.get', async (event, input) => {
    try { authorize(event, input); return success(input, await getRuntime().stickerPacks.getDraft(input.accountId, id(input.draftId), () => currentAuthorization(event, input))); }
    catch (cause) { return resultError(cause, event, input); }
  });
  ipcMain.handle('stickerDrafts.update', async (event, input) => {
    try { authorize(event, input); id(input.draftId); validateText(input.name, 128); validateText(input.description, 1024); validateIds(input.stickerIds, true); validateRevision(input); return success(input, await getRuntime().stickerPacks.updateDraft(input, () => currentAuthorization(event, input))); }
    catch (cause) { return resultError(cause, event, input); }
  });
  ipcMain.handle('stickerDrafts.discard', async (event, input) => {
    try { authorize(event, input); validateRevision(input); await getRuntime().stickerPacks.discardDraft(input.accountId, id(input.draftId), input.revision, () => currentAuthorization(event, input)); return success(input, undefined); }
    catch (cause) { return resultError(cause, event, input); }
  });
  ipcMain.handle('stickerDrafts.commit', async (event, input) => {
    try { authorize(event, input); validateRevision(input); return success(input, await getRuntime().stickerPacks.commitDraft(input.accountId, id(input.draftId), input.revision, () => currentAuthorization(event, input))); }
    catch (cause) { return resultError(cause, event, input); }
  });
}

module.exports = { registerStickerPackHandlers };
