import { computed, Signal } from '@angular/core';
import type { Contact, Message, ReactionActor, ReactionState } from '../../core/domain';
import { DirectMessageIndex } from '../../core/messaging/direct-message-index';
import type { ConversationTimelineItem } from './conversation-view.models';
import { formatMessageTime } from './message-date-time';
import { bareJid } from '../../core/identity';

type TextTimelineItem = Extract<ConversationTimelineItem, { kind: 'text' }>;

export interface ConversationMessageContext {
  readonly activeContact: Signal<Contact | undefined>;
  readonly selectedJid: Signal<string>;
  readonly accountId: Signal<string>;
  readonly timeline: Signal<ReadonlyArray<ConversationTimelineItem>>;
  readonly reactions: Signal<ReadonlyMap<string, ReactionState>>;
}

export class ConversationMessageCoordinator {
  private readonly directMessageIndex = new DirectMessageIndex();
  private readonly textTimelineMessages = computed(() =>
    this.context
      .timeline()
      .filter((item): item is TextTimelineItem => item.kind === 'text')
      .map((item) => item.message),
  );
  private readonly textTimelineByMessageId = computed(() => {
    const byId = new Map<string, TextTimelineItem>();
    for (const item of this.context.timeline()) {
      if (item.kind === 'text' && !byId.has(item.message.id)) byId.set(item.message.id, item);
    }
    return byId;
  });

  constructor(private readonly context: ConversationMessageContext) {}

  reactionFor(messageId: string): ReactionState | undefined {
    const live = this.context
      .reactions()
      .get(`${bareJid(this.context.selectedJid())}|${messageId}`);
    if (live) return live;
    const item = this.textTimelineByMessageId().get(messageId);
    if (!item?.message.reactions?.length) return undefined;
    return {
      accountId: this.context.accountId(),
      conversationId: item.message.conversationId,
      targetMessageId: messageId,
      target: {
        ...(item.message.messageId ? { messageId: item.message.messageId } : {}),
        ...(item.message.originId ? { originId: item.message.originId } : {}),
        stanzaIds: item.message.stanzaIds || [],
        authorJid: item.message.senderJid,
      },
      reactions: item.message.reactions,
      updatedAt: item.message.createdAt,
      source: 'direct',
    };
  }

  ownReactionEmojis(messageId: string): ReadonlyArray<string> {
    const accountId = this.context.accountId().toLowerCase();
    return (
      this.reactionFor(messageId)
        ?.reactions.filter((reaction) =>
          reaction.actors.some((actor) => actor.id.toLowerCase() === accountId),
        )
        .map((reaction) => reaction.emoji) || []
    );
  }

  stableActionId(message: Message): string {
    return message.originId || message.messageId || message.stanzaIds?.[0]?.id ? message.id : '';
  }

  actionTargetId(message: Message): string {
    return message.originId || message.messageId || message.stanzaIds?.[0]?.id || '';
  }

  replyTargetId(reference: Message['replyTo']): string {
    if (!reference) return '';
    const target = this.directMessageIndex.findByReference(
      this.textTimelineMessages(),
      reference,
      this.context.accountId(),
      this.context.selectedJid(),
      true,
    );
    return target?.id || '';
  }

  replyAuthor(reference: Message['replyTo']): string {
    if (!reference) return '';
    const target = this.textTimelineByMessageId().get(this.replyTargetId(reference));
    if (target) return target.senderLabel;
    const author = bareJid(reference.authorJid);
    if (author === bareJid(this.context.accountId())) return 'Tú';
    if (author === bareJid(this.context.selectedJid()))
      return this.context.activeContact()?.name?.trim() || 'Contacto';
    return 'Contacto no disponible';
  }

  replyQuote(reference: Message['replyTo']): string {
    if (!reference) return '';
    const target = this.textTimelineByMessageId().get(this.replyTargetId(reference));
    return target
      ? this.quoteFragment(target.message.body.text)
      : this.quoteFragment(reference.quote || '');
  }

  replyTime(reference: Message['replyTo']): string {
    if (!reference) return '';
    const target = this.textTimelineByMessageId().get(this.replyTargetId(reference));
    return target ? formatMessageTime(target.message.createdAt) : '';
  }

  reactionActorLabel(actor: ReactionActor): string {
    const bareActor = bareJid(actor.realJid || actor.id);
    const bareAccount = bareJid(this.context.accountId());
    if (bareActor === bareAccount) return 'Tú';
    const contact = this.context.activeContact();
    const bareContact = bareJid(contact?.jid || this.context.selectedJid());
    if (bareActor === bareContact && contact?.name?.trim()) return contact.name.trim();
    return bareActor.split('@')[0] || 'Participante';
  }

  private quoteFragment(value: string): string {
    const points = Array.from(value);
    return points.length > 180 ? `${points.slice(0, 179).join('')}…` : value;
  }
}
