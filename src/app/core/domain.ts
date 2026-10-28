export type ContractVersion = 1;
export type RequestId = string;
export type ClientMessageId = string;
export type Availability = 'available' | 'unavailable';
export type PresenceMode = 'chat' | 'away' | 'dnd' | 'xa';
export type ConnectionStatus = 'idle' | 'connecting' | 'authenticating' | 'connected' | 'disconnecting' | 'failed';
export type MessageStatus = 'draft' | 'queued' | 'sending' | 'sent' | 'failed';
export interface ConnectionState { accountId: string; status: ConnectionStatus; reason?: string; retryable: boolean; since: string; }
export interface Presence { jid: string; availability: Availability; mode?: PresenceMode; status?: string; updatedAt: string; }
export type RosterSubscription = 'none' | 'to' | 'from' | 'both';
export interface Contact { jid: string; name?: string; groups: string[]; presence?: Presence; subscription?: RosterSubscription; ask?: 'subscribe'; source?: 'roster' | 'conversation'; }
export interface Message { id: string; accountId: string; conversationId: string; clientMessageId: ClientMessageId; senderJid: string; body: { kind: 'text'; text: string }; status: MessageStatus; createdAt: string; errorCode?: AppError['code']; }
export interface HistoryPageInput { version: 1; requestId: string; accountId: string; conversationId: string; limit: number; direction: 'older' | 'newer'; cursor?: string | null; }
export interface HistoryPage { items: Message[]; nextCursor: string | null; hasMore: boolean; }
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
export type CertificateVerificationErrorCode = 'CERTIFICATE_EXPIRED' | 'CERTIFICATE_NOT_YET_VALID' | 'CERTIFICATE_IDENTITY_MISMATCH' | 'CERTIFICATE_UNTRUSTED' | 'CERTIFICATE_INSECURE_ALGORITHM' | 'CERTIFICATE_REVOKED' | 'CERTIFICATE_UNAVAILABLE';
export interface CertificateVerificationError { code: CertificateVerificationErrorCode; message: string; }
export type CertificateTrustDecision = 'cancel' | 'trust_once' | 'trust_and_remember';
export interface TrustedCertificateRecord { accountId: string; host: string; port: number; transport: 'direct-tls'; fingerprintSha256: string; certificatePem: string; approvedAt: string; }
export interface CertificateTrustRequest { requestId: RequestId; accountId: string; host: string; port: number; transport: 'direct-tls'; certificate: CertificateInfo; verificationError?: CertificateVerificationError; previous?: TrustedCertificateRecord; }
export interface CertificateTrustDecisionInput { version: ContractVersion; requestId: RequestId; accountId: string; fingerprintSha256: string; decision: CertificateTrustDecision; }
export type AppErrorCode = 'INVALID_INPUT' | 'UNAUTHORIZED' | 'NOT_CONNECTED' | 'TIMEOUT' | 'AUTH_FAILED' | 'TRANSPORT_FAILED' | 'CONFLICT' | 'STORAGE_FAILED' | 'UNSUPPORTED' | 'INTERNAL' | 'CERTIFICATE_REJECTED' | 'CERTIFICATE_INVALID' | 'CERTIFICATE_CHANGED' | 'CERTIFICATE_DECISION_TIMEOUT';
export interface AppError { code: AppErrorCode; retryable: boolean; requestId: RequestId; message: string; certificate?: CertificateVerificationError; }
export type Result<T> = { ok: true; value: T; version: ContractVersion; requestId: RequestId } | { ok: false; error: AppError; version: ContractVersion };
export interface DomainEvent<T> { version: ContractVersion; eventId: string; correlationId?: RequestId | ClientMessageId; type: 'connection.stateChanged' | 'presence.changed' | 'roster.changed' | 'message.stateChanged' | 'message.received' | 'certificate.trustRequired'; payload: T; }
export interface ConnectInput { version: ContractVersion; requestId: RequestId; accountId: string; endpoint: { host: string; port: number; tls: boolean; allowInsecureTls?: boolean }; credentialRef?: string; }
export interface PresenceInput { version: ContractVersion; requestId: RequestId; accountId: string; availability: Availability; mode?: PresenceMode; status?: string; }
export interface MessageSendInput { version: ContractVersion; requestId: RequestId; accountId: string; conversationId: string; clientMessageId: ClientMessageId; body: { kind: 'text'; text: string }; }
export interface Preferences { theme: 'atomic'; notifications: boolean; autoLogin: boolean; }
