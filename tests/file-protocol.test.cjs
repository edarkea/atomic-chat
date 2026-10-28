const test = require('node:test');
const assert = require('node:assert/strict');
const { canonicalDecimal, safeName, strictBase64, validateOpen, validateData } = require('../electron/file-protocol.cjs');

test('file protocol keeps decimal counts exact and sanitizes presentation names', () => {
  assert.equal(canonicalDecimal('0'), true); assert.equal(canonicalDecimal('9007199254740993'), true);
  assert.equal(canonicalDecimal('01'), false); assert.equal(canonicalDecimal('1.0'), false);
  assert.ok(!safeName('../CON').includes('/')); assert.ok(Buffer.byteLength(safeName('x'.repeat(400)), 'utf8') <= 255);
});

test('IBB validation accepts Spark block size and rejects invalid sequence/base64', () => {
  const open = { attrs: { xmlns: 'http://jabber.org/protocol/ibb', sid: 's', stanza: 'iq', 'block-size': '61440', from: 'a@example/r' } };
  assert.equal(validateOpen(open, 's', 'a@example/r'), 61440);
  const data = { attrs: { xmlns: 'http://jabber.org/protocol/ibb', sid: 's', seq: '0', from: 'a@example/r' }, getText: () => Buffer.from('abc').toString('base64') };
  assert.deepEqual(validateData(data, 's', 'a@example/r', 61440, 0), Buffer.from('abc'));
  assert.throws(() => validateData({ ...data, attrs: { ...data.attrs, seq: '2' } }, 's', 'a@example/r', 61440, 0), /BAD_REQUEST/);
  assert.throws(() => strictBase64('%%%='), /INVALID_BASE64/);
});
