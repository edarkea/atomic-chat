const test = require('node:test');
const assert = require('node:assert/strict');
const { createMainEventSources } = require('../electron/application/main-event-sources.cjs');

function fixture({ autoAccept = false } = {}) {
  const forwardedTransfers = [];
  const forwardedXmpp = [];
  const notifications = [];
  const acceptedTransfers = [];
  const persistedReactions = [];
  const listeners = {};
  const runtime = {
    persistence: {
      saveReaction: (reaction) => persistedReactions.push(reaction),
    },
    media: {
      onEvent: (handler) => {
        listeners.media = handler;
      },
    },
    xmpp: {
      onEvent: (handler) => {
        listeners.xmpp = handler;
      },
    },
    stickerMessages: {},
  };
  const fileTransfers = {
    onEvent: (handler) => {
      listeners.incomingFile = handler;
    },
    accept: async (transferId, senderId) => acceptedTransfers.push({ transferId, senderId }),
  };
  const outgoingFileTransfers = {
    onEvent: (handler) => {
      listeners.outgoingFile = handler;
    },
  };
  const source = createMainEventSources({
    BrowserWindow: {},
    webContents: {},
    createEventRouter: () => ({
      forwardTransferEvent: (event) => forwardedTransfers.push(event),
      forwardXmppEvent: (event) => forwardedXmpp.push(event),
    }),
    createIncomingMessageProcessor: () => (event) => ({ type: 'message.processed', source: event }),
    getRuntime: () => runtime,
    fileTransfers,
    outgoingFileTransfers,
    backgroundMode: { markUnread: () => undefined, updateMenu: () => undefined },
    autoAcceptFileTransfers: () => autoAccept,
    messageNotifications: { handle: (event) => notifications.push(event) },
  });
  return {
    source,
    listeners,
    forwardedTransfers,
    forwardedXmpp,
    notifications,
    acceptedTransfers,
    persistedReactions,
  };
}

test('main event sources preserve transfer, reaction and message routing', () => {
  const value = fixture();
  value.source.attach();

  const transfer = { type: 'file.completed', payload: { transferId: 't-1' } };
  value.listeners.media(transfer);
  assert.deepEqual(value.forwardedTransfers, [transfer]);

  const reaction = { type: 'reaction.changed', payload: { targetKey: 'm-1' } };
  value.listeners.xmpp(reaction);
  assert.deepEqual(value.persistedReactions, [reaction.payload]);
  assert.deepEqual(value.forwardedXmpp, [reaction]);

  const incoming = { type: 'message.received', payload: { id: 'm-1' } };
  value.listeners.xmpp(incoming);
  assert.equal(value.notifications.length, 1);
  assert.deepEqual(value.forwardedXmpp[1], {
    type: 'message.processed',
    source: incoming,
  });
});

test('main event sources keep automatic file acceptance behind the preference gate', async () => {
  const value = fixture({ autoAccept: true });
  value.source.attach();
  value.listeners.incomingFile({
    type: 'file.offerReceived',
    targetSenderId: 42,
    payload: { transferId: 't-2' },
  });
  await Promise.resolve();
  assert.deepEqual(value.acceptedTransfers, [{ transferId: 't-2', senderId: 42 }]);
});
