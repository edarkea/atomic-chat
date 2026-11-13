import type { AppErrorCode } from './domain-errors';
import type { DecimalByteCount, RequestId } from './domain-primitives';

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

export interface FileClipboardSendInput extends FileSendInput {
  readonly file: File;
}

export interface ExternalLinkOpenInput {
  readonly version: 1;
  readonly requestId: RequestId;
  readonly url: string;
}
