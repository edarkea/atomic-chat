import { signal } from '@angular/core';
import { describe, expect, it } from 'vitest';
import { WorkspaceConversationViewCoordinator } from './workspace-conversation-view.coordinator';
import type { ConversationSummary, RoomState } from '../../core/domain';

describe('WorkspaceConversationViewCoordinator', () => {
  it('filters by search and preserves direct and MUC rows', () => {
    const summaries = signal<ReadonlyArray<ConversationSummary>>([
      {
        id: 'direct-a',
        accountId: 'account-a',
        kind: 'direct',
        jid: 'alice@example.invalid',
        title: 'Alice',
        unreadCount: 1,
        lastMessageAt: 10,
      },
      {
        id: 'direct-b',
        accountId: 'account-b',
        kind: 'direct',
        jid: 'bob@example.invalid',
        title: 'Bob',
        unreadCount: 0,
        lastMessageAt: 30,
      },
    ]);
    const joinedRooms = signal<ReadonlyArray<RoomState>>([
      {
        accountId: 'account-a',
        room: {
          jid: 'lobby@conference.example.invalid',
          room: 'lobby',
          service: 'conference.example.invalid',
        },
        status: 'joined',
        participants: [],
        sessionGeneration: 1,
      },
    ]);
    const search = signal('lobby');
    const activity = signal<ReadonlyMap<string, number>>(
      new Map([['lobby@conference.example.invalid', 40]]),
    );
    const hidden = new Set<string>();
    const coordinator = new WorkspaceConversationViewCoordinator({
      conversationSummaries: summaries,
      joinedRooms,
      search,
      roomActivity: activity,
      contactsByBareJid: signal(
        new Map([['alice@example.invalid', { jid: 'alice@example.invalid', groups: [] }]]),
      ),
      isHidden: (accountId, kind, jid) => hidden.has(`${accountId}:${kind}:${jid}`),
    });

    expect(coordinator.items()?.map((item) => item.kind)).toEqual(['muc']);
    expect(coordinator.items()?.[0]).toMatchObject({
      kind: 'muc',
      lastActivity: 40,
    });

    search.set('alice');
    expect(coordinator.items()?.map((item) => item.kind === 'direct' && item.contact.jid)).toEqual([
      'alice@example.invalid',
    ]);
  });

  it('uses contact index fallbacks, hides rows and orders by activity then identity', () => {
    const summaries = signal<ReadonlyArray<ConversationSummary>>([
      {
        id: 'direct-a',
        accountId: 'account-a',
        kind: 'direct',
        jid: 'alice@example.invalid/resource',
        title: 'Alice fallback',
        unreadCount: 0,
        lastMessageAt: 5,
      },
      {
        id: 'direct-b',
        accountId: 'account-a',
        kind: 'direct',
        jid: 'bob@example.invalid',
        title: 'Bob fallback',
        unreadCount: 0,
        lastMessageAt: 5,
      },
    ]);
    const hidden = signal(new Set(['account-a:direct:alice@example.invalid/resource']));
    const coordinator = new WorkspaceConversationViewCoordinator({
      conversationSummaries: summaries,
      joinedRooms: signal([]),
      search: signal(''),
      roomActivity: undefined,
      contactsByBareJid: signal(
        new Map([['bob@example.invalid', { jid: 'bob@example.invalid', name: 'Bob', groups: [] }]]),
      ),
      isHidden: (accountId, kind, jid) => hidden().has(`${accountId}:${kind}:${jid}`),
    });

    expect(coordinator.items()?.map((item) => item.kind === 'direct' && item.contact.jid)).toEqual([
      'bob@example.invalid',
    ]);

    hidden.set(new Set());
    expect(coordinator.items()?.map((item) => item.kind === 'direct' && item.contact.jid)).toEqual([
      'alice@example.invalid/resource',
      'bob@example.invalid',
    ]);
  });

  it('keeps the unavailable summaries state distinguishable', () => {
    const coordinator = new WorkspaceConversationViewCoordinator({
      conversationSummaries: undefined,
      joinedRooms: signal([]),
      search: signal(''),
      roomActivity: undefined,
      contactsByBareJid: signal(new Map()),
      isHidden: () => false,
    });

    expect(coordinator.items()).toBeUndefined();
  });
});
