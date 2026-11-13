import type { ContractVersion, RequestId, XmppTransport } from './domain-primitives';

export interface CertificateInfo {
  fingerprintSha256: string;
  subject: string;
  issuer: string;
  validFrom: string;
  validTo: string;
  subjectAltNames: string[];
  chain: Array<{ fingerprintSha256: string; subject: string; issuer: string }>;
  publicKeyAlgorithm?: string;
  publicKeyBits?: number;
  signatureAlgorithm?: string;
  pem: string;
}

export type CertificateVerificationErrorCode =
  | 'CERTIFICATE_EXPIRED'
  | 'CERTIFICATE_NOT_YET_VALID'
  | 'CERTIFICATE_IDENTITY_MISMATCH'
  | 'CERTIFICATE_UNTRUSTED'
  | 'CERTIFICATE_INSECURE_ALGORITHM'
  | 'CERTIFICATE_REVOKED'
  | 'CERTIFICATE_UNAVAILABLE';

export interface CertificateVerificationError {
  code: CertificateVerificationErrorCode;
  message: string;
}

export type CertificateTrustDecision = 'cancel' | 'trust_once' | 'trust_and_remember';

export interface TrustedCertificateRecord {
  accountId: string;
  host: string;
  port: number;
  transport: XmppTransport;
  fingerprintSha256: string;
  certificatePem: string;
  approvedAt: string;
}

export interface CertificateTrustRequest {
  requestId: RequestId;
  accountId: string;
  host: string;
  port: number;
  transport: XmppTransport;
  certificate: CertificateInfo;
  verificationError?: CertificateVerificationError;
  previous?: TrustedCertificateRecord;
}

export interface CertificateTrustDecisionInput {
  version: ContractVersion;
  requestId: RequestId;
  accountId: string;
  fingerprintSha256: string;
  decision: CertificateTrustDecision;
}

export type AppErrorCode =
  | 'INVALID_INPUT'
  | 'UNAUTHORIZED'
  | 'NOT_CONNECTED'
  | 'TIMEOUT'
  | 'AUTH_FAILED'
  | 'TRANSPORT_FAILED'
  | 'SERVER_UNREACHABLE'
  | 'TRANSPORT_INCOMPATIBLE'
  | 'STARTTLS_UNAVAILABLE'
  | 'TLS_NEGOTIATION_FAILED'
  | 'CONFLICT'
  | 'STORAGE_FAILED'
  | 'UNSUPPORTED'
  | 'INTERNAL'
  | 'CERTIFICATE_REJECTED'
  | 'CERTIFICATE_INVALID'
  | 'CERTIFICATE_CHANGED'
  | 'CERTIFICATE_DECISION_TIMEOUT'
  | 'INVALID_ENDPOINT'
  | 'INVALID_DOMAIN'
  | 'INVALID_DNS_RESPONSE'
  | 'SERVICE_UNAVAILABLE'
  | 'DNS_TIMEOUT'
  | 'MUC_POLICY_MISSING'
  | 'MUC_POLICY_MISMATCH'
  | 'MUC_DISCOVERY_STALE'
  | 'MUC_SERVER_REJECTED'
  | 'RESOURCE_CONSTRAINT'
  | 'MEDIA_PREVIEW_UNAVAILABLE'
  | 'MEDIA_TYPE_UNSUPPORTED'
  | 'MEDIA_SIZE_EXCEEDED'
  | 'MEDIA_DIMENSIONS_INVALID'
  | 'MEDIA_DECODE_FAILED'
  | 'MEDIA_REFERENCE_REVOKED'
  | 'SEND_IN_PROGRESS'
  | 'SEND_RESULT_UNKNOWN';

export interface AppError {
  code: AppErrorCode;
  retryable: boolean;
  requestId: RequestId;
  message: string;
  certificate?: CertificateVerificationError;
}
