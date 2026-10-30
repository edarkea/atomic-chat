function registerBroadcastHandlers({
  ipcMain,
  assertSender,
  getRuntime,
  historySecurity,
  helpers,
}) {
  const { requestId, validVersion } = helpers;

  function requireText(value, name, maxLength = 512) {
    if (typeof value !== 'string' || !value.trim() || value.length > maxLength)
      throw new Error(`INVALID_${name}`);
    return value.trim();
  }

  function validateInput(input) {
    if (!validVersion(input)) throw new Error('UNSUPPORTED');
    requireText(input.requestId, 'REQUEST_ID');
    requireText(input.accountId, 'ACCOUNT');
    requireText(input.broadcastId, 'BROADCAST_ID');
    if (
      input.body?.kind !== 'text' ||
      typeof input.body.text !== 'string' ||
      !input.body.text.trim() ||
      Buffer.byteLength(input.body.text, 'utf8') > 4096
    )
      throw new Error('INVALID_INPUT');
    if (
      !Array.isArray(input.recipientJids) ||
      input.recipientJids.length < 1 ||
      input.recipientJids.length > 256
    )
      throw new Error('INVALID_INPUT');
    for (const jid of input.recipientJids) {
      if (typeof jid !== 'string' || jid.length > 512 || !/^[^@\s/]+@[^@\s/]+$/.test(jid.trim()))
        throw new Error('INVALID_INPUT');
    }
  }

  function resultError(error, event, input) {
    const raw = error?.message || error?.code;
    const code = ['INVALID_INPUT', 'UNAUTHORIZED', 'NOT_CONNECTED', 'UNSUPPORTED'].includes(raw)
      ? raw
      : 'TRANSPORT_FAILED';
    return {
      ok: false,
      version: 1,
      error: {
        code,
        retryable: code === 'NOT_CONNECTED' || code === 'TRANSPORT_FAILED',
        requestId: requestId(event, input),
        message:
          code === 'UNAUTHORIZED'
            ? 'La cuenta no está autorizada para esta difusión.'
            : code === 'NOT_CONNECTED'
              ? 'La cuenta no está conectada.'
              : 'No fue posible iniciar la difusión.',
      },
    };
  }

  ipcMain.handle('broadcast.send', async (event, input) => {
    assertSender(event);
    try {
      validateInput(input);
      if (!historySecurity.authorize(event.sender.id, input.accountId))
        throw new Error('UNAUTHORIZED');
      const { xmpp } = getRuntime();
      if (
        !xmpp.sessions.has(input.accountId) ||
        xmpp.states.get(input.accountId)?.status !== 'connected'
      )
        throw new Error('NOT_CONNECTED');
      const { createBroadcastCoordinator } = require('./broadcast-coordinator.cjs');
      const value = await createBroadcastCoordinator({ xmpp }).send(input);
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return resultError(error, event, input);
    }
  });
}

module.exports = { registerBroadcastHandlers };
