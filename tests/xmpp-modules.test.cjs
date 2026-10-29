const test = require('node:test');
const assert = require('node:assert/strict');
const { XmppAdapter } = require('../electron/xmpp-adapter.cjs');

test('XmppAdapter composes specialized services over one shared state owner', () => {
  const adapter = new XmppAdapter();
  assert.equal(typeof adapter.transport.resolveTlsOptions, 'function');
  assert.equal(typeof adapter.sessionService.connectInternal, 'function');
  assert.equal(typeof adapter.rosterMessaging.listRoster, 'function');
  assert.equal(typeof adapter.mucService.joinMuc, 'function');
  assert.equal(typeof adapter.fileService.handleFileIq, 'function');

  const resources = new Map([['contact@example.invalid/desktop', { mode: 'away' }]]);
  adapter.remoteResources.set('account@example.invalid', resources);
  assert.strictEqual(adapter.remoteResources.get('account@example.invalid'), resources);
  assert.equal(
    adapter.remoteResources.get('account@example.invalid').get('contact@example.invalid/desktop')
      .mode,
    'away',
  );
});

test('file IQ integration registers one handler per supported namespace and stanza', () => {
  const registrations = [];
  const adapter = new XmppAdapter(false, null, [], { onEvent() {} });
  const session = {
    iqCallee: {
      get: (...args) => registrations.push(['get', ...args]),
      set: (...args) => registrations.push(['set', ...args]),
    },
  };

  adapter.installFileIqHandlers('account@example.invalid', session);

  assert.equal(registrations.length, 5);
  assert.deepEqual(
    registrations.map(([kind, namespace, name]) => [kind, namespace, name]),
    [
      ['get', 'http://jabber.org/protocol/disco#info', 'query'],
      ['set', 'http://jabber.org/protocol/si', 'si'],
      ['set', 'http://jabber.org/protocol/ibb', 'open'],
      ['set', 'http://jabber.org/protocol/ibb', 'data'],
      ['set', 'http://jabber.org/protocol/ibb', 'close'],
    ],
  );
});
