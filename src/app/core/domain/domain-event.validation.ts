import {
  CertificateInfo,
  CertificateTrustRequest,
  ConnectionState,
  AppErrorCode,
  CertificateVerificationErrorCode,
  ChatImageRecord,
  Contact,
  FileOffer,
  FileTransfer,
  Message,
  MessageReference,
  MucNotice,
  MucNoticeCode,
  Presence,
  ReactionRejected,
  ReactionState,
  RoomMessage,
  RoomParticipant,
  RoomRef,
  RoomState,
  XmppStanzaId,
  StickerCapability,
  StickerMessageRef,
} from '../domain';
import type {
  ChatStateEvent,
  DomainEventPayloadMap,
  DomainEventFor,
  DomainEventType,
  MucParticipantChangedPayload,
  RosterChangedPayload,
  TypedDomainEvent,
} from './domain-event';
import type { GameDomainEventPayload, GameSessionDto, GameSnapshotDto } from './domain-games';

interface EventRecord {
  actorId?: unknown;
  actorEmojis?: unknown;
  authorJid?: unknown;
  by?: unknown;
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
  messageId?: unknown;
  stanzaIds?: unknown;
  replyTo?: unknown;
  quote?: unknown;
  emoji?: unknown;
  identityVerified?: unknown;
  reactions?: unknown;
  target?: unknown;
  targetMessageId?: unknown;
  actors?: unknown;
  identifiable?: unknown;
  label?: unknown;
  realJid?: unknown;
  emojis?: unknown;
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
  displayName?: unknown;
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
  peerBareJid?: unknown;
  sessionId?: unknown;
  gameId?: unknown;
  gameVersion?: unknown;
  apiVersion?: unknown;
  localRole?: unknown;
  revision?: unknown;
  connectionGeneration?: unknown;
  snapshot?: unknown;
  session?: unknown;
  localRevision?: unknown;
  remoteRevision?: unknown;
  localStateHash?: unknown;
  remoteStateHash?: unknown;
  actorSeq?: unknown;
  stateHash?: unknown;
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
  'reaction.changed',
  'reaction.rejected',
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
  'game.sessionChanged',
  'game.invitationReceived',
  'game.invitationUpdated',
  'game.moveAccepted',
  'game.moveConfirmed',
  'game.stateSynchronized',
  'game.syncRequired',
  'game.remoteError',
  'game.transportError',
  'game.eventDuplicate',
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
    isOptionalString(value.displayName) &&
    isString(value.since) &&
    isOptionalString(value.reason)
  );
}

function isPresence(value: unknown): value is Presence & { accountId?: string } {
  if (!isRecord(value)) return false;
  return (
    isString(value.jid) &&
    isOneOf(value.availability, [
      'available',
      'away',
      'extended-away',
      'dnd',
      'unavailable',
      'unknown',
    ]) &&
    isOptionalOneOf(value.mode, ['chat', 'away', 'dnd', 'xa']) &&
    isOptionalString(value.status) &&
    isString(value.updatedAt) &&
    isOptionalString(value.accountId)
  );
}

function isContact(value: unknown): value is Contact {
  if (!isRecord(value) || !isArray(value['groups'])) return false;
  return (
    isString(value.jid) &&
    value['groups'].every(isString) &&
    (value['presence'] === undefined || isPresence(value['presence'])) &&
    isOptionalOneOf(value['subscription'], ['none', 'to', 'from', 'both']) &&
    (value['ask'] === undefined || value['ask'] === 'subscribe') &&
    isOptionalOneOf(value['source'], ['roster', 'conversation'])
  );
}

function isRosterChanged(value: unknown): value is RosterChangedPayload {
  return (
    isRecord(value) &&
    isString(value.accountId) &&
    isArray(value['contacts']) &&
    value['contacts'].every(isContact)
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
    isOptionalOneOf(value.persistenceStatus, ['persisted', 'memory-only']) &&
    isOptionalString(value.messageId) &&
    isOptionalString(value.originId) &&
    isOptionalStanzaIds(value.stanzaIds) &&
    isOptionalMessageReference(value.replyTo) &&
    isOptionalReactions(value.reactions)
  );
}

function isStanzaId(value: unknown): value is XmppStanzaId {
  return isRecord(value) && isString(value.id) && isString(value.by);
}

