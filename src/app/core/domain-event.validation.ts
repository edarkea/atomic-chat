import {
  CertificateInfo,
  CertificateTrustRequest,
  ConnectionState,
  AppErrorCode,
  CertificateVerificationErrorCode,
  ChatImageRecord,
  ChatStateEvent,
  DomainEventPayloadMap,
  DomainEventType,
  FileOffer,
  FileTransfer,
  Message,
  MucNotice,
  MucNoticeCode,
  MucParticipantChangedPayload,
  Presence,
  RoomMessage,
  RoomParticipant,
  RoomRef,
  RoomState,
  StickerCapability,
  StickerMessageRef,
  TypedDomainEvent,
} from './domain';

interface EventRecord {
  accountId?: unknown;
  affiliation?: unknown;
  body?: unknown;
  bytesTransferred?: unknown;
  certificate?: unknown;
  certificatePem?: unknown;
  chain?: unknown;
  clientMessageId?: unknown;
  classification?: unknown;
  code?: unknown;
  conversationId?: unknown;
  correlationId?: unknown;
  createdAt?: unknown;
  expiresAt?: unknown;
  description?: unknown;
  direction?: unknown;
  stanzaId?: unknown;
  originId?: unknown;
  sourceStickerId?: unknown;
  altText?: unknown;
  fallbackText?: unknown;
  endReason?: unknown;
  errorCode?: unknown;
  eventId?: unknown;
  fingerprintSha256?: unknown;
  host?: unknown;
  id?: unknown;
  issuer?: unknown;
  jid?: unknown;
  kind?: unknown;
  localActions?: unknown;
  open?: unknown;
  reveal?: unknown;
  message?: unknown;
  mimeType?: unknown;
  mode?: unknown;
  name?: unknown;
  originalName?: unknown;
  nickname?: unknown;
  occupantJid?: unknown;
  offer?: unknown;
  offeredAt?: unknown;
  participant?: unknown;
  participants?: unknown;
  pem?: unknown;
  persistenceStatus?: unknown;
  port?: unknown;
  publicKeyAlgorithm?: unknown;
  publicKeyBits?: unknown;
  previous?: unknown;
  approvedAt?: unknown;
  reason?: unknown;
  receivedAt?: unknown;
  recipientJid?: unknown;
  requestId?: unknown;
  retryable?: unknown;
  room?: unknown;
  roomJid?: unknown;
  role?: unknown;
  senderJid?: unknown;
  selfOccupantJid?: unknown;
  service?: unknown;
  sessionGeneration?: unknown;
  signatureAlgorithm?: unknown;
  since?: unknown;
  sizeBytes?: unknown;
  mediaId?: unknown;
  width?: unknown;
  height?: unknown;
  text?: unknown;
  nick?: unknown;
  source?: unknown;
  state?: unknown;
  status?: unknown;
  subject?: unknown;
  subjectAltNames?: unknown;
  transferId?: unknown;
  transport?: unknown;
  type?: unknown;
  updatedAt?: unknown;
  supported?: unknown;
  uploadService?: unknown;
  maxFileSize?: unknown;
  refId?: unknown;
  previewStickerId?: unknown;
  hashAlgorithm?: unknown;
  hashValue?: unknown;
  remoteUrl?: unknown;
  localAssetId?: unknown;
  transportStatus?: unknown;
  availability?: unknown;
  validFrom?: unknown;
  validTo?: unknown;
  verificationError?: unknown;
  version?: unknown;
  payload?: unknown;
}

function isRecord(value: unknown): value is EventRecord & Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}
function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || isString(value);
}
function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
function isOptionalNumber(value: unknown): value is number | undefined {
  return value === undefined || isNumber(value);
}
function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}
function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}
function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}
function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return isString(value) && values.includes(value as T);
}
function isOptionalOneOf<T extends string>(
  value: unknown,
  values: readonly T[],
): value is T | undefined {
  return value === undefined || isOneOf(value, values);
}

