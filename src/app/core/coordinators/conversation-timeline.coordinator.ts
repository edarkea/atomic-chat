import { computed, type Signal } from '@angular/core';
import type { InitialHistoryState } from './conversation-history.coordinator';
import type {
  ChatFileHistoryRecord,
  ChatImageRecord,
  FileTransfer,
  HistoryTimelineItem,
  Message,
} from '../domain';
import type { Contact } from '../domain/domain-connection';
import type { ConversationTimelineItem } from '../timeline/conversation-timeline.models';
import { bareJid } from '../identity';

export interface ConversationTimelineChat {
  readonly accountId: Signal<string>;
  readonly messages: Signal<ReadonlyArray<Message>>;
  readonly initialHistory: Signal<InitialHistoryState | null>;
  readonly timelineItems: Signal<ReadonlyArray<HistoryTimelineItem>>;
  readonly timelineSupported: Signal<boolean>;
}

export interface ConversationTimelineFiles {
  forConversation(accountId: string, conversationId: string): ReadonlyArray<FileTransfer>;
  mediaForTransfer(accountId: string, transferId: string): ChatImageRecord | undefined;
  label(
    state: FileTransfer['state'],
    reason?: FileTransfer['endReason'],
    direction?: FileTransfer['direction'],
  ): string;
}

export interface ConversationTimelineCoordinatorDependencies {
  readonly chat: ConversationTimelineChat;
  readonly files: ConversationTimelineFiles;
  readonly selectedJid: () => string;
  readonly contactsByBareJid: () => ReadonlyMap<string, Contact>;
}

export class ConversationTimelineCoordinator {
  readonly visibleMessages = computed<ReadonlyArray<Message>>(() => {
    const jid = bareJid(this.dependencies.selectedJid());
    if (!jid) return [];
    const accountId = this.dependencies.chat.accountId();
    return this.dependencies.chat
      .messages()
      .filter(
        (message) =>
          message.accountId === accountId &&
          (bareJid(message.conversationId) === jid || bareJid(message.senderJid) === jid),
      );
  });

  readonly initialTimelineReady = computed(() => {
    const jid = bareJid(this.dependencies.selectedJid());
    if (!jid) return true;
    const history = this.dependencies.chat.initialHistory();
    return Boolean(
      history?.status === 'ready' &&
      history.accountId === this.dependencies.chat.accountId() &&
      history.conversationId === jid,
    );
  });

  readonly timeline = computed<ReadonlyArray<ConversationTimelineItem>>(() => {
    if (!this.initialTimelineReady()) return [];
    const accountId = this.dependencies.chat.accountId();
    const conversationId = this.dependencies.selectedJid();
    const messages: ConversationTimelineItem[] = this.visibleMessages().map((message) => ({
      kind: 'text',
      id: `text:${message.clientMessageId || message.id}`,
      sortAt: message.createdAt,
      message,
      senderLabel: this.directSenderLabel(message),
      outgoing: this.isOutgoing(message),
    }));
    const files = this.dependencies.files
      .forConversation(accountId, conversationId)
      .map((transfer) => {
        const media = this.dependencies.files.mediaForTransfer(
          accountId,
          transfer.offer.transferId,
        );
        const label = this.dependencies.files.label(
          transfer.state,
          transfer.endReason,
          transfer.direction,
        );
        return {
          kind: 'file' as const,
          id: `file:${transfer.offer.transferId}`,
          sortAt: transfer.offer.offeredAt,
          transfer,
          media,
          senderLabel: transfer.direction === 'outgoing' ? 'Tú' : transfer.offer.senderJid,
          outgoing: transfer.direction === 'outgoing',
          label,
          progressLabel: label,
        };
      })
      .filter(({ transfer, media }) => !this.isHiddenCancelledImage(transfer, media));
    const activeTransferIds = new Set(files.map((item) => item.transfer.offer.transferId));
    const timelineItems = this.dependencies.chat.timelineItems();
    const persistedImages = this.dependencies.chat.timelineSupported()
      ? timelineItems
          .filter(
            (item): item is Extract<HistoryTimelineItem, { kind: 'image' }> =>
              item.kind === 'image',
          )
          .map((item) => item.media)
      : [];
    const historicalImages: ConversationTimelineItem[] = [...persistedImages]
      .filter(
        (media, index, all) =>
          all.findIndex((candidate) => candidate.mediaId === media.mediaId) === index,
      )
      .filter(
        (media) =>
          media.accountId === accountId &&
          bareJid(media.conversationId) === bareJid(conversationId) &&
          !activeTransferIds.has(media.transferId),
      )
      .map((media) => ({
        kind: 'file' as const,
        id: `media:${media.mediaId}`,
        sortAt: media.createdAt,
        transfer: this.mediaAsTransfer(media),
        media,
        senderLabel: media.direction === 'outgoing' ? 'Tú' : media.senderJid,
        outgoing: media.direction === 'outgoing',
        label: 'Imagen guardada',
        progressLabel: 'Imagen guardada',
      }));
    const historicalFiles: ConversationTimelineItem[] = timelineItems
      .filter(
        (item): item is Extract<HistoryTimelineItem, { kind: 'file' }> => item.kind === 'file',
      )
      .map((item) => item.file)
      .filter(
        (file) =>
          file.accountId === accountId &&
          bareJid(file.conversationId) === bareJid(conversationId) &&
          !activeTransferIds.has(file.transferId),
      )
      .map((file) => {
        const label = this.fileHistoryLabel(file);
        return {
          kind: 'file' as const,
          id: `history:${file.fileId}`,
          sortAt: file.createdAt,
          transfer: this.fileHistoryAsTransfer(file),
          history: file,
          senderLabel: file.direction === 'outgoing' ? 'Tú' : file.senderJid,
          outgoing: file.direction === 'outgoing',
          label,
          progressLabel: label,
        };
      });
    const stickers: ConversationTimelineItem[] = timelineItems
      .filter(
        (item): item is Extract<HistoryTimelineItem, { kind: 'sticker' }> =>
          item.kind === 'sticker',
      )
      .map((item) => item.sticker)
      .filter(
        (sticker) =>
          sticker.accountId === accountId &&
          bareJid(sticker.conversationId) === bareJid(conversationId),
      )
      .map((sticker) => ({
        kind: 'sticker' as const,
        id: `sticker:${sticker.refId}`,
        sortAt: sticker.createdAt,
        sticker,
        senderLabel: sticker.direction === 'outgoing' ? 'Tú' : sticker.senderJid,
        outgoing: sticker.direction === 'outgoing',
      }));
    return [...messages, ...files, ...historicalImages, ...historicalFiles, ...stickers].sort(
      (left, right) => left.sortAt.localeCompare(right.sortAt) || left.id.localeCompare(right.id),
    );
  });

