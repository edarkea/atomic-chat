import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { XMPP_PORT } from '../ports';
import { OutgoingChatStateStore, type OutgoingChatStateContext } from './outgoing-chat-state.store';

const account = 'a@example.invalid';
const friend = 'friend@example.invalid';

describe('OutgoingChatStateStore', () => {
  let store: OutgoingChatStateStore;
  let sendChatState: ReturnType<typeof vi.fn>;
  let xmpp: { sendChatState?: ReturnType<typeof vi.fn> };
  let connected: boolean;
  let currentAccount: string;
  let context: OutgoingChatStateContext;

  beforeEach(() => {
    vi.useFakeTimers();
    connected = true;
    currentAccount = account;
    context = {
      accountId: () => currentAccount,
      isConnected: () => connected,
    };
    sendChatState = vi.fn(async () => ({
      ok: true,
      version: 1,
      requestId: 'test',
      value: undefined,
    }));
    xmpp = { sendChatState };
    TestBed.configureTestingModule({
      providers: [{ provide: XMPP_PORT, useValue: xmpp }],
    });
    store = TestBed.inject(OutgoingChatStateStore);
  });

  afterEach(() => {
    store.clear();
    vi.useRealTimers();
  });

  it('keeps the XMPP payload and deduplicates successive identical states by bare JID', async () => {
    await store.send('FRIEND@example.invalid/mobile ', 'composing', context);
    await store.send('friend@example.invalid/desktop', 'composing', context);
    expect(sendChatState).toHaveBeenCalledTimes(1);
    expect(sendChatState).toHaveBeenCalledWith({
      version: 1,
      requestId: expect.any(String),
      accountId: account,
      conversationId: 'FRIEND@example.invalid/mobile',
      state: 'composing',
    });
    await store.send(friend, 'active', context);
    expect(sendChatState).toHaveBeenCalledTimes(2);
  });

  it('does not emit when disconnected, recipient is empty, or XMPP operation is missing', async () => {
    connected = false;
    await store.send(friend, 'active', context);
    connected = true;
    await store.send('   ', 'active', context);
    xmpp.sendChatState = undefined;
    await store.send(friend, 'active', context);
    expect(sendChatState).not.toHaveBeenCalled();
  });

  it('emits paused after 1200 ms and renews the timer while composing continues', async () => {
    await store.updateDraft(friend, 'hola', context);
    expect(sendChatState).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1000);
    await store.updateDraft(friend, 'hola otra vez', context);
    expect(sendChatState).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1199);
    expect(sendChatState).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(1);
    expect(sendChatState).toHaveBeenNthCalledWith(2, expect.objectContaining({ state: 'paused' }));
    expect(vi.getTimerCount()).toBe(0);
  });

  it('cancels a pending pause on explicit activity and keeps state transitions observable', async () => {
    await store.updateDraft(friend, 'mensaje', context);
    await store.setActivity(friend, 'inactive', context);
    expect(sendChatState).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ state: 'inactive' }),
    );
    vi.advanceTimersByTime(2000);
    expect(sendChatState).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('clears timers and deduplication on session reset', async () => {
    await store.updateDraft(friend, 'mensaje', context);
    store.clear();
    vi.advanceTimersByTime(2000);
    expect(sendChatState).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await store.send(friend, 'composing', context);
    expect(sendChatState).toHaveBeenCalledTimes(2);
  });

  it('swallows transport exceptions and permits retrying the failed state', async () => {
    sendChatState.mockRejectedValueOnce(new Error('remote failure'));
    await expect(store.send(friend, 'composing', context)).resolves.toBeUndefined();
    await store.send(friend, 'composing', context);
    expect(sendChatState).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