const appErrorCodes: readonly AppErrorCode[] = [
  'INVALID_INPUT',
  'UNAUTHORIZED',
  'NOT_CONNECTED',
  'TIMEOUT',
  'AUTH_FAILED',
  'TRANSPORT_FAILED',
  'SERVER_UNREACHABLE',
  'TRANSPORT_INCOMPATIBLE',
  'STARTTLS_UNAVAILABLE',
  'TLS_NEGOTIATION_FAILED',
  'CONFLICT',
  'STORAGE_FAILED',
  'UNSUPPORTED',
  'INTERNAL',
  'CERTIFICATE_REJECTED',
  'CERTIFICATE_INVALID',
  'CERTIFICATE_CHANGED',
  'CERTIFICATE_DECISION_TIMEOUT',
  'MUC_POLICY_MISSING',
  'MUC_POLICY_MISMATCH',
  'MUC_DISCOVERY_STALE',
  'MUC_SERVER_REJECTED',
  'RESOURCE_CONSTRAINT',
  'MEDIA_PREVIEW_UNAVAILABLE',
  'MEDIA_TYPE_UNSUPPORTED',
  'MEDIA_SIZE_EXCEEDED',
  'MEDIA_DIMENSIONS_INVALID',
  'MEDIA_DECODE_FAILED',
  'MEDIA_REFERENCE_REVOKED',
  'SEND_IN_PROGRESS',
  'SEND_RESULT_UNKNOWN',
];
const certificateVerificationErrorCodes: readonly CertificateVerificationErrorCode[] = [
  'CERTIFICATE_EXPIRED',
  'CERTIFICATE_NOT_YET_VALID',
  'CERTIFICATE_IDENTITY_MISMATCH',
  'CERTIFICATE_UNTRUSTED',
  'CERTIFICATE_INSECURE_ALGORITHM',
  'CERTIFICATE_REVOKED',
  'CERTIFICATE_UNAVAILABLE',
];

const domainEventTypes: readonly DomainEventType[] = [
  'connection.stateChanged',
  'presence.changed',
  'roster.changed',
  'message.stateChanged',
  'message.received',
  'chatState.changed',
  'certificate.trustRequired',
  'muc.stateChanged',
  'muc.participantChanged',
  'muc.messageReceived',
  'muc.notice',
  'file.offerReceived',
  'file.stateChanged',
  'media.available',
  'sticker.messageReceived',
  'sticker.stateChanged',
  'sticker.capabilityChanged',
];

function isDomainEventType(value: unknown): value is DomainEventType {
  return isOneOf(value, domainEventTypes);
}

function isConnectionState(value: unknown): value is ConnectionState {
  if (!isRecord(value)) return false;
  return (
    isString(value.accountId) &&
    isOneOf(value.status, [
      'idle',
      'connecting',
      'authenticating',
      'connected',
      'disconnecting',
      'failed',
    ]) &&
    isBoolean(value.retryable) &&
    isString(value.since) &&
    isOptionalString(value.reason)
  );
}

function isPresence(value: unknown): value is Presence & { accountId?: string } {
  if (!isRecord(value)) return false;
  return (
    isString(value.jid) &&
    isOneOf(value.availability, ['available', 'away', 'extended-away', 'dnd', 'unavailable', 'unknown']) &&
    isOptionalOneOf(value.mode, ['chat', 'away', 'dnd', 'xa']) &&
    isOptionalString(value.status) &&
    isString(value.updatedAt) &&
    isOptionalString(value.accountId)
  );
}

function isChatStateEvent(value: unknown): value is ChatStateEvent {
  return (
    isRecord(value) &&
    isString(value.accountId) &&
    isString(value.conversationId) &&
    isString(value.senderJid) &&
    isOneOf(value.state, ['active', 'composing', 'paused', 'inactive', 'gone'])
  );
}

function isMessage(value: unknown): value is Message {
  if (!isRecord(value) || !isRecord(value.body)) return false;
  return (
    isString(value.id) &&
    isString(value.accountId) &&
    isString(value.conversationId) &&
    isString(value.clientMessageId) &&
    isString(value.senderJid) &&
    value.body.kind === 'text' &&
    isString(value.body.text) &&
    isOneOf(value.status, ['draft', 'queued', 'sending', 'sent', 'failed']) &&
    isString(value.createdAt) &&
    isOptionalOneOf(value.classification, ['direct', 'broadcast']) &&
    isOptionalOneOf(value.errorCode, appErrorCodes) &&
    isOptionalOneOf(value.persistenceStatus, ['persisted', 'memory-only'])
  );
}

