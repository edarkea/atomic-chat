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
      const { xmpp } = getRuntime();
      let sendInput = input;
      if (input.replyToMessageId !== undefined) {
        const target = xmpp.resolveMucMessage(input.accountId, input.roomJid, input.replyToMessageId);
        const roomIds = target?.stanzaIds?.filter((item) => item.by.toLowerCase() === input.roomJid.toLowerCase()) || [];
        if (!target || !roomIds.length) throw new Error('UNSUPPORTED');
        sendInput = {
          ...input,
          replyTo: {
            stanzaIds: roomIds,
            ...(target.messageId ? { messageId: target.messageId } : {}),
            ...(target.originId ? { originId: target.originId } : {}),
            authorJid: target.occupantJid,
            quote: target.body.text,
          },
        };
      }
      const value = await xmpp.sendMucMessage(sendInput);
      return { ok: true, value, version: 1, requestId: input.requestId };
    } catch (error) {
      return mucError(error, event, input);
    }
  });
  ipcMain.handle('muc.react', async (event, input) => {
    assertSender(event);
    try {
      authorizeMucInput(event, input);
      validateMucRoomInput(input);
      if (typeof input.targetMessageId !== 'string' || !input.targetMessageId.trim() ||
        !Array.isArray(input.emojis) || input.emojis.length > 64 ||
        input.emojis.some((emoji) => typeof emoji !== 'string' || !emoji || emoji.length > 64 || !/\p{Extended_Pictographic}|\p{Regional_Indicator}|\uFE0F|\u20E3/u.test(emoji) || /[\u0000-\u001f\u007f]/u.test(emoji)))
        throw new Error('INVALID_INPUT');
      const { xmpp } = getRuntime();
      const target = xmpp.resolveMucMessage(input.accountId, input.roomJid, input.targetMessageId);
      const roomId = target?.stanzaIds?.find((item) => item.by.toLowerCase() === input.roomJid.toLowerCase());
      if (!target || !roomId) throw new Error('UNSUPPORTED');
      const reference = {
        stanzaIds: target.stanzaIds.filter((item) => item.by.toLowerCase() === input.roomJid.toLowerCase()),
        authorJid: target.occupantJid,
        ...(target.messageId ? { messageId: target.messageId } : {}),
        ...(target.originId ? { originId: target.originId } : {}),
      };
      await xmpp.sendMucReaction({
        ...input,
        target: reference,
        emojis: [...new Set(input.emojis)],
        clientMessageId: `reaction_${crypto.randomUUID()}`,
      });
      xmpp.applyReaction({
        accountId: input.accountId,
        conversationId: input.roomJid,
        target: { messageId: roomId.id, stanzaIds: reference.stanzaIds, authorJid: target.occupantJid },
        emojis: [...new Set(input.emojis)],
        actorJid: xmpp.mucRooms.get(input.accountId)?.get(input.roomJid.toLowerCase())?.state?.selfOccupantJid || input.accountId,
        source: 'muc',
        sessionGeneration: target.sessionGeneration,
      });
      return { ok: true, value: undefined, version: 1, requestId: input.requestId };
    } catch (error) {
      return mucError(error, event, input);
    }
  });
}

module.exports = { registerMucHandlers };