  constructor(private readonly dependencies: ConversationTimelineCoordinatorDependencies) {}

  directSenderLabel(message: Message): string {
    if (message.accountId !== this.dependencies.chat.accountId()) return 'Remitente desconocido';
    if (this.isOutgoing(message)) return 'Tú';
    const senderJid = bareJid(message.senderJid);
    if (!senderJid) return 'Remitente desconocido';
    const contact = this.dependencies.contactsByBareJid().get(senderJid);
    return contact?.name?.trim() || senderJid;
  }

  private isOutgoing(message: Message): boolean {
    const sender = bareJid(message.senderJid);
    const account = this.dependencies.chat.accountId().toLowerCase();
    return sender === account || sender.startsWith(`${account}@`);
  }

  private isHiddenCancelledImage(transfer: FileTransfer, media?: ChatImageRecord): boolean {
    return (
      transfer.direction === 'outgoing' &&
      transfer.state === 'cancelled' &&
      media === undefined &&
      transfer.offer.mimeType?.toLowerCase().startsWith('image/') === true
    );
  }

  private mediaAsTransfer(media: ChatImageRecord): FileTransfer {
    return {
      offer: {
        transferId: media.transferId,
        accountId: media.accountId,
        conversationId: media.conversationId,
        senderJid: media.senderJid,
        name: media.originalName,
        sizeBytes: media.sizeBytes,
        mimeType: media.mimeType,
        transport: 'ibb',
        offeredAt: media.createdAt,
      },
      direction: media.direction,
      state: 'completed',
      bytesTransferred: media.sizeBytes,
      updatedAt: media.createdAt,
    };
  }

  private fileHistoryAsTransfer(file: ChatFileHistoryRecord): FileTransfer {
    return {
      offer: {
        transferId: file.transferId,
        accountId: file.accountId,
        conversationId: file.conversationId,
        senderJid: file.senderJid,
        name: file.originalName,
        sizeBytes: file.sizeBytes,
        ...(file.mimeType ? { mimeType: file.mimeType } : {}),
        transport: 'ibb',
        offeredAt: file.createdAt,
      },
      direction: file.direction,
      state: 'completed',
      bytesTransferred: file.sizeBytes,
      updatedAt: file.createdAt,
    };
  }

  private fileHistoryLabel(file: ChatFileHistoryRecord): string {
    return file.availability === 'available' ? '' : 'Archivo no disponible';
  }
}