function isOptionalStanzaIds(value: unknown): value is ReadonlyArray<XmppStanzaId> | undefined {
  return value === undefined || (isArray(value) && value.every(isStanzaId));
}

function isMessageReference(value: unknown): value is MessageReference {
  return (
    isRecord(value) &&
    isOptionalString(value.messageId) &&
    isOptionalString(value.originId) &&
    Array.isArray(value.stanzaIds) &&
    value.stanzaIds.every(isStanzaId) &&
    isString(value.authorJid) &&
    isOptionalString(value.quote)
  );
}

function isOptionalMessageReference(value: unknown): value is MessageReference | undefined {
  return value === undefined || isMessageReference(value);
}

function isReactionActor(value: unknown): boolean {
  return (
    isRecord(value) &&
    isString(value.id) &&
    isString(value.label) &&
    isOptionalString(value.occupantJid) &&
    isOptionalString(value.realJid) &&
    isBoolean(value.identifiable)
  );
}

function isOptionalReactions(value: unknown): boolean {
  return (
    value === undefined ||
    (isArray(value) &&
      value.every(
        (reaction) =>
          isRecord(reaction) &&
          isString(reaction.emoji) &&
          isArray(reaction.actors) &&
          reaction.actors.every(isReactionActor),
      ))
  );
}

function isReactionState(value: unknown): value is ReactionState {
  if (!isRecord(value) || !isArray(value.reactions)) return false;
  return (
    isString(value.accountId) &&
    isString(value.conversationId) &&
    isString(value.targetMessageId) &&
    isMessageReference(value.target) &&
    value.reactions.every(
      (reaction) =>
        isRecord(reaction) &&
        isString(reaction.emoji) &&
        isArray(reaction.actors) &&
        reaction.actors.every(isReactionActor),
    ) &&
    isString(value.updatedAt) &&
    isOneOf(value.source, ['direct', 'muc']) &&
    isOptionalNumber(value.sessionGeneration) &&
    isOptionalString(value.actorId) &&
    (value.actorEmojis === undefined ||
      (isArray(value.actorEmojis) && value.actorEmojis.every(isString)))
  );
}

function isReactionRejected(value: unknown): value is ReactionRejected {
  return (
    isRecord(value) &&
    isString(value.accountId) &&
    isString(value.conversationId) &&
    isString(value.targetMessageId) &&
    isOneOf(value.reason, [
      'not-acceptable',
      'unsupported',
      'not-found',
      'unauthorized',
      'conflict',
    ]) &&
    isString(value.message)
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
    isOptionalString(value.realJid) &&
    (value.identityVerified === undefined || isBoolean(value.identityVerified)) &&
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
    isPositiveInteger(value.sessionGeneration) &&
    isOptionalString(value.messageId) &&
    isOptionalString(value.originId) &&
    isOptionalStanzaIds(value.stanzaIds) &&
    isOptionalMessageReference(value.replyTo) &&
    isOptionalReactions(value.reactions)
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
      (isRecord(localActions) && isBoolean(localActions.open) && isBoolean(localActions.reveal))) &&
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
    isOptionalString(value['storageProviderId']) &&
    isOptionalString(value['storageOrigin']) &&
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
    isOneOf(value['transportMode'], ['HTTP_UPLOAD_XEP0363', 'PERSISTENT_HTTPS']) &&
    isBoolean(value.supported) &&
    isBoolean(value['persistentHttpsAvailable']) &&
    isOptionalString(value['providerId']) &&
    (value['storageOrigins'] === undefined ||
      (isArray(value['storageOrigins']) && value['storageOrigins'].every(isString))) &&
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

function isSafeGameValue(value: unknown, depth = 0): boolean {
  if (depth > 8 || value === null) return value === null;
  if (typeof value === 'string') return value.length <= 65536;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value))
    return value.length <= 1024 && value.every((item) => isSafeGameValue(item, depth + 1));
  if (!isRecord(value)) return false;
  const keys = Object.keys(value);
  return (
    keys.length <= 256 &&
    keys.every((key) => key.length <= 128 && key !== '__proto__' && key !== 'constructor') &&
    keys.every((key) => isSafeGameValue(value[key], depth + 1))
  );
}

