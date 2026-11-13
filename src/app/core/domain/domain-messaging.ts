import type { AppError } from './domain-errors';
import type {
  ChatState,
  ClientMessageId,
  MessageClassification,
  MessagePersistenceStatus,
  MessageStatus,
  RequestId,
} from './domain-primitives';

export interface XmppStanzaId {
  readonly id: string;
  readonly by: string;
}

export interface MessageReference {
  readonly messageId?: string;
  readonly originId?: string;
  readonly stanzaIds: ReadonlyArray<XmppStanzaId>;
  readonly authorJid: string;
  readonly quote?: string;
}

export interface ReactionActor {
  readonly id: string;
  readonly label: string;
  readonly occupantJid?: string;
  readonly realJid?: string;
  readonly identifiable: boolean;
}

export interface MessageReaction {
  readonly emoji: string;
  readonly actors: ReadonlyArray<ReactionActor>;
}

export interface ReactionState {
  readonly accountId: string;
  readonly conversationId: string;
  readonly targetMessageId: string;
  readonly target: MessageReference;
  readonly reactions: ReadonlyArray<MessageReaction>;
  readonly updatedAt: string;
  readonly source: 'direct' | 'muc';
  readonly sessionGeneration?: number;
  readonly actorId?: string;
  readonly actorEmojis?: ReadonlyArray<string>;
}

export interface ReactionRejected {
  readonly accountId: string;
  readonly conversationId: string;
  readonly targetMessageId: string;
  readonly reason: 'not-acceptable' | 'unsupported' | 'not-found' | 'unauthorized' | 'conflict';
  readonly message: string;
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
  messageId?: string;
  originId?: string;
  stanzaIds?: ReadonlyArray<XmppStanzaId>;
  replyTo?: MessageReference;
  reactions?: ReadonlyArray<MessageReaction>;
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

export type MessageSearchScope =
  { readonly kind: 'all' } | { readonly kind: 'conversation'; readonly conversationId: string };

export interface MessageSearchInput {
  readonly version: 1;
  readonly requestId: RequestId;
  readonly accountId: string;
  readonly query: string;
  readonly scope: MessageSearchScope;
  readonly limit: number;
  readonly cursor?: string | null;
}

export interface MessageSearchHit {
  readonly messageId: string;
  readonly accountId: string;
  readonly conversationId: string;
  readonly senderJid: string;
  readonly bodyPreview: string;
  readonly createdAt: string;
}

export interface MessageSearchPage {
  readonly items: ReadonlyArray<MessageSearchHit>;
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
}

export interface MessageAroundInput {
  readonly version: 1;
  readonly requestId: RequestId;
  readonly accountId: string;
  readonly conversationId: string;
  readonly messageId: string;
  readonly createdAt: string;
  readonly limit: number;
}

export interface ChatStateInput {
  version: 1;
  requestId: RequestId;
  accountId: string;
  conversationId: string;
  state: ChatState;
}

export interface MessageSendInput {
  version: 1;
  requestId: RequestId;
  accountId: string;
  conversationId: string;
  clientMessageId: ClientMessageId;
  body: { kind: 'text'; text: string };
  replyToMessageId?: string;
}

export interface MessageReactionInput {
  readonly version: 1;
  readonly requestId: RequestId;
  readonly accountId: string;
  readonly conversationId: string;
  readonly targetMessageId: string;
  readonly emojis: ReadonlyArray<string>;
}
