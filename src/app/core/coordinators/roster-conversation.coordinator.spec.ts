import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import type { HistoryPort, XmppPort } from '../ports';
import {
  RosterConversationCoordinator,
  RosterConversationDependencies,
} from './roster-conversation.coordinator';

const ok = <T>(value: T) => ({ ok: true as const, value, version: 1 as const, requestId: 'test' });
type StoredConversation = { accountId: string; jid: string; lastActivity: string };
type StoredConversationResult = ReturnType<typeof ok<StoredConversation[]>>;

function createCoordinator() {
  const accountId = signal('a@example.invalid');
  const generation = signal(1);
  const unreadCounts = signal<ReadonlyMap<string, number>>(new Map());
  const history = {
    conversations: vi.fn(async () => ok([])),
  } as unknown as HistoryPort;
  const xmpp = {
    listRoster: vi.fn(async () => ok([])),
  } as unknown as XmppPort;
  const dependencies: RosterConversationDependencies = {
    history,
    xmpp,
    unreadCounts,
    accountId: () => accountId(),
    identityGeneration: () => generation(),
    isCurrent: (expectedGeneration, expectedAccountId) =>
      expectedGeneration === generation() && expectedAccountId === accountId(),
    reportError: vi.fn(),
  };
  return {
    accountId,
    generation,
    unreadCounts,
    history,
    xmpp,
    coordinator: new RosterConversationCoordinator(dependencies),
  };
}

describe('RosterConversationCoordinator', () => {
  it('preserves conversation contacts while reconciling the current roster', () => {
    const harness = createCoordinator();
    harness.coordinator.resetForAccount('a@example.invalid');
    harness.coordinator.addConversation('a@example.invalid', 'history@example.invalid', 100);
    harness.coordinator.mergeRoster([
      {
        jid: 'roster@example.invalid/desktop',
        name: 'Roster',
        groups: ['friends'],
        subscription: 'both',
        source: 'roster',
      },
    ]);

    expect(harness.coordinator.contacts().map((contact) => contact.jid)).toEqual([
      'roster@example.invalid',
      'history@example.invalid',
    ]);
    expect(
      harness.coordinator.contacts().find((contact) => contact.jid === 'history@example.invalid')
        ?.source,
    ).toBe('conversation');
  });

  it('loads persisted summaries with contact titles and current unread counts', async () => {
    const harness = createCoordinator();
    harness.coordinator.resetForAccount('a@example.invalid');
    harness.coordinator.mergeRoster([
      {
        jid: 'bob@example.invalid',
        name: 'Bob',
        groups: [],
        subscription: 'both',
        source: 'roster',
      },
    ]);
    harness.unreadCounts.set(new Map([['a@example.invalid|direct|bob@example.invalid', 3]]));
    harness.history.conversations = vi.fn(async () =>
      ok<StoredConversation[]>([
        {
          accountId: 'a@example.invalid',
          jid: 'bob@example.invalid/resource',
          lastActivity: '2026-01-02',
        },
      ]),
    );

    await harness.coordinator.loadStoredConversations('a@example.invalid', 1);

    expect(harness.coordinator.conversationSummaries()).toEqual([
      {
        id: 'a@example.invalid|direct|bob@example.invalid',
        accountId: 'a@example.invalid',
        kind: 'direct',
        jid: 'bob@example.invalid',
        title: 'Bob',
        unreadCount: 3,
        lastMessageAt: Date.parse('2026-01-02'),
      },
    ]);
  });

  it('ignores persisted conversations returned after an account change', async () => {
    const harness = createCoordinator();
    let release!: (value: StoredConversationResult) => void;
    harness.history.conversations = vi.fn(
      () => new Promise<StoredConversationResult>((resolve) => (release = resolve)),
    );
    const pending = harness.coordinator.loadStoredConversations('a@example.invalid', 1);
    harness.accountId.set('b@example.invalid');
    harness.generation.set(2);
    release(
      ok<StoredConversation[]>([
        { accountId: 'a@example.invalid', jid: 'late@example.invalid', lastActivity: '2026-01-03' },
      ]),
    );
    await pending;

    expect(harness.coordinator.conversationSummaries()).toEqual([]);
  });

  it('updates unread without moving activity backwards or crossing accounts', () => {
    const harness = createCoordinator();
    harness.coordinator.resetForAccount('a@example.invalid');
    harness.coordinator.addConversation('a@example.invalid', 'bob@example.invalid', 100);
    harness.unreadCounts.set(new Map([['a@example.invalid|direct|bob@example.invalid', 2]]));
    harness.coordinator.updateConversationUnread(
      'a@example.invalid',
      'bob@example.invalid/resource',
    );
    harness.coordinator.addConversation('a@example.invalid', 'bob@example.invalid', 50);

    expect(harness.coordinator.conversationSummaries()[0]).toMatchObject({
      jid: 'bob@example.invalid',
      unreadCount: 2,
      lastMessageAt: 100,
    });
    harness.accountId.set('b@example.invalid');
    harness.coordinator.addConversation('a@example.invalid', 'other@example.invalid', 200);
    expect(harness.coordinator.conversationSummaries()).toHaveLength(1);
  });
});
