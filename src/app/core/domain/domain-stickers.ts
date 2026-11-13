import type { AppErrorCode } from './domain-errors';
import type {
  ChatMediaDirection,
  ClientMessageId,
  ContractVersion,
  DecimalByteCount,
  RequestId,
  StaticImageMimeType,
  StickerAssetAvailability,
  StickerMessageAvailability,
  StickerMessageTransportStatus,
} from './domain-primitives';

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

export type StickerDraftStatus =
  'editing' | 'validating' | 'ready' | 'failed' | 'saved' | 'discarded';

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
  readonly version: 1;
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
  readonly storageProviderId?: string;
  readonly storageOrigin?: string;
  readonly localAssetId?: string;
  readonly transportStatus: StickerMessageTransportStatus;
  readonly availability: StickerMessageAvailability;
  readonly errorCode?: AppErrorCode;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface StickerCapability {
  readonly accountId: string;
  readonly transportMode: 'HTTP_UPLOAD_XEP0363' | 'PERSISTENT_HTTPS';
  readonly supported: boolean;
  readonly persistentHttpsAvailable: boolean;
  readonly providerId?: string;
  readonly storageOrigins?: readonly string[];
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

export type StickerStorageAvailability = 'available' | 'missing' | 'expired' | 'blocked';

export interface StickerStorageMetadata {
  readonly mimeType: StaticImageMimeType;
  readonly sizeBytes: DecimalByteCount;
  readonly width: number;
  readonly height: number;
  readonly hashAlgorithm: 'sha-256';
  readonly hashValue: string;
}

export interface StickerStorageCapabilities {
  readonly providerId: string;
  readonly storageOrigins: readonly string[];
  readonly uploadSupported: boolean;
  readonly downloadSupported: boolean;
  readonly maxFileSize?: DecimalByteCount;
  readonly retentionSeconds?: number;
}

export interface StickerStorageUploadRequest {
  readonly accountId: string;
  readonly idempotencyKey: string;
  readonly metadata: StickerStorageMetadata;
  readonly bytes: Uint8Array;
}

export interface StickerStorageAssetRef extends StickerStorageMetadata {
  readonly providerId: string;
  readonly storageOrigin: string;
  readonly assetId: string;
  readonly remoteUrl: string;
  readonly availability: StickerStorageAvailability;
  readonly expiresAt?: string;
}

export interface StickerStorageResolveRequest {
  readonly accountId: string;
  readonly assetId?: string;
  readonly remoteUrl: string;
  readonly expected: StickerStorageMetadata;
}

export interface StickerStorageDownloadRequest extends StickerStorageResolveRequest {
  readonly maxBytes: DecimalByteCount;
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
