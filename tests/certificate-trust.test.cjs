const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { PersistenceStore } = require('../electron/storage.cjs');
const { XmppAdapter, negotiateStartTls } = require('../electron/xmpp-adapter.cjs');
const { assessCertificate } = require('../electron/certificate-trust.cjs');
const { tlsIdentityCheck } = require('../electron/xmpp-transport.cjs');

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
  const result = assessCertificate(
    'xmpp.example.invalid',
    syntheticCertificate(),
    false,
    'DEPTH_ZERO_SELF_SIGNED_CERT',
  );
  assert.equal(result.trustable, true);
  assert.equal(result.error.code, 'CERTIFICATE_UNTRUSTED');
  assert.match(result.info.pem, /BEGIN CERTIFICATE/);
  assert.deepEqual(result.info.subjectAltNames, ['DNS:xmpp.example.invalid']);
});

test('blocks expired and insecure certificates but allows explicit identity review', () => {
  assert.equal(
    assessCertificate(
      'xmpp.example.invalid',
      syntheticCertificate({ valid_to: 'Jan 01 00:00:00 2021 GMT' }),
      false,
      'DEPTH_ZERO_SELF_SIGNED_CERT',
    ).error.code,
    'CERTIFICATE_EXPIRED',
  );
  const identityMismatch = assessCertificate(
    '132.150.10.113',
    syntheticCertificate({
      subjectaltname: 'DNS:132.150.10.113, DNS:*.132.150.10.113',
    }),
    true,
    undefined,
  );
  assert.equal(identityMismatch.trustable, true);
  assert.equal(identityMismatch.error.code, 'CERTIFICATE_IDENTITY_MISMATCH');
  assert.equal(
    assessCertificate(
      'xmpp.example.invalid',
      syntheticCertificate({ sigalg: 'RSA-SHA1' }),
      false,
      'DEPTH_ZERO_SELF_SIGNED_CERT',
    ).error.code,
    'CERTIFICATE_INSECURE_ALGORITHM',
  );
});

test('accepts a reviewed identity mismatch only for the exact approved fingerprint', () => {
  const certificate = syntheticCertificate({ subjectaltname: 'DNS:other.example.invalid' });
  const allowMismatch = tlsIdentityCheck({
    identityHost: 'xmpp.example.invalid',
    expectedFingerprint: certificate.fingerprint256,
    allowIdentityMismatch: true,
  });
  assert.equal(allowMismatch('xmpp.example.invalid', certificate), undefined);

  const changedCertificate = syntheticCertificate({
    subjectaltname: 'DNS:other.example.invalid',
    fingerprint256: '11:22:33:44',
  });
  assert.equal(
    allowMismatch('xmpp.example.invalid', changedCertificate).code,
    'CERTIFICATE_PIN_MISMATCH',
  );
});

test('certificate decisions are correlated to the exact pending request and sender', async () => {
  const adapter = new XmppAdapter();
  const events = [];
  adapter.onEvent((event) => events.push(event));
  const input = {
    requestId: 'req-cert-1',
    accountId: 'a@example.invalid',
    endpoint: { host: 'xmpp.example.invalid', port: 5222 },
  };
  const pending = adapter.awaitTrustDecision(
    input,
    'direct-tls',
    { fingerprintSha256: 'AA:BB' },
    undefined,
    undefined,
    7,
  );
  assert.equal(events[0].type, 'certificate.trustRequired');
  assert.throws(
    () =>
      adapter.decideCertificateTrust(8, {
        requestId: input.requestId,
        accountId: input.accountId,
        fingerprintSha256: 'AA:BB',
        decision: 'trust_once',
      }),
    /CERTIFICATE_DECISION_CONFLICT/,
  );
  adapter.decideCertificateTrust(7, {
    requestId: input.requestId,
    accountId: input.accountId,
    fingerprintSha256: 'AA:BB',
    decision: 'trust_once',
  });
  assert.equal(await pending, 'trust_once');
});

test('reuses an approved certificate without showing a second warning', async () => {
  const certificate = syntheticCertificate();
  const adapter = new XmppAdapter(false, {
    getTrustedCertificate: () => ({
      accountId: 'a@example.invalid',
      host: 'xmpp.example.invalid',
      port: 5222,
      transport: 'direct-tls',
      fingerprintSha256: certificate.fingerprint256,
      certificatePem: 'approved-pem',
      approvedAt: new Date().toISOString(),
    }),
  });
  adapter.probeDirectCertificate = async () => ({
    certificate,
    authorized: false,
    authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT',
  });
  const options = await adapter.resolveTlsOptions(
    {
      requestId: 'req-cert-2',
      accountId: 'a@example.invalid',
      endpoint: { host: 'xmpp.example.invalid', port: 5222 },
    },
    7,
    { transport: 'direct-tls' },
  );
  assert.equal(options.ca, 'approved-pem');
  assert.equal(adapter.pendingDecisions.size, 0);
});