function isRoomRef(value: unknown): value is RoomRef {
  return isRecord(value) && isString(value.service) && isString(value.room) && isString(value.jid);
}

function isRoomParticipant(value: unknown): value is RoomParticipant {
  if (!isRecord(value)) return false;
  return (
    isString(value.occupantJid) &&
    isString(value.nick) &&
    isOneOf(value.role, ['none', 'visitor', 'participant', 'moderator']) &&
    isOneOf(value.affiliation, ['none', 'member', 'admin', 'owner']) &&
    isOneOf(value.availability, ['available', 'unavailable'])
  );
}

function isRoomState(value: unknown): value is RoomState {
  if (!isRecord(value) || !isArray(value.participants)) return false;
  return (
    isString(value.accountId) &&
    isRoomRef(value.room) &&
    isOneOf(value.status, ['idle', 'joining', 'joined', 'leaving', 'failed']) &&
    value.participants.every(isRoomParticipant) &&
    isPositiveInteger(value.sessionGeneration) &&
    isOptionalString(value.selfOccupantJid) &&
    isOptionalOneOf(value.errorCode, appErrorCodes)
  );
}

function isMucParticipantChanged(value: unknown): value is MucParticipantChangedPayload {
  return (
    isRecord(value) &&
    isString(value.accountId) &&
    isRoomRef(value.room) &&
    isRoomParticipant(value.participant) &&
    isPositiveInteger(value.sessionGeneration)
  );
}

function isRoomMessage(value: unknown): value is RoomMessage {
  if (!isRecord(value) || !isRecord(value.body)) return false;
  return (
    isString(value.id) &&
    isString(value.accountId) &&
    isString(value.roomJid) &&
    isString(value.occupantJid) &&
    value.body.kind === 'text' &&
    isString(value.body.text) &&
    isString(value.receivedAt) &&
    isOptionalString(value.clientMessageId) &&
    isOneOf(value.source, ['live', 'server-history']) &&
    isPositiveInteger(value.sessionGeneration)
  );
}

function isCertificateInfo(value: unknown): value is CertificateInfo {
  if (!isRecord(value) || !isArray(value.subjectAltNames) || !isArray(value.chain)) return false;
  return (
    isString(value.fingerprintSha256) &&
    isString(value.subject) &&
    isString(value.issuer) &&
    isString(value.validFrom) &&
    isString(value.validTo) &&
    value.subjectAltNames.every(isString) &&
    value.chain.every(
      (item) =>
        isRecord(item) &&
        isString(item.fingerprintSha256) &&
        isString(item.subject) &&
        isString(item.issuer),
    ) &&
    isOptionalString(value.publicKeyAlgorithm) &&
    isOptionalNumber(value.publicKeyBits) &&
    isOptionalString(value.signatureAlgorithm) &&
    isString(value.pem)
  );
}

function isCertificateTrustRequest(value: unknown): value is CertificateTrustRequest {
  if (!isRecord(value) || !isCertificateInfo(value.certificate)) return false;
  return (
    isString(value.requestId) &&
    isString(value.accountId) &&
    isString(value.host) &&
    isPositiveInteger(value.port) &&
    isOneOf(value.transport, ['starttls', 'direct-tls']) &&
    (value.verificationError === undefined ||
      (isRecord(value.verificationError) &&
        isOneOf(value.verificationError.code, certificateVerificationErrorCodes) &&
        isString(value.verificationError.message))) &&
    (value.previous === undefined || isTrustedCertificateRecord(value.previous))
  );
}

function isTrustedCertificateRecord(
  value: unknown,
): value is NonNullable<CertificateTrustRequest['previous']> {
  if (!isRecord(value)) return false;
  return (
    isString(value.accountId) &&
    isString(value.host) &&
    isPositiveInteger(value.port) &&
    isOneOf(value.transport, ['starttls', 'direct-tls']) &&
    isString(value.fingerprintSha256) &&
    isString(value.certificatePem) &&
    isString(value.approvedAt)
  );
}

