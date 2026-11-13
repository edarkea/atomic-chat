import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatState, ChatStateEvent } from '../domain';
import { IncomingChatStateStore } from './incoming-chat-state.store';

const accountId = 'a@example.invalid';

function state(
  state: ChatState,
  conversationId = 'friend@example.invalid',
  senderJid = 'friend@example.invalid/desktop',
  eventAccountId = accountId,
): ChatStateEvent {
  return { accountId: eventAccountId, conversationId, senderJid, state };
}

describe('IncomingChatStateStore', () => {
  let store: IncomingChatStateStore;

  beforeEach(() => {
    vi.useFakeTimers();
    store = TestBed.inject(IncomingChatStateStore);
  });

  afterEach(() => {
    store.clear();
    vi.useRealTimers();
  });

  it('normalizes bare conversation JIDs and expires composing after six seconds', () => {
    store.receive(state('composing', 'FRIEND@example.invalid/mobile'), accountId);

    expect(store.states().get('friend@example.invalid')).toBe('composing');
    vi.advanceTimersByTime(5999);
    expect(store.states().get('friend@example.invalid')).toBe('composing');

    vi.advanceTimersByTime(1);
    expect(store.states().size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('refreshes an existing composing timer without a stale expiration', () => {
    store.receive(state('composing'), accountId);
    vi.advanceTimersByTime(5000);
    store.receive(state('composing', 'friend@example.invalid/phone'), accountId);

    vi.advanceTimersByTime(1001);
    expect(store.states().get('friend@example.invalid')).toBe('composing');

    vi.advanceTimersByTime(4999);
    expect(store.states().size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('filters events for other accounts and from the active account itself', () => {
    store.receive(
      state('composing', 'friend@example.invalid', 'friend@example.invalid', 'b@example.invalid'),
      accountId,
    );
    store.receive(state('composing', 'a@example.invalid', 'A@example.invalid/phone'), accountId);
    expect(store.states().size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears an indicator on non-composing states without affecting other conversations', () => {
    store.receive(state('composing'), accountId);
    store.receive(
      state('composing', 'other@example.invalid', 'other@example.invalid/desktop'),
      accountId,
    );
    expect(store.states().size).toBe(2);

    store.receive(state('paused'), accountId);
    expect(store.states().has('friend@example.invalid')).toBe(false);
    expect(store.states().get('other@example.invalid')).toBe('composing');
    expect(vi.getTimerCount()).toBe(1);

    store.receive(
      state('inactive', 'other@example.invalid', 'other@example.invalid/desktop'),
      accountId,
    );
    expect(store.states().size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears all indicators and cancels timers on session reset', () => {
    store.receive(state('composing'), accountId);
    store.receive(
      state('composing', 'other@example.invalid', 'other@example.invalid/desktop'),
      accountId,
    );
    store.clear();

    expect(store.states().size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10000);
    expect(store.states().size).toBe(0);
  });
});
