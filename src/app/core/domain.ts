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
export type MessagePersistenceStatus = 'persisted' | 'memory-only';
export type MessageClassification = 'direct' | 'broadcast';
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
  classification?: MessageClassification;
  errorCode?: AppError['code'];
  persistenceStatus?: MessagePersistenceStatus;
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
  | 'MUC_SERVER_REJECTED'
  | 'RESOURCE_CONSTRAINT'
  | 'MEDIA_PREVIEW_UNAVAILABLE'
  | 'MEDIA_TYPE_UNSUPPORTED'
  | 'MEDIA_SIZE_EXCEEDED'
  | 'MEDIA_DIMENSIONS_INVALID'
  | 'MEDIA_DECODE_FAILED'
  | 'MEDIA_REFERENCE_REVOKED'
  | 'SEND_RESULT_UNKNOWN';
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
export type StaticImageMimeType = 'image/png' | 'image/jpeg';
export type ImagePreviewState = 'ready' | 'unsupported' | 'unavailable' | 'revoked' | 'failed';
export type ImagePreviewFailureCode =
  | 'MEDIA_PREVIEW_UNAVAILABLE'
  | 'MEDIA_TYPE_UNSUPPORTED'
  | 'MEDIA_SIZE_EXCEEDED'
  | 'MEDIA_DIMENSIONS_INVALID'
  | 'MEDIA_DECODE_FAILED'
  | 'MEDIA_REFERENCE_REVOKED';
export interface ImagePreviewReady {
  readonly state: 'ready';
  readonly previewId: string;
  readonly accountId: string;
  readonly transferId: string;
  readonly mimeType: StaticImageMimeType;
  readonly sizeBytes: DecimalByteCount;
  readonly width: number;
  readonly height: number;
  readonly expiresAt: string;
  readonly mediaId?: string;
  readonly conversationId?: string;
}
export interface ImagePreviewUnavailable {
  readonly state: Exclude<ImagePreviewState, 'ready'>;
  readonly accountId: string;
  readonly transferId: string;
  readonly reasonCode: ImagePreviewFailureCode;
}
export type ImagePreviewRef = ImagePreviewReady | ImagePreviewUnavailable;
export interface ImagePreviewRequest {
  readonly version: ContractVersion;
  readonly requestId: RequestId;
  readonly accountId: string;
  readonly transferId: string;
  readonly conversationId?: string;
  readonly mediaId?: string;
}
export interface PreviewOpenRequest extends ImagePreviewRequest {
  readonly previewId: string;
}
export interface PreviewStreamRef {
  readonly previewId: string;
  readonly streamId: string;
  readonly expiresAt: string;
  readonly chunkSize: number;
}
export interface PreviewReadRequest extends ImagePreviewRequest {
  readonly previewId: string;
  readonly streamId: string;
  readonly sequence: number;
}
export interface PreviewChunk {
  readonly previewId: string;
  readonly streamId: string;
  readonly sequence: number;
  readonly bytes: ArrayBuffer;
  readonly done: boolean;
}
export interface PreviewCloseRequest extends ImagePreviewRequest {
  readonly previewId: string;
  readonly streamId: string;
}
export interface ImagePreviewRevokeRequest extends ImagePreviewRequest {
  readonly previewId: string;
}

