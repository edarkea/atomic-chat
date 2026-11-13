const crypto = require('node:crypto');
const tls = require('node:tls');

const SELF_SIGNED_ERRORS = new Set(['DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN']);
const INSECURE_SIGNATURES = /(?:md2|md4|md5|sha1|rc2|rc4)/i;

/**
 * @typedef {{fingerprintSha256: string, subject: string, issuer: string, validFrom: string, validTo: string, subjectAltNames: string[], chain: Array<{fingerprintSha256: string, subject: string, issuer: string}>, publicKeyBits?: number, signatureAlgorithm?: string, pem: string}} CertificateInfo
 * @typedef {{code: string, message: string}} VerificationError
 * @typedef {{code: string, message: string}} CertificateFailure
 * @typedef {import('node:tls').PeerCertificate & {issuerCertificate?: AtomicPeerCertificate, sigalg?: string}} AtomicPeerCertificate
 */

/**
 * @param {string} code
 * @param {string} message
 * @param {CertificateInfo} certificate
 * @param {VerificationError | undefined} verificationError
 */
class CertificateVerificationFailure extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {CertificateInfo} certificate
   * @param {VerificationError | undefined} [verificationError]
   */
  constructor(code, message, certificate, verificationError) {
    super(message);
    this.name = 'CertificateVerificationFailure';
    Object.assign(this, { code, certificate, verificationError });
  }
}

/** @param {unknown} value @returns {string} */
function distinguishedName(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return Object.entries(value)
    .map(([key, item]) => `${key}=${String(item)}`)
    .join(', ');
}

/** @param {Buffer} raw @returns {string} */
function pemFromRaw(raw) {
  if (!Buffer.isBuffer(raw) || raw.length === 0) throw new Error('CERTIFICATE_UNAVAILABLE');
  const lines = raw.toString('base64').match(/.{1,64}/g);
  const base64 = lines ? lines.join('\n') : '';
  return `-----BEGIN CERTIFICATE-----\n${base64}\n-----END CERTIFICATE-----\n`;
}

/** @param {AtomicPeerCertificate} certificate @returns {string} */
function certificateFingerprint(certificate) {
  if (typeof certificate?.fingerprint256 === 'string' && certificate.fingerprint256)
    return certificate.fingerprint256;
  if (Buffer.isBuffer(certificate?.raw)) {
    const octets = crypto.createHash('sha256').update(certificate.raw).digest('hex').match(/.{2}/g);
    return octets ? octets.join(':').toUpperCase() : '';
  }
  throw new Error('CERTIFICATE_UNAVAILABLE');
}

/**
 * @param {AtomicPeerCertificate} certificate
 * @returns {Array<{fingerprintSha256: string, subject: string, issuer: string}>}
 */
function chainInfo(certificate) {
  const chain = [];
  const seen = new Set();
  /** @type {AtomicPeerCertificate | undefined} */
  let current = certificate;
  for (let index = 0; current && index < 8; index += 1) {
    const fingerprintSha256 = certificateFingerprint(current);
    if (seen.has(fingerprintSha256)) break;
    seen.add(fingerprintSha256);
    chain.push({
      fingerprintSha256,
      subject: distinguishedName(current.subject),
      issuer: distinguishedName(current.issuer),
    });
    current = current.issuerCertificate;
  }
  return chain;
}

/**
 * @param {AtomicPeerCertificate} certificate
 * @returns {CertificateInfo}
 */
function describeCertificate(certificate) {
  const fingerprintSha256 = certificateFingerprint(certificate);
  return {
    fingerprintSha256,
    subject: distinguishedName(certificate.subject),
    issuer: distinguishedName(certificate.issuer),
    validFrom: String(certificate.valid_from || ''),
    validTo: String(certificate.valid_to || ''),
    subjectAltNames:
      typeof certificate.subjectaltname === 'string'
        ? certificate.subjectaltname.split(/,\s*/).filter(Boolean)
        : [],
    chain: chainInfo(certificate),
    ...(Number.isInteger(certificate.bits) ? { publicKeyBits: certificate.bits } : {}),
    ...(certificate.sigalg ? { signatureAlgorithm: String(certificate.sigalg) } : {}),
    pem: pemFromRaw(certificate.raw),
  };
}

/**
 * @param {string} host
 * @param {AtomicPeerCertificate} certificate
 * @param {boolean} authorized
 * @param {string | undefined} authorizationError
 * @param {number} [now=Date.now()]
 * @returns {{info: CertificateInfo, trustable: boolean, error: CertificateFailure | undefined}}
 */
function assessCertificate(host, certificate, authorized, authorizationError, now = Date.now()) {
  const info = describeCertificate(certificate);
  const starts = Date.parse(info.validFrom);
  const expires = Date.parse(info.validTo);
  if (Number.isFinite(starts) && now < starts)
    return {
      info,
      trustable: false,
      error: {
        code: 'CERTIFICATE_NOT_YET_VALID',
        message: 'El certificado todavía no está vigente.',
      },
    };
  if (Number.isFinite(expires) && now > expires)
    return {
      info,
      trustable: false,
      error: { code: 'CERTIFICATE_EXPIRED', message: 'El certificado está expirado.' },
    };
  if (INSECURE_SIGNATURES.test(info.signatureAlgorithm || ''))
    return {
      info,
      trustable: false,
      error: {
        code: 'CERTIFICATE_INSECURE_ALGORITHM',
        message: 'El certificado usa un algoritmo criptográfico inseguro.',
      },
    };
  const identityError = tls.checkServerIdentity(host, certificate);
  if (identityError)
    return {
      info,
      trustable: true,
      error: {
        code: 'CERTIFICATE_IDENTITY_MISMATCH',
        message:
          'La identidad del certificado no coincide con el servidor. Aceptarlo permite confiar explícitamente en esta huella aunque el nombre no coincida.',
      },
    };
  if (authorized && !authorizationError) return { info, trustable: false, error: undefined };
  if (authorizationError !== undefined && SELF_SIGNED_ERRORS.has(authorizationError))
    return {
      info,
      trustable: true,
      error: {
        code: 'CERTIFICATE_UNTRUSTED',
        message: 'El certificado autofirmado no está reconocido por el sistema.',
      },
    };
  return {
    info,
    trustable: false,
    error: {
      code: 'CERTIFICATE_UNTRUSTED',
      message: 'La cadena del certificado no pudo verificarse.',
    },
  };
}

/** @param {string} code @returns {boolean} */
function isSelfSignedError(code) {
  return SELF_SIGNED_ERRORS.has(code);
}

module.exports = {
  CertificateVerificationFailure,
  assessCertificate,
  certificateFingerprint,
  describeCertificate,
  isSelfSignedError,
};
