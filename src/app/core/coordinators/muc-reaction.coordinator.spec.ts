import { describe, expect, it } from 'vitest';
import { MucReactionCoordinator } from './muc-reaction.coordinator';
import type { MucReactionInput, ReactionState, RoomMessage } from '../domain';

const roomJid = 'room@conference.example.invalid';

function message(id: string, accountId = 'account@example.invalid'): RoomMessage {
  return {
    id,
    accountId,
    roomJid,
    occupantJid: `${roomJid}/sender`,
    body: { kind: 'text', text: id },
    receivedAt: '2026-11-12T00:00:00.000Z',
    source: 'live',
    sessionGeneration: 1,
    stanzaIds: [{ id: `stanza-${id}`, by: roomJid }],
  };
}

function reaction(targetMessageId: string): ReactionState {
  return {
    accountId: 'account@example.invalid',
    conversationId: roomJid,
    targetMessageId,
    target: {
      stanzaIds: [{ id: `stanza-${targetMessageId}`, by: roomJid }],
      authorJid: `${roomJid}/sender`,
    },
    reactions: [
      {
        emoji: '😂',
        actors: [
          {
            id: `${roomJid}/lara`,
            label: 'lara',
            occupantJid: `${roomJid}/lara`,
            identifiable: false,
          },
        ],
      },
    ],
    updatedAt: '2026-11-12T00:00:00.000Z',
    source: 'muc',
    actorId: `${roomJid}/lara`,
    actorEmojis: ['😂'],
  };
}

function input(emojis: ReadonlyArray<string>): MucReactionInput {
  return {
    version: 1,
    requestId: 'request-1',
    accountId: 'account@example.invalid',
    roomJid,
    targetMessageId: 'stanza-message-1',
    emojis,
  };
}

describe('MucReactionCoordinator', () => {
  it('keeps a reaction pending until its matching room message exists', () => {
    const coordinator = new MucReactionCoordinator();
    const incoming = reaction('message-1');

    coordinator.acceptRemote(incoming, []);
    expect(coordinator.reactionFor(roomJid, 'message-1')).toBeUndefined();

    coordinator.reconcile([message('message-1')]);

    expect(coordinator.reactionFor(roomJid, 'message-1')?.reactions[0].emoji).toBe('😂');
  });

  it('ignores a matching stanza from another room or account', () => {
    const coordinator = new MucReactionCoordinator();
    const incoming = reaction('message-1');

    coordinator.acceptRemote(incoming, [message('message-1', 'other@example.invalid')]);
    expect(coordinator.reactionFor(roomJid, 'message-1')).toBeUndefined();
    expect(
      coordinator.findTarget([message('message-1')], 'stanza-message-1', 'other@room'),
    ).toBeUndefined();
  });

  it('rolls back a failed local reaction without overwriting a newer operation', () => {
    const coordinator = new MucReactionCoordinator();
    const target = message('message-1');
    const first = coordinator.beginLocalReaction(target, input(['👍']), 'account@example.invalid');
    const second = coordinator.beginLocalReaction(target, input(['❤️']), 'account@example.invalid');

    coordinator.rollback(first);
    expect(
      coordinator.reactionFor(roomJid, target.id)?.reactions.map((item) => item.emoji),
    ).toEqual(['❤️']);

    coordinator.rollback(second);
    expect(
      coordinator.reactionFor(roomJid, target.id)?.reactions.map((item) => item.emoji),
    ).toEqual(['👍']);
  });

  it('clears reactions and pending state on reset', () => {
    const coordinator = new MucReactionCoordinator();
    coordinator.acceptRemote(reaction('message-1'), []);
    coordinator.reset();
    coordinator.reconcile([message('message-1')]);

    expect(coordinator.reactionFor(roomJid, 'message-1')).toBeUndefined();
  });
});
