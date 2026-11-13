import { signal, type WritableSignal } from '@angular/core';
import { createOpaqueId } from '../ids';
import { DirectMessageIndex } from '../messaging/direct-message-index';
import type {
  ChatState,
  Message,
  MessageReactionInput,
  MessageSendInput,
  ReactionRejected,
  ReactionState,
  Result,
} from '../domain';
import type { ChatStateEvent } from '../domain/domain-event';
import { IncomingChatStateStore } from '../stores/incoming-chat-state.store';
import { OutgoingChatStateStore } from '../stores/outgoing-chat-state.store';
import type { XmppPort } from '../ports';
import { bareJid } from '../identity';

export interface DirectMessagingDependencies {
  readonly messages: WritableSignal<Message[]>;
  readonly accountId: () => string;
  readonly isConnected: () => boolean;
  readonly xmpp: XmppPort;
  readonly incomingChatState: IncomingChatStateStore;
  readonly outgoingChatState: OutgoingChatStateStore;
  readonly reportError: (message: string) => void;
  readonly upsertMessage: (message: Message, conversationId: string) => void;
}

/** Owns direct-message commands, reactions and transient chat-state behavior. */
export class DirectMessagingCoordinator {
  readonly reactions = signal<ReadonlyMap<string, ReactionState>>(new Map());
  readonly pendingReactionVersion = signal(0);

  private readonly directMessageIndex = new DirectMessageIndex();
  private readonly pendingReactions = new Map<string, ReactionState>();
  private readonly reactionOperationVersions = new Map<string, number>();
  private readonly outgoingChatStateContext: {
    readonly accountId: () => string;
    readonly isConnected: () => boolean;
  };

  constructor(private readonly dependencies: DirectMessagingDependencies) {
    this.outgoingChatStateContext = {
      accountId: () => this.dependencies.accountId(),
      isConnected: () => this.dependencies.isConnected(),
    };
  }

  resetForAccount(): void {
    this.reactions.set(new Map());
    this.pendingReactions.clear();
    this.reactionOperationVersions.clear();
    this.pendingReactionVersion.update((value) => value + 1);
  }

  clearChatStates(): void {
    this.dependencies.outgoingChatState.clear();
    this.dependencies.incomingChatState.clear();
  }

  handleReactionChanged(reaction: ReactionState): void {
    if (reaction.accountId !== this.dependencies.accountId()) return;
    const target = this.directMessageIndex.findByReference(
      this.dependencies.messages(),
      reaction.target,
      this.dependencies.accountId(),
      reaction.conversationId,
    );
    if (target) {
      this.setReactionForTarget(reaction, target.id);
      return;
    }

    const key = `${reaction.accountId}|${reaction.source}|${reaction.conversationId.toLowerCase()}|${reaction.targetMessageId}`;
    this.pendingReactions.set(key, reaction);
    if (this.pendingReactions.size > 256)
      this.pendingReactions.delete(this.pendingReactions.keys().next().value || '');
    this.pendingReactionVersion.update((value) => value + 1);
  }

  handleReactionRejected(rejection: ReactionRejected): void {
    if (rejection.accountId === this.dependencies.accountId())
      this.dependencies.reportError(rejection.message);
  }

  reconcilePendingMessages(): void {
    const messages = this.dependencies.messages();
    if (!messages.length || !this.pendingReactions.size) return;
    this.pendingReactions.forEach((reaction, key) => {
      const target = this.directMessageIndex.findByReference(
        messages,
        reaction.target,
        this.dependencies.accountId(),
        reaction.conversationId,
      );
      if (!target) return;
      this.setReactionForTarget(reaction, target.id);
      this.pendingReactions.delete(key);
    });
  }

  handleChatStateChanged(event: ChatStateEvent): void {
    this.dependencies.incomingChatState.receive(event, this.dependencies.accountId());
  }