function isFileOffer(value: unknown): value is FileOffer {
  if (!isRecord(value)) return false;
  return (
    isString(value.transferId) &&
    isString(value.accountId) &&
    isString(value.conversationId) &&
    isString(value.senderJid) &&
    isOptionalString(value.recipientJid) &&
    isString(value.name) &&
    isString(value.sizeBytes) &&
    isOptionalString(value.mimeType) &&
    isOptionalString(value.description) &&
    value.transport === 'ibb' &&
    isString(value.offeredAt)
  );
}

function isFileTransfer(value: unknown): value is FileTransfer {
  if (!isRecord(value) || !isFileOffer(value.offer)) return false;
  const localActions = value.localActions;
  return (
    isOneOf(value.direction, ['incoming', 'outgoing']) &&
    isOneOf(value.state, [
      'selecting',
      'offering',
      'awaiting_acceptance',
      'offered',
      'accepted',
      'transferring',
      'completed',
      'failed',
      'cancelled',
    ]) &&
    isString(value.bytesTransferred) &&
    (localActions === undefined ||
      (isRecord(localActions) &&
        isBoolean(localActions.open) &&
        isBoolean(localActions.reveal))) &&
    isOptionalOneOf(value.endReason, [
      'user_rejected',
      'cancelled_by_receiver',
      'cancelled_by_sender',
      'timed_out',
      'network_lost',
      'unsupported_method',
      'resource_limit',
      'invalid_protocol',
      'integrity_failed',
      'storage_failed',
    ]) &&
    isOptionalOneOf(value.errorCode, appErrorCodes) &&
    isString(value.updatedAt)
  );
}

function isChatImageRecord(value: unknown): value is ChatImageRecord {
  if (!isRecord(value)) return false;
  return (
    isString(value.mediaId) &&
    isString(value.transferId) &&
    isString(value.accountId) &&
    isString(value.conversationId) &&
    isOneOf(value.direction, ['incoming', 'outgoing']) &&
    isString(value.senderJid) &&
    isString(value.originalName) &&
    isOneOf(value.mimeType, ['image/png', 'image/jpeg']) &&
    isString(value.sizeBytes) &&
    isPositiveInteger(value.width) &&
    isPositiveInteger(value.height) &&
    isString(value.createdAt) &&
    isOneOf(value.availability, ['available', 'missing', 'invalid'])
  );
}

