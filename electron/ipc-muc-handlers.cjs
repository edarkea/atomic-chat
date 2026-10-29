function registerMucHandlers({ ipcMain, assertSender, getRuntime, helpers }) {
  const { authorizeMucInput, validateMucRoomInput, mucError } = helpers;

  ipcMain.handle('muc.discover', async (event, input) => {
    assertSender(event);
    try {
      authorizeMucInput(event, input);
      const value = await getRuntime().xmpp.discoverMuc(input);
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return mucError(error, event, input);
    }
  });
  ipcMain.handle('muc.join', async (event, input) => {
    assertSender(event);
    try {
      authorizeMucInput(event, input);
      validateMucRoomInput(input);
      if (
        typeof input.nickname !== 'string' ||
        !input.nickname.trim() ||
        input.nickname.length > 128
      )
        throw new Error('INVALID_INPUT');
      const value = await getRuntime().xmpp.joinMuc(input);
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return mucError(error, event, input);
    }
  });
  ipcMain.handle('muc.leave', async (event, input) => {
    assertSender(event);
    try {
      authorizeMucInput(event, input);
      validateMucRoomInput(input);
      const value = await getRuntime().xmpp.leaveMuc(input);
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return mucError(error, event, input);
    }
  });
  ipcMain.handle('muc.sendMessage', async (event, input) => {
    assertSender(event);
    try {
      authorizeMucInput(event, input);
      validateMucRoomInput(input, true);
      if (
        input.body?.kind !== 'text' ||
        typeof input.body.text !== 'string' ||
        !input.body.text.trim() ||
        Buffer.byteLength(input.body.text, 'utf8') > 4096
      )
        throw new Error('INVALID_INPUT');
      const value = await getRuntime().xmpp.sendMucMessage(input);
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return mucError(error, event, input);
    }
  });
}

module.exports = { registerMucHandlers };
