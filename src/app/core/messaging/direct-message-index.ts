import type { Message, MessageReference } from '../domain';
import { matchesDirectMessageReference } from './message-reference';

interface MessageIndexSnapshot {
  readonly byTargetId: ReadonlyMap<string, Message>;
  readonly byReferenceId: ReadonlyMap<string, ReadonlyArray<Message>>;
  readonly order: ReadonlyMap<Message, number>;
}

function present(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function addFirst(target: Map<string, Message>, key: string, message: Message): void {
  if (!target.has(key)) target.set(key, message);
}

function addCandidate(target: Map<string, Message[]>, key: string, message: Message): void {
  const candidates = target.get(key);
  if (candidates) candidates.push(message);
  else target.set(key, [message]);
}

function identityKeys(message: Message): ReadonlyArray<string> {
  return [message.id, message.clientMessageId, message.messageId, message.originId].filter(present);
}

function stanzaKeys(message: Message): ReadonlyArray<string> {
  return (message.stanzaIds || [])
    .filter((stanza) => present(stanza.id) && present(stanza.by))
    .map((stanza) => `stanza:${stanza.id}`);
}

function referenceKeys(reference: MessageReference): ReadonlyArray<string> {
  return [reference.messageId, reference.originId]
    .filter(present)
    .concat(
      reference.stanzaIds
        .filter((stanza) => present(stanza.id))
        .map((stanza) => `stanza:${stanza.id}`),
    );
}

/** Resolves direct-message identities without rescanning the active timeline. */
export class DirectMessageIndex {
  private readonly snapshots = new WeakMap<ReadonlyArray<Message>, MessageIndexSnapshot>();

  findByTargetId(messages: ReadonlyArray<Message>, targetId: string): Message | undefined {
    if (!targetId.trim()) return undefined;
    return this.snapshot(messages).byTargetId.get(targetId);
  }

  findByReference(
    messages: ReadonlyArray<Message>,
    reference: MessageReference,
    accountId: string,
    conversationId: string,
    checkAuthor = false,
  ): Message | undefined {
    const snapshot = this.snapshot(messages);
    const candidates = new Set<Message>();
    for (const key of referenceKeys(reference)) {
      for (const candidate of snapshot.byReferenceId.get(key) || []) candidates.add(candidate);
    }

    return [...candidates]
      .sort((left, right) => (snapshot.order.get(left) || 0) - (snapshot.order.get(right) || 0))
      .find((message) =>
        matchesDirectMessageReference(message, reference, accountId, conversationId, checkAuthor),
      );
  }

  private snapshot(messages: ReadonlyArray<Message>): MessageIndexSnapshot {
    const existing = this.snapshots.get(messages);
    if (existing) return existing;

    const byTargetId = new Map<string, Message>();
    const byReferenceId = new Map<string, Message[]>();
    const order = new Map<Message, number>();
    messages.forEach((message, index) => {
      order.set(message, index);
      for (const key of identityKeys(message)) {
        addFirst(byTargetId, key, message);
        addCandidate(byReferenceId, key, message);
      }
      for (const key of stanzaKeys(message)) {
        addFirst(byTargetId, key.slice('stanza:'.length), message);
        addCandidate(byReferenceId, key, message);
      }
    });

    const snapshot: MessageIndexSnapshot = { byTargetId, byReferenceId, order };
    this.snapshots.set(messages, snapshot);
    return snapshot;
  }
}
