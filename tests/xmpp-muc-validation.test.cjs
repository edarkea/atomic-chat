const test = require('node:test');
const assert = require('node:assert/strict');
const validation = require('../electron/xmpp/xmpp-muc-validation.cjs');

test('MUC validation preserves normalization and endpoint-bound policy keys', () => {
  const policy = validation.normalizeMucPolicy({
    accountId: 'User@Example.Invalid',
    service: 'Conference.Example.Invalid',
    canCreate: false,
    source: 'operator',
    evidence: 'approved by operator',
    endpoint: { host: 'Openfire.Example.Invalid', port: 5222, transport: 'starttls' },
  });

  assert.ok(policy);
  assert.notStrictEqual(policy.endpoint, undefined);
  assert.equal(
    validation.mucPolicyKey(policy.accountId, policy.service, policy.endpoint),
    'user@example.invalid|conference.example.invalid|openfire.example.invalid:5222|starttls',
  );
  assert.equal(
    validation.validateRoomJid('  Lobby@Conference.Example.Invalid '),
    'lobby@conference.example.invalid',
  );
  assert.equal(validation.validateNickname('operator'), 'operator');
  assert.equal(validation.mucRole('moderator'), 'moderator');
  assert.equal(validation.mucAffiliation('owner'), 'owner');
  assert.equal(validation.mucConditionCode('forbidden'), 'UNAUTHORIZED');
});

test('MUC validation remains fail-closed for malformed policy and requests', () => {
  assert.equal(validation.normalizeMucPolicy({}), undefined);
  assert.throws(
    () =>
      validation.assertMucRequest({ version: 1, requestId: '', accountId: 'user@example.invalid' }),
    (error) => error.code === 'INVALID_INPUT' && error.phase === 'muc.input',
  );
  assert.throws(
    () => validation.validateRoomJid('room@example.invalid/resource'),
    (error) => error.code === 'INVALID_INPUT' && error.phase === 'muc.input',
  );
  assert.throws(
    () => validation.validateNickname('bad/name'),
    (error) => error.code === 'INVALID_INPUT' && error.phase === 'muc.input',
  );
});
