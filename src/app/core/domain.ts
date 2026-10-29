export type ContractVersion = 1;
export type RequestId = string;
export type ClientMessageId = string;
export type ContactAvailability =
  | 'available'
  | 'away'
  | 'extended-away'
  | 'dnd'
  | 'unavailable'
  | 'unknown';
export type Availability = ContactAvailability;
export type PresenceMode = 'chat' | 'away' | 'dnd' | 'xa';
export type XmppTransport = 'starttls' | 'direct-tls';
export type ConnectionMode = 'automatic' | 'manual';
export interface ManualXmppEndpoint {
  host: string;
  port: number;
  transport: XmppTransport;
}
export interface XmppConnectionProfile {
  accountId: string;
  domain: string;
  mode: ConnectionMode;
  manualEndpoint?: ManualXmppEndpoint;
  updatedAt: string;
  hasPersistentCredential?: boolean;
}
export type ConnectionStatus =
  'idle' | 'connecting' | 'authenticating' | 'connected' | 'disconnecting' | 'failed';
export type MessageStatus = 'draft' | 'queued' | 'sending' | 'sent' | 'failed';
export interface ConnectionState {
  accountId: string;
  status: ConnectionStatus;
  reason?: string;
  retryable: boolean;
  since: string;
}
export interface Presence {
  jid: string;
  availability: Availability;
  mode?: PresenceMode;
  status?: string;
  updatedAt: string;
}
export type RosterSubscription = 'none' | 'to' | 'from' | 'both';
export interface Contact {
  jid: string;
  name?: string;
  groups: string[];
  presence?: Presence;
  subscription?: RosterSubscription;
  ask?: 'subscribe';
  source?: 'roster' | 'conversation';
}
export interface Message {
  id: string;
  accountId: string;
  conversationId: string;
  clientMessageId: ClientMessageId;
  senderJid: string;
  body: { kind: 'text'; text: string };
  status: MessageStatus;
  createdAt: string;
  errorCode?: AppError['code'];
}
export interface HistoryPageInput {
  version: 1;
  requestId: string;
  accountId: string;
  conversationId: string;
  limit: number;
  direction: 'older' | 'newer';
  cursor?: string | null;
}
export interface HistoryPage {
  items: Message[];
  nextCursor: string | null;
  hasMore: boolean;
}
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
  | 'MUC_SERVER_REJECTED';
export interface AppError {
  code: AppErrorCode;
  retryable: boolean;
  requestId: RequestId;
  message: string;
  certificate?: CertificateVerificationError;
}
export type DecimalByteCount = string;
export type FileTransferStatus =
  | 'selecting'
  | 'offering'
  | 'awaiting_acceptance'
  | 'offered'
  | 'accepted'
  | 'transferring'
  | 'completed'
  | 'failed'
  | 'cancelled';
export type FileEndReason =
  | 'user_rejected'
  | 'cancelled_by_receiver'
  | 'cancelled_by_sender'
  | 'timed_out'
  | 'network_lost'
  | 'unsupported_method'
  | 'resource_limit'
  | 'invalid_protocol'
  | 'integrity_failed'
  | 'storage_failed';
export interface FileOffer {
  readonly transferId: string;
  readonly accountId: string;
  readonly conversationId: string;
  readonly senderJid: string;
  readonly recipientJid?: string;
  readonly name: string;
  readonly sizeBytes: DecimalByteCount;
  readonly mimeType?: string;
  readonly description?: string;
  readonly transport: 'ibb';
  readonly offeredAt: string;
}
export interface FileTransfer {
  readonly offer: FileOffer;
  readonly direction: 'incoming' | 'outgoing';
  readonly state: FileTransferStatus;
  readonly bytesTransferred: DecimalByteCount;
  readonly endReason?: FileEndReason;
  readonly errorCode?: AppErrorCode;
  readonly localActions?: {
    readonly open: boolean;
    readonly reveal: boolean;
  };
  readonly updatedAt: string;
}
export interface FileRequest {
  readonly version: 1;
  readonly requestId: RequestId;
  readonly accountId: string;
  readonly transferId: string;
}
export interface FileActiveInput {
  readonly version: 1;
  readonly requestId: RequestId;
  readonly accountId: string;
}
export interface FileSendInput {
  readonly version: 1;
  readonly requestId: RequestId;
  readonly accountId: string;
  readonly conversationId: string;
}
export interface FileDroppedSendInput extends FileSendInput {
  readonly file: File;
}
export type Result<T> =
  | { ok: true; value: T; version: ContractVersion; requestId: RequestId }
  | { ok: false; error: AppError; version: ContractVersion };