test('reuses an approved identity-mismatch certificate only with its recorded exception', async () => {
  const certificate = syntheticCertificate({ subjectaltname: 'DNS:other.example.invalid' });
  const adapter = new XmppAdapter(false, {
    getTrustedCertificate: () => ({
      accountId: 'a@example.invalid',
      host: 'xmpp.example.invalid',
      port: 5222,
      transport: 'direct-tls',
      fingerprintSha256: certificate.fingerprint256,
      certificatePem: 'approved-pem',
      identityMismatchAuthorized: true,
      approvedAt: new Date().toISOString(),
    }),
  });
  adapter.probeDirectCertificate = async () => ({
    certificate,
    authorized: false,
    authorizationError: 'ERR_TLS_CERT_ALTNAME_INVALID',
  });
  const options = await adapter.resolveTlsOptions(
    {
      requestId: 'req-cert-identity-reuse',
      accountId: 'a@example.invalid',
      endpoint: { host: 'xmpp.example.invalid', port: 5222 },
    },
    7,
    { transport: 'direct-tls' },
  );
  assert.equal(options.allowIdentityMismatch, true);
  assert.equal(adapter.pendingDecisions.size, 0);
});

test('STARTTLS certificate approval emits the same single trust dialog event', async () => {
  const certificate = syntheticCertificate();
  const adapter = new XmppAdapter(false, { getTrustedCertificate: () => null });
  const events = [];
  adapter.onEvent((event) => events.push(event));
  adapter.probeStartTlsCertificate = async () => ({
    certificate,
    authorized: false,
    authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT',
  });
  const input = {
    requestId: 'req-starttls-cert',
    accountId: 'a@example.invalid',
    endpoint: { host: 'xmpp.example.invalid', domain: 'xmpp.example.invalid', port: 5222 },
  };
  const pending = adapter.resolveTlsOptions(input, 7, { transport: 'starttls' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events[0].type, 'certificate.trustRequired');
  assert.equal(events[0].payload.transport, 'starttls');
  adapter.decideCertificateTrust(7, {
    requestId: input.requestId,
    accountId: input.accountId,
    fingerprintSha256: certificate.fingerprint256,
    decision: 'trust_once',
  });
  const options = await pending;
  assert.match(options.ca, /BEGIN CERTIFICATE/);
});

test('persistent trust is scoped to account, endpoint, transport, and fingerprint', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'atomic-cert-trust-'));
  const store = new PersistenceStore(directory);
  store.upsertAccount({
    accountId: 'a@example.invalid',
    host: 'xmpp.example.invalid',
    port: 5222,
    tls: 1,
    credentialRef: null,
    createdAt: new Date().toISOString(),
  });
  store.upsertTrustedCertificate({
    accountId: 'a@example.invalid',
    host: 'xmpp.example.invalid',
    port: 5222,
    transport: 'direct-tls',
    fingerprintSha256: 'AA:BB',
    certificatePem: 'pem',
    approvedAt: new Date().toISOString(),
  });
  store.upsertTrustedCertificate({
    accountId: 'a@example.invalid',
    host: 'xmpp.example.invalid',
    port: 5222,
    transport: 'starttls',
    fingerprintSha256: 'CC:DD',
    certificatePem: 'pem-starttls',
    identityMismatchAuthorized: true,
    approvedAt: new Date().toISOString(),
  });
  assert.equal(
    store.getTrustedCertificate('a@example.invalid', 'xmpp.example.invalid', 5222, 'direct-tls')
      .fingerprintSha256,
    'AA:BB',
  );
  assert.equal(
    store.getTrustedCertificate('a@example.invalid', 'xmpp.example.invalid', 5222, 'starttls')
      .fingerprintSha256,
    'CC:DD',
  );
  assert.equal(
    store.getTrustedCertificate('a@example.invalid', 'xmpp.example.invalid', 5222, 'starttls')
      .identityMismatchAuthorized,
    true,
  );
  assert.equal(
    store.getTrustedCertificate('b@example.invalid', 'xmpp.example.invalid', 5222, 'direct-tls'),
    null,
  );
  store.close();
  fs.rmSync(directory, { recursive: true, force: true });
});

test('STARTTLS probe negotiates XMPP TLS before any SASL data', async () => {
  const server = net.createServer((socket) => {
    let request = '';
    socket.on('data', (chunk) => {
      request += chunk.toString();
      if (request.includes('<stream:stream'))
        socket.write(
          "<stream:stream xmlns:stream='http://etherx.jabber.org/streams'><stream:features><starttls xmlns='urn:ietf:params:xml:ns:xmpp-tls'/></stream:features>",
        );
      if (request.includes('<starttls'))
        socket.write("<proceed xmlns='urn:ietf:params:xml:ns:xmpp-tls'/>");
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const raw = await negotiateStartTls('127.0.0.1', port, 'example.invalid');
  assert.equal(raw.destroyed, false);
  raw.destroy();
  await new Promise((resolve) => server.close(resolve));
});

test('STARTTLS probe rejects a server that does not advertise STARTTLS', async () => {
  const server = net.createServer((socket) =>
    socket.once('data', () => {
      socket.write(
        "<stream:stream xmlns:stream='http://etherx.jabber.org/streams'><stream:features></stream:features>",
      );
      setTimeout(() => socket.destroy(), 20);
    }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await assert.rejects(
    () => negotiateStartTls('127.0.0.1', port, 'example.invalid'),
    (error) => error.code === 'STARTTLS_UNAVAILABLE',
  );
  await new Promise((resolve) => server.close(resolve));
});
