import { signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import type { Contact, Message, ReactionState } from '../../core/domain';
import type { ConversationTimelineItem } from './conversation-view.models';
import {
  ConversationMessageContext,
  ConversationMessageCoordinator,
} from './conversation-message.coordinator';

function textItem(
  id: string,
  senderJid: string,
  text: string,
  reaction?: string,
): Extract<ConversationTimelineItem, { kind: 'text' }> {
  const message: Message = {
    id,
    accountId: 'alice@example.invalid',
    conversationId: 'bob@example.invalid',
    clientMessageId: `client-${id}`,
    senderJid,
    body: { kind: 'text', text },
    status: 'sent',
    createdAt: '2026-11-12T00:00:00.000Z',
    messageId: `wire-${id}`,
    ...(reaction
      ? {
          reactions: [
            {
              emoji: reaction,
              actors: [
                {
                  id: 'alice@example.invalid',
                  label: 'Alice',
                  identifiable: true,
                },
              ],
            },
          ],
        }
      : {}),
  };
  return {
    kind: 'text',
    id: `text:${id}`,
    sortAt: message.createdAt,
    message,
    senderLabel: 'Bob',
    outgoing: false,
  };
}

function reactionState(): ReactionState {
  return {
    accountId: 'alice@example.invalid',
    conversationId: 'bob@example.invalid',
    targetMessageId: 'one',
    target: {
      messageId: 'wire-one',
      stanzaIds: [],
      authorJid: 'bob@example.invalid',
    },
    reactions: [
      {
        emoji: '🎉',
        actors: [{ id: 'alice@example.invalid', label: 'Alice', identifiable: true }],
      },
    ],
    updatedAt: '2026-11-12T00:01:00.000Z',
    source: 'direct',
  };
}

describe('ConversationMessageCoordinator', () => {
  it('keeps replies and historical reactions scoped to the selected identity', () => {
    const activeContact = signal<Contact | undefined>({
      jid: 'bob@example.invalid',
      name: 'Bob',
      groups: [],
      source: 'roster',
    });
    const selectedJid = signal('bob@example.invalid');
    const accountId = signal('alice@example.invalid');
    const timeline = signal<ReadonlyArray<ConversationTimelineItem>>([
      textItem('one', 'bob@example.invalid', 'Mensaje original', '👍'),
    ]);
    const reactions = signal<ReadonlyMap<string, ReactionState>>(
      new Map([['bob@example.invalid|one', reactionState()]]),
    );
    const context: ConversationMessageContext = {
      activeContact,
      selectedJid,
      accountId,
      timeline,
      reactions,
    };
    const coordinator = new ConversationMessageCoordinator(context);
    const reference: NonNullable<Message['replyTo']> = {
      authorJid: 'bob@example.invalid',
      messageId: 'wire-one',
      stanzaIds: [],
      quote: 'Cita temporal',
    };

    expect(coordinator.replyTargetId(reference)).toBe('one');
    expect(coordinator.replyQuote(reference)).toBe('Mensaje original');
    expect(coordinator.reactionFor('one')?.reactions[0]?.emoji).toBe('🎉');
    expect(coordinator.ownReactionEmojis('one')).toEqual(['🎉']);
    expect(
      coordinator.reactionActorLabel({
        id: 'bob@example.invalid',
        label: 'ignored',
        identifiable: true,
      }),
    ).toBe('Bob');

    selectedJid.set('carol@example.invalid');
    timeline.set([]);
    expect(coordinator.reactionFor('one')).toBeUndefined();
    expect(coordinator.replyTargetId(reference)).toBe('');

    selectedJid.set('bob@example.invalid');
    accountId.set('carol@example.invalid');
    expect(coordinator.replyTargetId(reference)).toBe('');
  });

  it('preserves first-match semantics when timeline messages share an ID', () => {
    const contact = signal<Contact | undefined>(undefined);
    const selectedJid = signal('bob@example.invalid');
    const accountId = signal('alice@example.invalid');
    const timeline = signal<ReadonlyArray<ConversationTimelineItem>>([
      textItem('duplicate', 'bob@example.invalid', 'Primero', '😎'),
      textItem('duplicate', 'bob@example.invalid', 'Después', '❤️'),
    ]);
    const context: ConversationMessageContext = {
      activeContact: contact,
      selectedJid,
      accountId,
      timeline,
      reactions: signal(new Map()),
    };
    const coordinator = new ConversationMessageCoordinator(context);

    expect(coordinator.reactionFor('duplicate')?.reactions[0]?.emoji).toBe('😎');
    expect(coordinator.ownReactionEmojis('duplicate')).toEqual(['😎']);
  });
});