function isStickerMessageRef(value: unknown): value is StickerMessageRef {
  if (!isRecord(value)) return false;
  return (
    isString(value.refId) &&
    isString(value.previewStickerId) &&
    isString(value.accountId) &&
    isString(value.conversationId) &&
    isString(value.clientMessageId) &&
    isOneOf(value.direction, ['incoming', 'outgoing']) &&
    isString(value.senderJid) &&
    isOptionalString(value.stanzaId) &&
    isOptionalString(value.originId) &&
    isOptionalString(value.sourceStickerId) &&
    isOptionalString(value['savedStickerId']) &&
    isOptionalString(value.name) &&
    isOptionalString(value.altText) &&
    isOptionalString(value.fallbackText) &&
    isOneOf(value.mimeType, ['image/png', 'image/jpeg']) &&
    isString(value.sizeBytes) &&
    isPositiveInteger(value.width) &&
    isPositiveInteger(value.height) &&
    value.hashAlgorithm === 'sha-256' &&
    isString(value.hashValue) &&
    isOptionalString(value.remoteUrl) &&
    isOptionalString(value.localAssetId) &&
    isOneOf(value.transportStatus, ['queued', 'uploading', 'sending', 'sent', 'failed']) &&
    isOneOf(value.availability, ['available', 'missing', 'invalid', 'blocked']) &&
    isOptionalOneOf(value.errorCode, appErrorCodes) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

function isStickerCapability(value: unknown): value is StickerCapability {
  if (!isRecord(value)) return false;
  return (
    isString(value.accountId) &&
    isBoolean(value.supported) &&
    isOptionalString(value.uploadService) &&
    isOptionalString(value.maxFileSize) &&
    isPositiveInteger(value.sessionGeneration) &&
    isString(value.expiresAt)
  );
}

function isMucNotice(value: unknown): value is MucNotice {
  if (!isRecord(value)) return false;
  const codes: readonly MucNoticeCode[] = ['IDENTITY_VISIBLE', 'PUBLIC_LOGGING', 'SERVER_NICKNAME'];
  return (
    isString(value.accountId) &&
    isString(value.roomJid) &&
    isOneOf(value.code, codes) &&
    isOptionalString(value.nickname) &&
    isPositiveInteger(value.sessionGeneration)
  );
}

interface RawDomainEvent extends EventRecord {
  type: DomainEventType;
  payload: unknown;
  version: 1;
  eventId: string;
  correlationId?: string;
}

function isRawEvent(value: unknown): value is RawDomainEvent {
  return (
    isRecord(value) &&
    value.version === 1 &&
    isString(value.eventId) &&
    isDomainEventType(value.type) &&
    Object.prototype.hasOwnProperty.call(value, 'payload') &&
    isOptionalString(value.correlationId)
  );
}

function typedEvent<TType extends DomainEventType>(
  event: RawDomainEvent,
  type: TType,
  payload: DomainEventPayloadMap[TType],
): DomainEventPayloadEvent<TType> {
  return {
    version: event.version,
    eventId: event.eventId,
    ...(event.correlationId !== undefined ? { correlationId: event.correlationId } : {}),
    type,
    payload,
  };
}

type DomainEventPayloadEvent<TType extends DomainEventType> = {
  version: 1;
  eventId: string;
  correlationId?: string;
  type: TType;
  payload: DomainEventPayloadMap[TType];
};

export function validateDomainEvent(value: unknown): TypedDomainEvent | undefined {
  if (!isRawEvent(value)) return undefined;
  switch (value.type) {
    case 'connection.stateChanged':
      return isConnectionState(value.payload)
        ? typedEvent(value, value.type, value.payload)
        : undefined;
    case 'presence.changed':
      return isPresence(value.payload) ? typedEvent(value, value.type, value.payload) : undefined;
    case 'roster.changed':
      return typedEvent(value, value.type, value.payload);
    case 'message.stateChanged':
    case 'message.received':
      return isMessage(value.payload) ? typedEvent(value, value.type, value.payload) : undefined;
    case 'chatState.changed':
      return isChatStateEvent(value.payload) ? typedEvent(value, value.type, value.payload) : undefined;
    case 'certificate.trustRequired':
      return isCertificateTrustRequest(value.payload)
        ? typedEvent(value, value.type, value.payload)
        : undefined;
    case 'muc.stateChanged':
      return isRoomState(value.payload) ? typedEvent(value, value.type, value.payload) : undefined;
    case 'muc.participantChanged':
      return isMucParticipantChanged(value.payload)
        ? typedEvent(value, value.type, value.payload)
        : undefined;
    case 'muc.messageReceived':
      return isRoomMessage(value.payload)
        ? typedEvent(value, value.type, value.payload)
        : undefined;
    case 'muc.notice':
      return isMucNotice(value.payload) ? typedEvent(value, value.type, value.payload) : undefined;
    case 'file.offerReceived':
      return isFileOffer(value.payload) ? typedEvent(value, value.type, value.payload) : undefined;
    case 'file.stateChanged':
      return isFileTransfer(value.payload)
        ? typedEvent(value, value.type, value.payload)
        : undefined;
    case 'media.available':
      return isChatImageRecord(value.payload)
        ? typedEvent(value, value.type, value.payload)
        : undefined;
    case 'sticker.messageReceived':
    case 'sticker.stateChanged':
      return isStickerMessageRef(value.payload)
        ? typedEvent(value, value.type, value.payload)
        : undefined;
    case 'sticker.capabilityChanged':
      return isStickerCapability(value.payload)
        ? typedEvent(value, value.type, value.payload)
        : undefined;
  }
}

export function subscribeToDomainEvents(
  subscribe: (listener: (event: unknown) => void) => () => void,
  listener: (event: TypedDomainEvent) => void,
): () => void {
  return subscribe((value) => {
    const event = validateDomainEvent(value);
    if (event) listener(event);
  });
}
