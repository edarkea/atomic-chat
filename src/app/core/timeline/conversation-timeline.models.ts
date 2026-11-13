import type {
  ChatFileHistoryRecord,
  ChatImageRecord,
  FileTransfer,
  Message,
  StickerMessageRef,
} from '../domain';

export type ConversationTimelineItem =
  | {
      readonly kind: 'text';
      readonly id: string;
      readonly sortAt: string;
      readonly message: Message;
      readonly senderLabel: string;
      readonly outgoing: boolean;
    }
  | {
      readonly kind: 'file';
      readonly id: string;
      readonly sortAt: string;
      readonly transfer: FileTransfer;
      readonly media?: ChatImageRecord;
      readonly history?: ChatFileHistoryRecord;
      readonly senderLabel: string;
      readonly outgoing: boolean;
      readonly label: string;
      readonly progressLabel: string;
    }
  | {
      readonly kind: 'sticker';
      readonly id: string;
      readonly sortAt: string;
      readonly sticker: StickerMessageRef;
      readonly senderLabel: string;
      readonly outgoing: boolean;
    };
