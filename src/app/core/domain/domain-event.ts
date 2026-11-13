import type { CertificateTrustRequest } from './domain-errors';
import type { ChatImageRecord } from './domain-media';
import type { ChatState, ClientMessageId, ContractVersion, RequestId } from './domain-primitives';
import type { ConnectionState, Contact, Presence } from './domain-connection';
import type { FileOffer, FileTransfer } from './domain-files';
import type { Message, ReactionRejected, ReactionState } from './domain-messaging';
import type { MucNotice, RoomMessage, RoomParticipant, RoomRef, RoomState } from './domain-muc';
import type { StickerCapability, StickerMessageRef } from './domain-stickers';

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

export interface RosterChangedPayload {
  accountId: string;
  contacts: ReadonlyArray<Contact>;
}

export interface DomainEventPayloadMap {
  'connection.stateChanged': ConnectionState;
  'presence.changed': Presence & { accountId?: string };
  'roster.changed': RosterChangedPayload;
  'message.stateChanged': Message;
  'message.received': Message;
  'reaction.changed': ReactionState;
  'reaction.rejected': ReactionRejected;
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

export type DomainEventFor<TType extends DomainEventType> = DomainEvent<
  DomainEventPayloadMap[TType]
> & { type: TType };

export type TypedDomainEvent = {
  [Type in DomainEventType]: DomainEventFor<Type>;
}[DomainEventType];
