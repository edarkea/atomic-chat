import { signal } from '@angular/core';
import type { MucReactionInput, ReactionState, RoomMessage } from '../domain';
import { matchesRoomMessageReference } from '../messaging/message-reference';

export interface LocalMucReactionOperation {
  readonly message: RoomMessage;
  readonly roomJid: string;
  readonly key: string;
  readonly version: number;
  readonly actorId: string;
  readonly previous: ReadonlyArray<string>;
}

export class MucReactionCoordinator {
  readonly reactions = signal<ReadonlyMap<string, ReactionState>>(new Map());
  readonly pendingVersion = signal(0);
  private readonly pending = new Map<string, ReactionState>();
  private readonly operationVersions = new Map<string, number>();

  reset(): void {
    this.reactions.set(new Map());
    this.pending.clear();
    this.operationVersions.clear();
    this.pendingVersion.update((version) => version + 1);
  }

  reactionFor(roomJid: string, messageId: string): ReactionState | undefined {
    return this.reactions().get(this.reactionKey(roomJid, messageId));
  }

  findTarget(
    messages: ReadonlyArray<RoomMessage>,
    targetId: string,
    roomJid: string,
  ): RoomMessage | undefined {
    if (!targetId.trim()) return undefined;
    const normalizedRoom = roomJid.toLowerCase();
    return messages.find((message) =>
      message.stanzaIds?.some(
        (item) => item.id === targetId && item.by.toLowerCase() === normalizedRoom,
      ),
    );
  }

  acceptRemote(reaction: ReactionState, messages: ReadonlyArray<RoomMessage>): void {
    const target = messages.find((message) => this.matchesTarget(message, reaction));
    if (!target) {
      const key = `${reaction.accountId}|${reaction.conversationId.toLowerCase()}|${reaction.targetMessageId}`;
      this.pending.set(key, reaction);
      if (this.pending.size > 256) {
        const firstKey = this.pending.keys().next().value;
        if (firstKey) this.pending.delete(firstKey);
      }
      this.pendingVersion.update((version) => version + 1);
      return;
    }
    this.setReactionForTarget(reaction, target.id);
  }

  reconcile(messages: ReadonlyArray<RoomMessage>): void {
    if (!this.pending.size) return;
    this.pending.forEach((reaction, key) => {
      const target = messages.find((message) => this.matchesTarget(message, reaction));
      if (!target) return;
      this.setReactionForTarget(reaction, target.id);
      this.pending.delete(key);
    });
  }

  beginLocalReaction(
    message: RoomMessage,
    input: MucReactionInput,
    actorId: string,
  ): LocalMucReactionOperation {
    const key = this.reactionKey(input.roomJid, message.id);
    const previous = this.actorReactionEmojis(this.reactions().get(key), actorId);
    const version = (this.operationVersions.get(key) || 0) + 1;
    this.operationVersions.set(key, version);
    this.setReactionForTarget(
      {
        accountId: message.accountId,
        conversationId: input.roomJid,
        targetMessageId: message.id,
        target: {
          ...(message.messageId ? { messageId: message.messageId } : {}),
          ...(message.originId ? { originId: message.originId } : {}),
          stanzaIds: message.stanzaIds || [],
          authorJid: message.occupantJid,
        },
        reactions: this.reactions().get(key)?.reactions || [],
        updatedAt: new Date().toISOString(),
        source: 'muc',
        actorId,
        actorEmojis: [...new Set(input.emojis)],
      },
      message.id,
    );
    return { message, roomJid: input.roomJid, key, version, actorId, previous };
  }

  rollback(operation: LocalMucReactionOperation): void {
    if (this.operationVersions.get(operation.key) !== operation.version) return;
    this.setReactionForTarget(
      {
        accountId: operation.message.accountId,
        conversationId: operation.roomJid,
        targetMessageId: operation.message.id,
        target: {
          ...(operation.message.messageId ? { messageId: operation.message.messageId } : {}),
          ...(operation.message.originId ? { originId: operation.message.originId } : {}),
          stanzaIds: operation.message.stanzaIds || [],
          authorJid: operation.message.occupantJid,
        },
        reactions: this.reactions().get(operation.key)?.reactions || [],
        updatedAt: new Date().toISOString(),
        source: 'muc',
        actorId: operation.actorId,
        actorEmojis: operation.previous,
      },
      operation.message.id,
    );
  }

  private matchesTarget(message: RoomMessage, reaction: ReactionState): boolean {
    return matchesRoomMessageReference(
      message,
      reaction.target,
      reaction.accountId,
      reaction.conversationId,
      false,
    );
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
      label: 'Participante no verificado',
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

  private reactionKey(roomJid: string, messageId: string): string {
    return `${roomJid.toLowerCase()}|${messageId}`;
  }
}
