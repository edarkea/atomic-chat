const test = require('node:test');
const assert = require('node:assert/strict');
const { xml } = require('@xmpp/client');
const { createFileTraceService } = require('../electron/xmpp/xmpp-file-trace.cjs');

const SI_NS = 'http://jabber.org/protocol/si';

test('file trace service correlates SI candidates without logging stanza identifiers', () => {
  const previousTrace = process.env.ATOMIC_XMPP_FILE_TRACE;
  const previousInfo = console.info;
  const lines = [];
  const fileTraceAttempts = new WeakMap();
  const service = createFileTraceService({ fileTraceAttempts });
  const stanza = xml(
    'iq',
    { type: 'set', id: 'secret-iq', from: 'secret@example.invalid/resource' },
    xml('si', { xmlns: SI_NS, id: 'secret-si' }),
  );

  process.env.ATOMIC_XMPP_FILE_TRACE = 'true';
  console.info = (...args) => lines.push(args.join(' '));
  try {
    service.traceStanza('account@example.invalid', stanza);
  } finally {
    console.info = previousInfo;
    if (previousTrace === undefined) delete process.env.ATOMIC_XMPP_FILE_TRACE;
    else process.env.ATOMIC_XMPP_FILE_TRACE = previousTrace;
  }

  assert.equal(lines.length, 1);
  assert.match(lines[0], /FILE_IQ_CANDIDATE_RX/);
  assert.doesNotMatch(lines[0], /secret-iq|secret-si|secret@example/);
  assert.match(fileTraceAttempts.get(stanza), /^attempt_/);
});
