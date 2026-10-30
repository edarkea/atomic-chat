const assert = require('node:assert/strict');
const test = require('node:test');
const { createMessageNotifications } = require('../electron/message-notifications.cjs');

const accountId = 'me@example.com';
const senderJid = 'carlos@example.com';
const roomJid = 'lobby@conference.example.com';

function directMessage(overrides = {}) {
  return {
    id: 'message-1',
    clientMessageId: 'received-message-1',
    accountId,
    conversationId: senderJid,
    senderJid,
    body: { kind: 'text', text: 'Hola desde XMPP' },
    createdAt: '2026-10-30T12:00:00.000Z',
    ...overrides,
  };
}

function mucMessage(overrides = {}) {
  return {
    id: 'muc-message-1',
    accountId,
    roomJid,
    occupantJid: `${roomJid}/Carlos`,
    body: { kind: 'text', text: 'Hola, sala' },
    source: 'live',
    sessionGeneration: 4,
    ...overrides,
  };
}

function createHarness({
  focused = false,
  notifications = true,
  roster,
  room,
  supported = true,
} = {}) {
  const shown = [];
  const windows = [
    {
      isDestroyed: () => false,
      isFocused: () => focused,
    },
  ];
  class FakeNotification {
    static isSupported() {
      return supported;
    }

    constructor(options) {
      this.options = options;
      this.listeners = new Map();
    }

    on(eventName, handler) {
      this.listeners.set(eventName, handler);
    }

    show() {
      shown.push(this.options);
    }
  }

  const notificationHandler = createMessageNotifications({
    Notification: FakeNotification,
    BrowserWindow: { getAllWindows: () => windows },
    getPreferences: () => ({ notifications }),
    getRoster: () => roster || new Map(),
    getMucRoom: () => room,
    getIconPath: () => 'build/icons/128x128.png',
  });

  return { notificationHandler, shown };
}

test('muestra notificación directa con nombre conocido del roster', () => {
  const { notificationHandler, shown } = createHarness({
    roster: new Map([[senderJid, { name: 'Carlos Peña' }]]),
  });

  assert.equal(
    notificationHandler.handle({ type: 'message.received', payload: directMessage() }),
    true,
  );
  assert.deepEqual(shown, [
    {
      title: 'Carlos Peña',
      body: 'Hola desde XMPP',
      icon: 'build/icons/128x128.png',
    },
  ]);
});

test('usa el JID cuando el remitente no existe en el roster', () => {
  const { notificationHandler, shown } = createHarness();

  notificationHandler.handle({ type: 'message.received', payload: directMessage() });

  assert.equal(shown[0].title, senderJid);
});

test('muestra nickname, sala y preview para mensajes MUC live', () => {
  const { notificationHandler, shown } = createHarness({
    room: {
      active: true,
      generation: 4,
      state: { status: 'joined', selfOccupantJid: `${roomJid}/Yo` },
    },
  });

  notificationHandler.handle({ type: 'muc.messageReceived', payload: mucMessage() });

  assert.deepEqual(shown[0], {
    title: 'Carlos',
    body: `Sala ${roomJid}: Hola, sala`,
    icon: 'build/icons/128x128.png',
  });
});

test('omite mensajes propios directos y MUC', () => {
  const direct = createHarness();
  assert.equal(
    direct.notificationHandler.handle({
      type: 'message.received',
      payload: directMessage({ senderJid: accountId, conversationId: accountId }),
    }),
    false,
  );
  assert.equal(direct.shown.length, 0);

  const muc = createHarness({
    room: {
      active: true,
      generation: 4,
      state: { status: 'joined', selfOccupantJid: `${roomJid}/Yo` },
    },
  });
  assert.equal(
    muc.notificationHandler.handle({
      type: 'muc.messageReceived',
      payload: mucMessage({ occupantJid: `${roomJid}/Yo` }),
    }),
    false,
  );
  assert.equal(muc.shown.length, 0);
});

test('deduplica el mismo mensaje', () => {
  const { notificationHandler, shown } = createHarness();
  const event = { type: 'message.received', payload: directMessage() };

  assert.equal(notificationHandler.handle(event), true);
  assert.equal(notificationHandler.handle(event), false);
  assert.equal(shown.length, 1);
});

test('omite mensajes MUC históricos', () => {
  const { notificationHandler, shown } = createHarness({
    room: {
      active: true,
      generation: 4,
      state: { status: 'joined', selfOccupantJid: `${roomJid}/Yo` },
    },
  });

  notificationHandler.handle({
    type: 'muc.messageReceived',
    payload: mucMessage({ source: 'server-history' }),
  });

  assert.equal(shown.length, 0);
});

test('omite notificación cuando una ventana está enfocada', () => {
  const { notificationHandler, shown } = createHarness({ focused: true });

  notificationHandler.handle({ type: 'message.received', payload: directMessage() });

  assert.equal(shown.length, 0);
});

test('respeta Preferences.notifications=false', () => {
  const { notificationHandler, shown } = createHarness({ notifications: false });

  notificationHandler.handle({ type: 'message.received', payload: directMessage() });

  assert.equal(shown.length, 0);
});

test('normaliza controles, saltos de línea y limita el preview', () => {
  const { notificationHandler, shown } = createHarness();
  const text = `  primera\nsegunda\t${'x'.repeat(220)}\u0000  `;

  notificationHandler.handle({
    type: 'message.received',
    payload: directMessage({ body: { kind: 'text', text } }),
  });

  assert.ok(shown[0].body.length <= 160);
  assert.equal(shown[0].body.includes('\n'), false);
  assert.equal(shown[0].body.includes('\t'), false);
  assert.equal(shown[0].body.includes('\u0000'), false);
  assert.equal(shown[0].body.endsWith('…'), true);
});

test('no falla si Notification no está disponible', () => {
  const { notificationHandler, shown } = createHarness({ supported: false });

  assert.doesNotThrow(() =>
    notificationHandler.handle({ type: 'message.received', payload: directMessage() }),
  );
  assert.equal(shown.length, 0);
});
