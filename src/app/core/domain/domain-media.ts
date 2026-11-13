import type { Message } from './domain-messaging';
import type {
  ChatMediaAvailability,
  ChatMediaDirection,
  ChatFileAvailability,
  ContractVersion,
  DecimalByteCount,
  RequestId,
  StaticImageMimeType,
} from './domain-primitives';
import type { StickerMessageRef } from './domain-stickers';

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
  readonly version: 1;
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