function isGameSession(value: unknown): value is GameSessionDto {
  if (!isRecord(value)) return false;
  return (
    isString(value.accountId) &&
    isString(value.conversationId) &&
    isString(value.peerBareJid) &&
    isString(value.sessionId) &&
    isString(value.gameId) &&
    isString(value.gameVersion) &&
    value.apiVersion === 1 &&
    isOneOf(value.localRole, ['initiator', 'responder']) &&
    isOneOf(value.state, [
      'invited',
      'accepted',
      'active',
      'paused',
      'resync-required',
      'rejected',
      'cancelled',
      'expired',
      'finished',
      'abandoned',
      'closed',
    ]) &&
    isNumber(value.revision) &&
    Number.isInteger(value.revision) &&
    value.revision >= 0 &&
    isString(value.stateHash) &&
    isPositiveInteger(value.sessionGeneration) &&
    isPositiveInteger(value.connectionGeneration) &&
    isString(value.createdAt) &&
    isString(value.updatedAt)
  );
}

function isGameSnapshot(value: unknown): value is GameSnapshotDto {
  return (
    isRecord(value) &&
    isString(value.sessionId) &&
    isSafeGameValue(value.state) &&
    isNumber(value.revision) &&
    Number.isInteger(value.revision) &&
    value.revision >= 0 &&
    isString(value.stateHash) &&
    (value['legalMoves'] === undefined ||
      (Array.isArray(value['legalMoves']) &&
        value['legalMoves'].every(
          (move) => isNumber(move) && Number.isInteger(move) && move >= 0 && move < 64,
        ))) &&
    (value['passAllowed'] === undefined || typeof value['passAllowed'] === 'boolean')
  );
}

function isGameEventPayload(value: unknown): value is GameDomainEventPayload {
  if (!isRecord(value)) return false;
  return (
    isString(value.accountId) &&
    isString(value.conversationId) &&
    isString(value.sessionId) &&
    isPositiveInteger(value.connectionGeneration) &&
    (value.session === undefined || isGameSession(value.session)) &&
    (value.snapshot === undefined || isGameSnapshot(value.snapshot)) &&
    isOptionalString(value.eventId) &&
    isOptionalString(value.stateHash) &&
    isOptionalString(value.localStateHash) &&
    isOptionalString(value.remoteStateHash) &&
    isOptionalString(value.code) &&
    (value.revision === undefined ||
      (isNumber(value.revision) && Number.isInteger(value.revision) && value.revision >= 0)) &&
    (value.localRevision === undefined ||
      (isNumber(value.localRevision) &&
        Number.isInteger(value.localRevision) &&
        value.localRevision >= 0)) &&
    (value.remoteRevision === undefined ||
      (isNumber(value.remoteRevision) &&
        Number.isInteger(value.remoteRevision) &&
        value.remoteRevision >= 0)) &&
    (value.actorSeq === undefined || isPositiveInteger(value.actorSeq))
  );
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
): DomainEventFor<TType> {
  return {
    version: event.version,
    eventId: event.eventId,
    ...(event.correlationId !== undefined ? { correlationId: event.correlationId } : {}),
    type,
    payload,
  };
}

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
      return isRosterChanged(value.payload)
        ? typedEvent(value, value.type, value.payload)
        : undefined;
    case 'message.stateChanged':
    case 'message.received':
      return isMessage(value.payload) ? typedEvent(value, value.type, value.payload) : undefined;
    case 'chatState.changed':
      return isChatStateEvent(value.payload)
        ? typedEvent(value, value.type, value.payload)
        : undefined;
    case 'certificate.trustRequired':
      return isCertificateTrustRequest(value.payload)
        ? typedEvent(value, value.type, value.payload)
        : undefined;
    case 'reaction.changed':
      return isReactionState(value.payload)
        ? typedEvent(value, value.type, value.payload)
        : undefined;
    case 'reaction.rejected':
      return isReactionRejected(value.payload)
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
    case 'game.sessionChanged':
    case 'game.invitationReceived':
    case 'game.invitationUpdated':
    case 'game.moveAccepted':
    case 'game.moveConfirmed':
    case 'game.stateSynchronized':
    case 'game.syncRequired':
    case 'game.remoteError':
    case 'game.transportError':
    case 'game.eventDuplicate':
      return isGameEventPayload(value.payload)
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
