import type { AppError } from './domain-errors';
import type {
  Availability,
  ClientMessageId,
  ContractVersion,
  MucAffiliation,
  MucRole,
  MucRoomStatus,
  OccupantId,
  RequestId,
  RoomId,
} from './domain-primitives';
import type { MessageReaction, MessageReference, XmppStanzaId } from './domain-messaging';

export interface RoomRef {
  service: string;
  room: string;
  jid: RoomId;
}

export interface RoomParticipant {
  occupantJid: OccupantId;
  nick: string;
  realJid?: string;
  identityVerified?: boolean;
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

export type MucDiscoverInput = MucRequest;

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
  replyToMessageId?: string;
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
  messageId?: string;
  originId?: string;
  stanzaIds?: ReadonlyArray<XmppStanzaId>;
  replyTo?: MessageReference;
  reactions?: ReadonlyArray<MessageReaction>;
}

export type MucNoticeCode = 'IDENTITY_VISIBLE' | 'PUBLIC_LOGGING' | 'SERVER_NICKNAME';

export interface MucNotice {
  accountId: string;
  roomJid: string;
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

export interface MucReactionInput {
  readonly version: 1;
  readonly requestId: RequestId;
  readonly accountId: string;
  readonly roomJid: RoomId;
  readonly targetMessageId: string;
  readonly emojis: ReadonlyArray<string>;
}
