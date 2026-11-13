const test = require('node:test');
const assert = require('node:assert/strict');
const { xml } = require('@xmpp/client');
const { profileDisplayName, loadDisplayName } = require('../electron/xmpp/xmpp-display-name.cjs');

test('uses full name, structured name or nickname without showing a JID', () => {
  assert.equal(profileDisplayName(xml('vCard', {}, xml('FN', {}, ' Juan  Munoz '))), 'Juan Munoz');
  assert.equal(
    profileDisplayName(
      xml('vCard', {}, xml('N', {}, xml('GIVEN', {}, 'Juan'), xml('FAMILY', {}, 'Munoz'))),
    ),
    'Juan Munoz',
  );
  assert.equal(
    profileDisplayName(
      xml('vCard', {}, xml('FN', {}, 'juan@test.invalid'), xml('NICKNAME', {}, 'Juan')),
    ),
    'Juan',
  );
  assert.equal(profileDisplayName(undefined), undefined);
});

test('publishes the name only for the current connected session', async () => {
  const response = xml(
    'iq',
    {},
    xml('vCard', { xmlns: 'vcard-temp' }, xml('FN', {}, 'Juan Munoz')),
  );
  const session = { iqCaller: { request: async () => response } };
  const events = [];
  const adapter = {
    sessions: new Map([['juan', session]]),
    states: new Map([['juan', { status: 'connected' }]]),
    emit: (event) => events.push(event),
  };
  await loadDisplayName(adapter, 'juan', session);
  assert.equal(events[0].payload.displayName, 'Juan Munoz');
  adapter.sessions.set('juan', {});
  await loadDisplayName(adapter, 'juan', session);
  assert.equal(events.length, 1);
  session.iqCaller.request = async () => {
    throw new Error('unsupported');
  };
  await loadDisplayName(adapter, 'juan', session);
  assert.equal(events.length, 1);
});