  async send(text: string, conversationId: string): Promise<boolean> {
    const cleanText = text;
    const recipient = conversationId.trim();
    if (!cleanText.trim() || !recipient || !this.dependencies.accountId().trim()) return false;
    try {
      const result = await this.sendMessageInput({
        version: 1,
        requestId: createOpaqueId('req'),
        accountId: this.dependencies.accountId(),
        conversationId: recipient,
        clientMessageId: createOpaqueId('client-msg'),
        body: { kind: 'text', text: cleanText },
      });
      if (result.ok) {
        await this.sendChatState(conversationId, 'active');
        this.dependencies.upsertMessage(result.value, recipient);
        return true;
      }
      this.dependencies.reportError(result.error.message);
      return false;
    } catch {
      this.dependencies.reportError('No fue posible enviar el mensaje.');
      return false;
    }
  }

  async sendMessageWithReply(
    text: string,
    conversationId: string,
    replyToMessageId?: string,
  ): Promise<boolean> {
    const cleanText = text;
    const recipient = conversationId.trim();
    if (!cleanText.trim() || !recipient || !this.dependencies.accountId().trim()) return false;
    try {
      const result = await this.sendMessageInput({
        version: 1,
        requestId: createOpaqueId('req'),
        accountId: this.dependencies.accountId(),
        conversationId: recipient,
        clientMessageId: createOpaqueId('client-msg'),
        body: { kind: 'text', text: cleanText },
        ...(replyToMessageId ? { replyToMessageId } : {}),
      });
      if (!result.ok) {
        this.dependencies.reportError(result.error.message);
        return false;
      }
      return true;
    } catch {
      this.dependencies.reportError('No fue posible enviar el mensaje.');
      return false;
    }
  }

  async sendReaction(
    conversationId: string,
    targetMessageId: string,
    emojis: ReadonlyArray<string>,
  ): Promise<boolean> {
    const target = this.directMessageIndex.findByTargetId(
      this.dependencies.messages(),
      targetMessageId,
    );
    if (!target) {
      this.dependencies.reportError('El mensaje ya no está disponible para reaccionar.');
      return false;
    }
    const input: MessageReactionInput = {
      version: 1,
      requestId: createOpaqueId('reaction'),
      accountId: this.dependencies.accountId(),
      conversationId,
      targetMessageId,
      emojis,
    };
    const key = this.reactionKey(conversationId, target.id);
    const actorId = this.dependencies.accountId().trim().toLowerCase();
    const previous = this.actorReactionEmojis(this.reactions().get(key), actorId);
    const version = (this.reactionOperationVersions.get(key) || 0) + 1;
    this.reactionOperationVersions.set(key, version);
    this.applyLocalReaction(target, emojis, actorId);
    try {
      const result = await this.dependencies.xmpp.sendReaction(input);
      if (!result.ok) {
        this.rollbackReaction(target, key, version, previous, actorId);
        this.dependencies.reportError(result.error.message);
        return false;
      }
      return true;
    } catch {
      this.rollbackReaction(target, key, version, previous, actorId);
      this.dependencies.reportError('No fue posible enviar la reacción.');
      return false;
    }
  }

  async sendMessageInput(input: MessageSendInput): Promise<Result<Message>> {
    const result = await this.dependencies.xmpp.sendMessage(input);
    if (result.ok) {
      await this.sendChatState(input.conversationId, 'active');
      this.dependencies.upsertMessage(result.value, input.conversationId);
    }
    return result;
  }

  reactionFor(conversationId: string, messageId: string): ReactionState | undefined {
    return this.reactions().get(this.reactionKey(conversationId, messageId));
  }

  async updateTypingState(conversationId: string, draft: string): Promise<void> {
    await this.dependencies.outgoingChatState.updateDraft(
      conversationId,
      draft,
      this.outgoingChatStateContext,
    );
  }

  async setTypingActivity(
    conversationId: string,
    state: Extract<ChatState, 'active' | 'inactive'>,
  ): Promise<void> {
    await this.dependencies.outgoingChatState.setActivity(
      conversationId,
      state,
      this.outgoingChatStateContext,
    );
  }

  private reactionKey(conversationId: string, messageId: string): string {
    return `${bareJid(conversationId)}|${messageId}`;
  }