export type StickerAssetAvailability = 'pending' | 'available' | 'missing' | 'invalid' | 'blocked';
export interface StickerAssetRecord {
  readonly assetId: string;
  readonly accountId: string;
  readonly kind: 'static-image';
  readonly mimeType: StaticImageMimeType;
  readonly hash: { readonly algorithm: 'sha-256'; readonly value: string };
  readonly sizeBytes: DecimalByteCount;
  readonly width: number;
  readonly height: number;
  readonly availability: StickerAssetAvailability;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface StickerRecord {
  readonly stickerId: string;
  readonly accountId: string;
  readonly assetId: string;
  readonly name?: string;
  readonly altText?: string;
  readonly fallbackText?: string;
  readonly sortKey: string;
  readonly availability: StickerAssetAvailability;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface StickerLibrarySnapshot {
  readonly accountId: string;
  readonly collectionId: 'my-stickers' | `pack:${string}`;
  readonly query: string;
  readonly stickers: ReadonlyArray<StickerRecord>;
}
export interface StickerImportRequest {
  readonly version: ContractVersion;
  readonly requestId: RequestId;
  readonly accountId: string;
}
export interface StickerImportResult {
  readonly sticker: StickerRecord;
  readonly asset: StickerAssetRecord;
  readonly deduplicated: boolean;
}
export interface StickerListRequest {
  readonly version: ContractVersion;
  readonly requestId: RequestId;
  readonly accountId: string;
  readonly query?: string;
  readonly limit?: number;
  readonly packId?: string;
}
export interface StickerDeleteRequest {
  readonly version: ContractVersion;
  readonly requestId: RequestId;
  readonly accountId: string;
  readonly stickerId: string;
}

export type StickerPackSource = 'created';
export type StickerPackStatus = 'installed';
export interface StickerPackDTO {
  readonly packId: string;
  readonly accountId: string;
  readonly source: StickerPackSource;
  readonly status: StickerPackStatus;
  readonly name: string;
  readonly description?: string;
  readonly stickerIds: readonly string[];
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export type StickerDraftStatus = 'editing' | 'validating' | 'ready' | 'failed' | 'saved' | 'discarded';
export interface StickerDraftDTO {
  readonly draftId: string;
  readonly accountId: string;
  readonly basePackId?: string;
  readonly basePackRevision?: number;
  readonly status: StickerDraftStatus;
  readonly name: string;
  readonly description?: string;
  readonly stickerIds: readonly string[];
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface StickerPackListSnapshot {
  readonly accountId: string;
  readonly packs: ReadonlyArray<StickerPackDTO>;
}
export interface StickerDraftListSnapshot {
  readonly accountId: string;
  readonly drafts: ReadonlyArray<StickerDraftDTO>;
}
export interface StickerPackListRequest {
  readonly version: ContractVersion;
  readonly requestId: RequestId;
  readonly accountId: string;
}
export interface StickerPackGetRequest extends StickerPackListRequest {
  readonly packId: string;
}
export interface StickerPackSaveRequest extends StickerPackListRequest {
  readonly packId?: string;
  readonly revision: number;
  readonly name: string;
  readonly description?: string;
  readonly stickerIds: readonly string[];
}
export interface StickerPackDeleteRequest extends StickerPackGetRequest {
  readonly revision: number;
}
export interface StickerDraftCreateRequest extends StickerPackListRequest {
  readonly basePackId?: string;
}
export interface StickerDraftGetRequest extends StickerPackListRequest {
  readonly draftId: string;
}
export interface StickerDraftUpdateRequest extends StickerDraftGetRequest {
  readonly revision: number;
  readonly name: string;
  readonly description?: string;
  readonly stickerIds: readonly string[];
}
export interface StickerDraftDiscardRequest extends StickerDraftGetRequest {
  readonly revision: number;
}
export interface StickerDraftCommitRequest extends StickerDraftGetRequest {
  readonly revision: number;
}
export interface StickerPreviewGetRequest {
  readonly version: ContractVersion;
  readonly requestId: RequestId;
  readonly accountId: string;
  readonly stickerId: string;
}
export interface StickerPreviewGrant {
  readonly grantId: string;
  readonly accountId: string;
  readonly stickerId: string;
  readonly assetId: string;
  readonly expiresAt: string;
  readonly mimeType: StaticImageMimeType;
  readonly sizeBytes: DecimalByteCount;
  readonly width: number;
  readonly height: number;
  readonly chunkSize: number;
}
export interface StickerPreviewOpenRequest extends StickerPreviewGetRequest {
  readonly grantId: string;
}
export interface StickerPreviewStreamRef {
  readonly grantId: string;
  readonly streamId: string;
  readonly accountId: string;
  readonly assetId: string;
  readonly expiresAt: string;
  readonly chunkSize: number;
}
export interface StickerPreviewReadRequest extends StickerPreviewOpenRequest {
  readonly streamId: string;
  readonly sequence: number;
}
export interface StickerPreviewChunk {
  readonly grantId: string;
  readonly streamId: string;
  readonly sequence: number;
  readonly bytes: ArrayBuffer;
  readonly done: boolean;
}
export interface StickerPreviewCloseRequest extends StickerPreviewOpenRequest {
  readonly streamId: string;
}
export interface StickerPreviewRevokeRequest extends StickerPreviewGetRequest {
  readonly grantId: string;
}

export type ChatMediaDirection = 'incoming' | 'outgoing';
export type ChatMediaAvailability = 'available' | 'missing' | 'invalid';
export interface ChatImageRecord {
  readonly mediaId: string;
  readonly transferId: string;
  readonly accountId: string;
  readonly conversationId: string;
  readonly direction: ChatMediaDirection;
  readonly senderJid: string;
  readonly originalName: string;
  readonly mimeType: StaticImageMimeType;
  readonly sizeBytes: DecimalByteCount;
  readonly width: number;
  readonly height: number;
  readonly createdAt: string;
  readonly availability: ChatMediaAvailability;
}
export type StickerMessageTransportStatus = 'queued' | 'uploading' | 'sending' | 'sent' | 'failed';
export type StickerMessageAvailability = 'available' | 'missing' | 'invalid' | 'blocked';
export interface StickerMessageRef {
  readonly refId: string;
  readonly previewStickerId: string;
  readonly accountId: string;
  readonly conversationId: string;
  readonly clientMessageId: ClientMessageId;
  readonly stanzaId?: string;
  readonly originId?: string;
  readonly direction: ChatMediaDirection;
  readonly senderJid: string;
  readonly sourceStickerId?: string;
  readonly savedStickerId?: string;
  readonly name?: string;
  readonly altText?: string;
  readonly fallbackText?: string;
  readonly mimeType: StaticImageMimeType;
  readonly sizeBytes: DecimalByteCount;
  readonly width: number;
  readonly height: number;
  readonly hashAlgorithm: 'sha-256';
  readonly hashValue: string;
  readonly remoteUrl?: string;
  readonly localAssetId?: string;
  readonly transportStatus: StickerMessageTransportStatus;
  readonly availability: StickerMessageAvailability;
  readonly errorCode?: AppErrorCode;
  readonly createdAt: string;
  readonly updatedAt: string;
}
export interface StickerCapability {
  readonly accountId: string;
  readonly supported: boolean;
  readonly uploadService?: string;
  readonly maxFileSize?: DecimalByteCount;
  readonly sessionGeneration: number;
  readonly expiresAt: string;
}
export interface StickerCapabilityRequest {
  readonly version: ContractVersion;
  readonly requestId: RequestId;
  readonly accountId: string;
}
export interface StickerSendRequest {
  readonly version: 1;
  readonly requestId: RequestId;
  readonly accountId: string;
  readonly conversationId: string;
  readonly clientMessageId: ClientMessageId;
  readonly stickerId: string;
}
export interface StickerMessageLoadRequest {
  readonly version: 1;
  readonly requestId: RequestId;
  readonly accountId: string;
  readonly conversationId: string;
  readonly refId: string;
}
export interface StickerMessageSaveRequest {
  readonly version: 1;
  readonly requestId: RequestId;
  readonly accountId: string;
  readonly conversationId: string;
  readonly refId: string;
}
export type ChatFileAvailability = 'unchecked' | 'available' | 'missing' | 'changed' | 'blocked';
export interface ChatFileHistoryRecord {
  readonly fileId: string;
  readonly accountId: string;
  readonly conversationId: string;
  readonly transferId: string;
  readonly direction: ChatMediaDirection;
  readonly senderJid: string;
  readonly originalName: string;
  readonly sizeBytes: DecimalByteCount;
  readonly mimeType?: string;
  readonly createdAt: string;
  readonly availability: ChatFileAvailability;
}
export interface FileHistoryRequest {
  readonly version: ContractVersion;
  readonly requestId: RequestId;
  readonly accountId: string;
  readonly conversationId: string;
  readonly fileId: string;
}
export interface MediaListInput {
  readonly version: 1;
  readonly requestId: RequestId;
  readonly accountId: string;
  readonly conversationId?: string;
  readonly limit?: number;
}
export type HistoryTimelineItem =
  | {
      readonly kind: 'text';
      readonly id: string;
      readonly sortAt: string;
      readonly message: Message;
    }
  | {
      readonly kind: 'image';
      readonly id: string;
      readonly sortAt: string;
      readonly media: ChatImageRecord;
    }
  | {
      readonly kind: 'file';
      readonly id: string;
      readonly sortAt: string;
      readonly file: ChatFileHistoryRecord;
    }
  | {
      readonly kind: 'sticker';
      readonly id: string;
      readonly sortAt: string;
      readonly sticker: StickerMessageRef;
    };
export interface TimelinePageInput {
  readonly version: 1;
  readonly requestId: RequestId;
  readonly accountId: string;
  readonly conversationId: string;
  readonly limit: number;
  readonly direction: 'older' | 'newer';
  readonly cursor?: string | null;
}
export interface TimelinePage {
  readonly items: ReadonlyArray<HistoryTimelineItem>;
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
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
  'media.available': ChatImageRecord;
  'sticker.messageReceived': StickerMessageRef;
  'sticker.stateChanged': StickerMessageRef;
  'sticker.capabilityChanged': StickerCapability;
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
export type BroadcastMode = 'normal' | 'alert';
export interface BroadcastRequest {
  readonly broadcastId: RequestId;
  readonly accountId: string;
  readonly mode: BroadcastMode;
  readonly body: string;
  readonly recipientJids: readonly string[];
}
export type BroadcastRecipientStatus = 'submitted' | 'failed' | 'unknown';
export interface BroadcastRecipientResult {
  readonly recipientJid: string;
  readonly clientMessageId: ClientMessageId;
  readonly status: BroadcastRecipientStatus;
  readonly errorCode?: AppErrorCode;
}
export interface BroadcastResult {
  readonly broadcastId: RequestId;
  readonly recipients: readonly BroadcastRecipientResult[];
}
export interface BroadcastSendInput {
  readonly version: ContractVersion;
  readonly requestId: RequestId;
  readonly accountId: string;
  readonly broadcastId: RequestId;
  readonly mode?: BroadcastMode;
  readonly recipientJids: readonly string[];
  readonly body: { readonly kind: 'text'; readonly text: string };
}
export type BroadcastSendResult = BroadcastResult;
export type ThemeId = 'atomic' | 'atomic-light' | 'custom';
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
  autoAcceptFileTransfers: boolean;
  autoLogin: boolean;
  hideClosedConversations: boolean;
  fileTransferTimeoutSeconds: 60 | 180 | 300 | 600;
  downloadDirectory: string;
}
