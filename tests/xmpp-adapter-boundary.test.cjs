const test = require('node:test');
const assert = require('node:assert/strict');
const { xml } = require('@xmpp/client');
const { XmppAdapter } = require('../electron/xmpp/xmpp-adapter.cjs');

const ACCOUNT = 'alice@example.invalid';
const DOMAIN = 'example.invalid';

test('adapter event subscriptions stop receiving events after unsubscribe', () => {
  const adapter = new XmppAdapter();
  const received = [];
  const unsubscribe = adapter.onEvent((event) => received.push(event));

  adapter.emit({ type: 'first' });
  unsubscribe();
  adapter.emit({ type: 'second' });

  assert.deepEqual(received, [{ type: 'first' }]);
});

test('capability discovery does not publish a result for an obsolete generation', async () => {
  const adapter = new XmppAdapter();
  adapter.sessionGenerations.set(ACCOUNT, 2);
  const session = {
    iqCaller: {
      request: async () =>
        xml(
          'iq',
          { type: 'result' },
          xml(
            'query',
            { xmlns: 'http://jabber.org/protocol/disco#info' },
            xml('feature', { var: 'urn:xmpp:reactions:0' }),
          ),
        ),
    },
  };

  const result = await adapter.discoverMessageCapabilities(ACCOUNT, session, DOMAIN, 1);

  assert.equal(result.accountId, ACCOUNT);
  assert.equal(result.generation, 1);
  assert.equal(adapter.messageCapabilities.has(ACCOUNT), false);
});
