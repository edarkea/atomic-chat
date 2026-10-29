import { describe, expect, it } from 'vitest';
import { ActiveConversationStore } from './active-conversation.store';

describe('ActiveConversationStore', () => {
  it('normalizes account, kind and bare JID as one active identity', () => {
    const store = new ActiveConversationStore();
    store.set({ accountId: 'A@EXAMPLE.INVALID', kind: 'direct', jid: 'B@EXAMPLE.INVALID/desktop' });

    expect(store.current()).toEqual({
      accountId: 'a@example.invalid',
      kind: 'direct',
      jid: 'b@example.invalid',
    });
    expect(store.isVisible('a@example.invalid', 'direct', 'b@example.invalid/mobile')).toBe(true);
    expect(store.isVisible('a@example.invalid', 'muc', 'b@example.invalid')).toBe(false);

    store.set({ accountId: 'a@example.invalid', kind: 'muc', jid: 'room@example.invalid/nick' });
    expect(store.isVisible('a@example.invalid', 'direct', 'b@example.invalid')).toBe(false);
    expect(store.isVisible('a@example.invalid', 'muc', 'room@example.invalid')).toBe(true);
  });
});