  private setReactionForTarget(reaction: ReactionState, messageId: string): void {
    const key = this.reactionKey(reaction.conversationId, messageId);
    this.reactions.update((current) => {
      const next = new Map(current);
      const previous = next.get(key);
      const reactions = reaction.actorId
        ? this.mergeReactionActors(
            previous?.reactions || [],
            reaction.reactions,
            reaction.actorId,
            reaction.actorEmojis || [],
          )
        : reaction.reactions;
      if (!reactions.length) {
        next.delete(key);
        return next;
      }
      next.set(key, { ...reaction, targetMessageId: messageId, reactions });
      return next;
    });
  }

  private applyLocalReaction(
    message: Message,
    emojis: ReadonlyArray<string>,
    actorId: string,
  ): void {
    this.setReactionForTarget(
      {
        accountId: this.dependencies.accountId(),
        conversationId: message.conversationId,
        targetMessageId: message.id,
        target: {
          ...(message.messageId ? { messageId: message.messageId } : {}),
          ...(message.originId ? { originId: message.originId } : {}),
          stanzaIds: message.stanzaIds || [],
          authorJid: message.senderJid,
        },
        reactions:
          this.reactions().get(this.reactionKey(message.conversationId, message.id))?.reactions ||
          [],
        updatedAt: new Date().toISOString(),
        source: 'direct',
        actorId,
        actorEmojis: [...new Set(emojis)],
      },
      message.id,
    );
  }

  private rollbackReaction(
    message: Message,
    key: string,
    version: number,
    previous: ReadonlyArray<string>,
    actorId: string,
  ): void {
    if (this.reactionOperationVersions.get(key) !== version) return;
    this.setReactionForTarget(
      {
        accountId: this.dependencies.accountId(),
        conversationId: message.conversationId,
        targetMessageId: message.id,
        target: {
          ...(message.messageId ? { messageId: message.messageId } : {}),
          ...(message.originId ? { originId: message.originId } : {}),
          stanzaIds: message.stanzaIds || [],
          authorJid: message.senderJid,
        },
        reactions: this.reactions().get(key)?.reactions || [],
        updatedAt: new Date().toISOString(),
        source: 'direct',
        actorId,
        actorEmojis: previous,
      },
      message.id,
    );
  }

  private actorReactionEmojis(
    state: ReactionState | undefined,
    actorId: string,
  ): ReadonlyArray<string> {
    return (
      state?.reactions
        .filter((reaction) => reaction.actors.some((actor) => actor.id.toLowerCase() === actorId))
        .map((reaction) => reaction.emoji) || []
    );
  }

  private mergeReactionActors(
    previous: ReactionState['reactions'],
    incoming: ReactionState['reactions'],
    actorId: string,
    actorEmojis: ReadonlyArray<string>,
  ): ReactionState['reactions'] {
    const actors = new Map<
      string,
      { actor: ReactionState['reactions'][number]['actors'][number]; emojis: Set<string> }
    >();
    for (const reaction of previous)
      for (const actor of reaction.actors)
        actors.set(actor.id, {
          actor,
          emojis: new Set([...(actors.get(actor.id)?.emojis || []), reaction.emoji]),
        });
    for (const reaction of incoming)
      for (const actor of reaction.actors)
        actors.set(actor.id, {
          actor,
          emojis: new Set([...(actors.get(actor.id)?.emojis || []), reaction.emoji]),
        });
    const selected = actors.get(actorId)?.actor || {
      id: actorId,
      label: actorId,
      identifiable: false,
    };
    actors.delete(actorId);
    if (actorEmojis.length) actors.set(actorId, { actor: selected, emojis: new Set(actorEmojis) });
    return [...new Set([...actors.values()].flatMap((entry) => [...entry.emojis]))].map(
      (emoji) => ({
        emoji,
        actors: [...actors.values()]
          .filter((entry) => entry.emojis.has(emoji))
          .map((entry) => entry.actor),
      }),
    );
  }

  private sendChatState(conversationId: string, state: ChatState): Promise<void> {
    return this.dependencies.outgoingChatState.send(
      conversationId,
      state,
      this.outgoingChatStateContext,
    );
  }
}
