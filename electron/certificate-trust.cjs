const crypto = require('node:crypto');
const tls = require('node:tls');

const SELF_SIGNED_ERRORS = new Set(['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN']);
const INSECURE_SIGNATURES = /(?:md2|md4|md5|sha1|rc2|rc4)/i;

class CertificateVerificationFailure extends Error {
  constructor(code, message, certificate, verificationError) {
    super(message);
    this.name = 'CertificateVerificationFailure';
    this.code = code;
    this.certificate = certificate;
    this.verificationError = verificationError;
  }
}

function distinguishedName(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return Object.entries(value).map(([key, item]) => `${key}=${String(item)}`).join(', ');
}

function pemFromRaw(raw) {
  if (!Buffer.isBuffer(raw) || raw.length === 0) throw new Error('CERTIFICATE_UNAVAILABLE');
  const base64 = raw.toString('base64').match(/.{1,64}/g)?.join('\n') || '';
  return `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`;
}

function certificateFingerprint(certificate) {
  if (typeof certificate?.fingerprint256 === 'string' && certificate.fingerprint256) return certificate.fingerprint256;
  if (Buffer.isBuffer(certificate?.raw)) return crypto.createHash('sha256').update(certificate.raw).digest('hex').match(/.{2}/g).join(':').toUpperCase();
  throw new Error('CERTIFICATE_UNAVAILABLE');
}

function chainInfo(certificate) {
  const chain = [];
  const seen = new Set();
  let current = certificate;
  for (let index = 0; current && index < 8; index += 1) {
    const fingerprintSha256 = certificateFingerprint(current);
    if (seen.has(fingerprintSha256)) break;
    seen.add(fingerprintSha256);
    chain.push({ fingerprintSha256, subject: distinguishedName(current.subject), issuer: distinguishedName(current.issuer) });
    current = current.issuerCertificate;
  }
  return chain;
}

function describeCertificate(certificate) {
  const fingerprintSha256 = certificateFingerprint(certificate);
  return {
    fingerprintSha256,
    subject: distinguishedName(certificate.subject),
    issuer: distinguishedName(certificate.issuer),
    validFrom: String(certificate.valid_from || ''),
    validTo: String(certificate.valid_to || ''),
    subjectAltNames: typeof certificate.subjectaltname === 'string' ? certificate.subjectaltname.split(/,\s*/).filter(Boolean) : [],
    chain: chainInfo(certificate),
    ...(Number.isInteger(certificate.bits) ? { publicKeyBits: certificate.bits } : {}),
    ...(certificate.sigalg ? { signatureAlgorithm: String(certificate.sigalg) } : {}),
    pem: pemFromRaw(certificate.raw),
  };
}

function assessCertificate(host, certificate, authorized, authorizationError, now = Date.now()) {
  const info = describeCertificate(certificate);
  const starts = Date.parse(info.validFrom);
  const expires = Date.parse(info.validTo);
  if (Number.isFinite(starts) && now < starts) return { info, trustable: false, error: { code: 'CERTIFICATE_NOT_YET_VALID', message: 'El certificado todavía no está vigente.' } };
  if (Number.isFinite(expires) && now > expires) return { info, trustable: false, error: { code: 'CERTIFICATE_EXPIRED', message: 'El certificado está expirado.' } };
  const identityError = tls.checkServerIdentity(host, certificate);
  if (identityError) return { info, trustable: false, error: { code: 'CERTIFICATE_IDENTITY_MISMATCH', message: 'El certificado no corresponde con la identidad del servidor.' } };
  if (INSECURE_SIGNATURES.test(info.signatureAlgorithm || '')) return { info, trustable: false, error: { code: 'CERTIFICATE_INSECURE_ALGORITHM', message: 'El certificado usa un algoritmo criptográfico inseguro.' } };
  if (authorized && !authorizationError) return { info, trustable: false, error: undefined };
  if (SELF_SIGNED_ERRORS.has(authorizationError)) return { info, trustable: true, error: { code: 'CERTIFICATE_UNTRUSTED', message: 'El certificado autofirmado no está reconocido por el sistema.' } };
  return { info, trustable: false, error: { code: 'CERTIFICATE_UNTRUSTED', message: 'La cadena del certificado no pudo verificarse.' } };
}

function isSelfSignedError(code) { return SELF_SIGNED_ERRORS.has(code); }

module.exports = { CertificateVerificationFailure, assessCertificate, describeCertificate, isSelfSignedError };
