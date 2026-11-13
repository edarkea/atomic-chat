import { signal } from '@angular/core';
import { describe, expect, it, vi } from 'vitest';
import type { AttentionClearRequest, AttentionRequest } from '../domain';
import type { AttentionPort } from '../ports';
import { ActiveConversationStore } from '../stores/active-conversation.store';
import { WindowFocusStore } from '../stores/window-focus.store';
import { UnreadStore } from '../stores/unread.store';
import { UnreadConversationCoordinator } from './unread-conversation.coordinator';

const accountId = 'alice@example.invalid';
const directConversation = 'Bob@Example.Invalid/resource';
const roomConversation = 'room@conference.example.invalid';

describe('UnreadConversationCoordinator', () => {
  function createCoordinator(options?: {
    readonly currentAccountId?: string;
    readonly visible?: boolean;
    readonly focused?: boolean;
    readonly attention?: AttentionPort | null;
  }): {
    readonly coordinator: UnreadConversationCoordinator;
    readonly unread: UnreadStore;
    readonly focused: ReturnType<typeof signal<boolean>>;
    readonly visible: ReturnType<typeof vi.fn>;
  } {
    const unread = new UnreadStore();
    const focused = signal(options?.focused ?? false);
    const visible = vi.fn(() => options?.visible ?? false);
    const currentAccount = options?.currentAccountId ?? accountId;
    const activeConversation = {
      isVisible: visible,
    } satisfies Pick<ActiveConversationStore, 'isVisible'>;
    const windowFocus = {
      isFocused: focused,
    } satisfies Pick<WindowFocusStore, 'isFocused'>;
    const coordinator = new UnreadConversationCoordinator({
      unread,
      activeConversation,
      windowFocus,
      attention: options?.attention ?? null,
      currentAccountId: () => currentAccount,
    });
    return { coordinator, unread, focused, visible };
  }

  function attentionPort(): {
    readonly attention: AttentionPort;
    readonly requests: AttentionRequest[];
    readonly clears: AttentionClearRequest[];
  } {
    const requests: AttentionRequest[] = [];
    const clears: AttentionClearRequest[] = [];
    const attention: AttentionPort = {
      request: async (input) => {
        requests.push(input);
        return { ok: true, value: undefined, version: 1, requestId: input.requestId };
      },
      clear: async (input) => {
        clears.push(input);
        return { ok: true, value: undefined, version: 1, requestId: input.requestId };
      },
    };
    return { attention, requests, clears };
  }

  it('does not increment a visible and focused direct conversation', () => {
    const { coordinator, unread, visible } = createCoordinator({ visible: true, focused: true });

    const result = coordinator.recordIncoming({
      accountId,
      kind: 'direct',
      conversationId: directConversation,
      messageIdentity: 'direct-1',
    });

    expect(result).toEqual({ isNew: true, unreadIncremented: false, attentionRequested: false });
    expect(unread.total()).toBe(0);
    expect(visible).toHaveBeenCalledWith(accountId, 'direct', directConversation);
  });

  it('requests native attention for an unfocused direct conversation and normalizes its JID', () => {
    const { attention, requests } = attentionPort();
    const { coordinator, unread } = createCoordinator({ attention });

    const result = coordinator.recordIncoming({
      accountId,
      kind: 'direct',
      conversationId: directConversation,
      messageIdentity: 'direct-2',
    });

    expect(result.attentionRequested).toBe(true);
    expect(unread.counts().get('alice@example.invalid|direct|bob@example.invalid')).toBe(1);
    expect(requests).toHaveLength(1);
    expect(requests[0].conversationId).toBe('bob@example.invalid');
  });

  it('keeps direct and MUC counters separate for another active conversation', () => {
    const { coordinator, unread } = createCoordinator({ focused: true });

    coordinator.recordIncoming({
      accountId,
      kind: 'direct',
      conversationId: directConversation,
      messageIdentity: 'same-message-id',
    });
    coordinator.recordIncoming({
      accountId,
      kind: 'muc',
      conversationId: roomConversation,
      messageIdentity: 'same-message-id',
    });

    expect(unread.counts().get('alice@example.invalid|direct|bob@example.invalid')).toBe(1);
    expect(unread.counts().get('alice@example.invalid|muc|room@conference.example.invalid')).toBe(
      1,
    );
  });

  it('delegates deduplication to UnreadStore without repeating attention', () => {
    const { attention, requests } = attentionPort();
    const { coordinator, unread } = createCoordinator({ attention });
    const input = {
      accountId,
      kind: 'direct' as const,
      conversationId: directConversation,
      messageIdentity: 'duplicate-message',
    };

    expect(coordinator.recordIncoming(input).isNew).toBe(true);
    expect(coordinator.recordIncoming(input).isNew).toBe(false);
    expect(unread.counts().get('alice@example.invalid|direct|bob@example.invalid')).toBe(1);
    expect(requests).toHaveLength(1);
  });

  it('marks only an active focused conversation as read and clears native attention', () => {
    const { attention, clears } = attentionPort();
    const { coordinator, unread, focused } = createCoordinator({
      attention,
      visible: true,
      focused: false,
    });
    coordinator.recordIncoming({
      accountId,
      kind: 'direct',
      conversationId: directConversation,
      messageIdentity: 'pending-read',
    });
    focused.set(true);

    expect(coordinator.markConversationRead(accountId, 'direct', directConversation)).toBe(true);
    expect(unread.total()).toBe(0);
    expect(clears).toHaveLength(1);
    expect(clears[0].accountId).toBe(accountId);
  });

  it('does not mark a different conversation as read', () => {
    const { coordinator, unread } = createCoordinator({ visible: false, focused: true });
    unread.recordIncoming(accountId, 'direct', directConversation, 'pending', false, true);

    expect(coordinator.markConversationRead(accountId, 'direct', directConversation)).toBe(false);
    expect(unread.total()).toBe(1);
  });

  it('resets the previous account and clears its native attention state', () => {
    const { attention, clears } = attentionPort();
    const { coordinator, unread } = createCoordinator({ attention });
    coordinator.recordIncoming({
      accountId,
      kind: 'muc',
      conversationId: roomConversation,
      messageIdentity: 'old-account-message',
    });

    coordinator.resetAccount(accountId);

    expect(unread.totalForAccount(accountId)).toBe(0);
    expect(clears).toHaveLength(1);
    expect(clears[0].accountId).toBe(accountId);
  });

  it('does not repeat native attention clearing when two coordinators reset the same account', () => {
    const { attention, clears } = attentionPort();
    const unread = new UnreadStore();
    const activeConversation = {
      isVisible: vi.fn(() => false),
    } satisfies Pick<ActiveConversationStore, 'isVisible'>;
    const windowFocus = {
      isFocused: signal(false),
    } satisfies Pick<WindowFocusStore, 'isFocused'>;
    const dependencies = {
      unread,
      activeConversation,
      windowFocus,
      attention,
      currentAccountId: () => accountId,
    };
    const first = new UnreadConversationCoordinator(dependencies);
    const second = new UnreadConversationCoordinator(dependencies);
    first.recordIncoming({
      accountId,
      kind: 'direct',
      conversationId: directConversation,
      messageIdentity: 'shared-reset',
    });

    first.resetAccount(accountId);
    second.resetAccount(accountId);

    expect(clears).toHaveLength(1);
  });

  it('ignores late events from a previous account', () => {
    const { attention, requests } = attentionPort();
    const { coordinator, unread } = createCoordinator({
      attention,
      currentAccountId: 'new@example.invalid',
    });

    const result = coordinator.recordIncoming({
      accountId,
      kind: 'direct',
      conversationId: directConversation,
      messageIdentity: 'late-message',
    });

    expect(result).toEqual({ isNew: false, unreadIncremented: false, attentionRequested: false });
    expect(unread.total()).toBe(0);
    expect(requests).toEqual([]);
  });
});
