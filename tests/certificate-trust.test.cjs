const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PersistenceStore } = require('../electron/storage.cjs');
const { XmppAdapter } = require('../electron/xmpp-adapter.cjs');
const { assessCertificate } = require('../electron/certificate-trust.cjs');

function syntheticCertificate(overrides = {}) {
  const certificate = {
    raw: Buffer.from('synthetic-certificate'),
    fingerprint256: 'AA:BB:CC:DD',
    subject: { CN: 'xmpp.example.invalid' },
    issuer: { CN: 'xmpp.example.invalid' },
    valid_from: 'Jan 01 00:00:00 2020 GMT',
    valid_to: 'Jan 01 00:00:00 2035 GMT',
    subjectaltname: 'DNS:xmpp.example.invalid',
    sigalg: 'RSA-SHA256',
    bits: 2048,
    ...overrides,
  };
  certificate.issuerCertificate = certificate;
  return certificate;
}

test('classifies a self-signed certificate without trusting it automatically', () => {
  const result = assessCertificate('xmpp.example.invalid', syntheticCertificate(), false, 'DEPTH_ZERO_SELF_SIGNED_CERT');
  assert.equal(result.trustable, true);
  assert.equal(result.error.code, 'CERTIFICATE_UNTRUSTED');
  assert.match(result.info.pem, /BEGIN CERTIFICATE/);
  assert.deepEqual(result.info.subjectAltNames, ['DNS:xmpp.example.invalid']);
});

test('blocks expired, identity-mismatched, and insecure certificates', () => {
  assert.equal(assessCertificate('xmpp.example.invalid', syntheticCertificate({ valid_to: 'Jan 01 00:00:00 2021 GMT' }), false, 'DEPTH_ZERO_SELF_SIGNED_CERT').error.code, 'CERTIFICATE_EXPIRED');
  assert.equal(assessCertificate('xmpp.example.invalid', syntheticCertificate({ subjectaltname: 'DNS:other.example.invalid' }), true, undefined).error.code, 'CERTIFICATE_IDENTITY_MISMATCH');
  assert.equal(assessCertificate('xmpp.example.invalid', syntheticCertificate({ sigalg: 'RSA-SHA1' }), false, 'DEPTH_ZERO_SELF_SIGNED_CERT').error.code, 'CERTIFICATE_INSECURE_ALGORITHM');
});

test('certificate decisions are correlated to the exact pending request and sender', async () => {
  const adapter = new XmppAdapter();
  const events = [];
  adapter.onEvent((event) => events.push(event));
  const input = { requestId: 'req-cert-1', accountId: 'a@example.invalid', endpoint: { host: 'xmpp.example.invalid', port: 5222 } };
  const pending = adapter.awaitTrustDecision(input, { fingerprintSha256: 'AA:BB' }, undefined, undefined, 7);
  assert.equal(events[0].type, 'certificate.trustRequired');
  assert.throws(() => adapter.decideCertificateTrust(8, { requestId: input.requestId, accountId: input.accountId, fingerprintSha256: 'AA:BB', decision: 'trust_once' }), /CERTIFICATE_DECISION_CONFLICT/);
  adapter.decideCertificateTrust(7, { requestId: input.requestId, accountId: input.accountId, fingerprintSha256: 'AA:BB', decision: 'trust_once' });
  assert.equal(await pending, 'trust_once');
});

test('reuses an approved certificate without showing a second warning', async () => {
  const certificate = syntheticCertificate();
  const adapter = new XmppAdapter(false, { getTrustedCertificate: () => ({ accountId: 'a@example.invalid', host: 'xmpp.example.invalid', port: 5222, transport: 'direct-tls', fingerprintSha256: certificate.fingerprint256, certificatePem: 'approved-pem', approvedAt: new Date().toISOString() }) });
  adapter.probeCertificate = async () => ({ certificate, authorized: false, authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT' });
  const options = await adapter.resolveTlsOptions({ requestId: 'req-cert-2', accountId: 'a@example.invalid', endpoint: { host: 'xmpp.example.invalid', port: 5222 } }, 7);
  assert.equal(options.ca, 'approved-pem');
  assert.equal(adapter.pendingDecisions.size, 0);
});

test('persistent trust is scoped to account, endpoint, transport, and fingerprint', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-cert-trust-'));
  const store = new PersistenceStore(directory);
  store.upsertAccount({ accountId: 'a@example.invalid', host: 'xmpp.example.invalid', port: 5222, tls: 1, credentialRef: null, createdAt: new Date().toISOString() });
  store.upsertTrustedCertificate({ accountId: 'a@example.invalid', host: 'xmpp.example.invalid', port: 5222, transport: 'direct-tls', fingerprintSha256: 'AA:BB', certificatePem: 'pem', approvedAt: new Date().toISOString() });
  assert.equal(store.getTrustedCertificate('a@example.invalid', 'xmpp.example.invalid', 5222, 'direct-tls').fingerprintSha256, 'AA:BB');
  assert.equal(store.getTrustedCertificate('b@example.invalid', 'xmpp.example.invalid', 5222, 'direct-tls'), null);
  store.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