export type RoomId = string;
export type OccupantId = string;
export type MucRoomStatus = 'idle' | 'joining' | 'joined' | 'leaving' | 'failed';
export type MucRole = 'none' | 'visitor' | 'participant' | 'moderator';
export type MucAffiliation = 'none' | 'member' | 'admin' | 'owner';
export interface RoomRef {
  service: string;
  room: string;
  jid: RoomId;
}
export interface RoomParticipant {
  occupantJid: OccupantId;
  nick: string;
  role: MucRole;
  affiliation: MucAffiliation;
  availability: Availability;
}
export interface RoomState {
  accountId: string;
  room: RoomRef;
  status: MucRoomStatus;
  selfOccupantJid?: OccupantId;
  participants: ReadonlyArray<RoomParticipant>;
  sessionGeneration: number;
  errorCode?: AppError['code'];
}
export interface MucRequest {
  version: ContractVersion;
  requestId: RequestId;
  accountId: string;
}
export interface MucDiscoverInput extends MucRequest {}
export interface MucJoinInput extends MucRequest {
  roomJid: RoomId;
  nickname: string;
}
export interface MucLeaveInput extends MucRequest {
  roomJid: RoomId;
}
export interface MucSendInput extends MucRequest {
  roomJid: RoomId;
  clientMessageId: ClientMessageId;
  body: { kind: 'text'; text: string };
}
export interface RoomMessage {
  id: string;
  accountId: string;
  roomJid: RoomId;
  occupantJid: OccupantId;
  body: { kind: 'text'; text: string };
  receivedAt: string;
  clientMessageId?: ClientMessageId;
  source: 'live' | 'server-history';
  sessionGeneration: number;
}
export type MucNoticeCode = 'IDENTITY_VISIBLE' | 'PUBLIC_LOGGING' | 'SERVER_NICKNAME';
export interface MucNotice {
  accountId: string;
  roomJid: RoomId;
  code: MucNoticeCode;
  nickname?: string;
  sessionGeneration: number;
}
export interface RoomSendReceipt {
  accountId: string;
  roomJid: RoomId;
  clientMessageId: ClientMessageId;
  status: 'sent';
}
export type ChatState = 'active' | 'composing' | 'paused' | 'inactive' | 'gone';
export interface ChatStateEvent {
  accountId: string;
  conversationId: string;
  senderJid: string;
  state: ChatState;
}
export interface MucParticipantChangedPayload {
  accountId: string;
  room: RoomRef;
  participant: RoomParticipant;
  sessionGeneration: number;
}
export interface DomainEventPayloadMap {
  'connection.stateChanged': ConnectionState;
  'presence.changed': Presence & { accountId?: string };
  'roster.changed': unknown;
  'message.stateChanged': Message;
  'message.received': Message;
  'chatState.changed': ChatStateEvent;
  'certificate.trustRequired': CertificateTrustRequest;
  'muc.stateChanged': RoomState;
  'muc.participantChanged': MucParticipantChangedPayload;
  'muc.messageReceived': RoomMessage;
  'muc.notice': MucNotice;
  'file.offerReceived': FileOffer;
  'file.stateChanged': FileTransfer;
}
export type DomainEventType = keyof DomainEventPayloadMap;
export interface DomainEvent<T> {
  version: ContractVersion;
  eventId: string;
  correlationId?: RequestId | ClientMessageId;
  type: DomainEventType;
  payload: T;
}
export type TypedDomainEvent = {
  [Type in DomainEventType]: DomainEvent<DomainEventPayloadMap[Type]> & { type: Type };
}[DomainEventType];
export interface ConnectInput {
  version: ContractVersion;
  requestId: RequestId;
  accountId: string;
  endpoint?: {
    host: string;
    port: number;
    tls: boolean;
    transport?: XmppTransport;
    domain?: string;
    allowInsecureTls?: boolean;
  };
  profileId?: string;
  profileDomain?: string;
  credentialRef?: string;
}
export interface PresenceInput {
  version: ContractVersion;
  requestId: RequestId;
  accountId: string;
  availability: Exclude<Availability, 'unknown'>;
  mode?: PresenceMode;
  status?: string;
}

export interface ChatStateInput {
  version: ContractVersion;
  requestId: RequestId;
  accountId: string;
  conversationId: string;
  state: ChatState;
}

export interface ConversationSummary {
  id: string;
  accountId: string;
  kind: 'direct' | 'muc';
  jid: string;
  title: string;
  unreadCount: number;
  lastMessageAt?: number;
}

export type ActiveConversation =
  | {
      readonly accountId: string;
      readonly kind: 'direct' | 'muc';
      readonly jid: string;
    }
  | null;

export interface AttentionState {
  accountId: string;
  unreadTotal: number;
  attentionRequested: boolean;
}
export interface AttentionRequest {
  version: ContractVersion;
  requestId: RequestId;
  accountId: string;
  conversationId: string;
}
export interface AttentionClearRequest {
  version: ContractVersion;
  requestId: RequestId;
  accountId: string;
}
export interface MessageSendInput {
  version: ContractVersion;
  requestId: RequestId;
  accountId: string;
  conversationId: string;
  clientMessageId: ClientMessageId;
  body: { kind: 'text'; text: string };
}
export type ThemeId = 'atomic' | 'custom';
export type ThemeColorKey =
  | 'background'
  | 'surface'
  | 'surfaceRaised'
  | 'accent'
  | 'text'
  | 'textSecondary'
  | 'border'
  | 'incomingBubble'
  | 'outgoingBubble'
  | 'focus';
export type HexColor = string;
export type ThemePalette = Readonly<Record<ThemeColorKey, HexColor>>;

export interface Preferences {
  theme: ThemeId;
  customTheme?: ThemePalette;
  notifications: boolean;
  autoLogin: boolean;
}
