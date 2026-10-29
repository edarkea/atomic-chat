import { describe, expect, it } from 'vitest';
import { UnreadStore } from './unread.store';

describe('UnreadStore', () => {
  it('deduplicates incoming messages and keeps direct and MUC counters separate', () => {
    const store = new UnreadStore();
    store.recordIncoming('a@example.invalid', 'direct', 'b@example.invalid', 'm1', false, false);
    store.recordIncoming('a@example.invalid', 'direct', 'b@example.invalid', 'm1', false, false);
    store.recordIncoming(
      'a@example.invalid',
      'muc',
      'room@conference.example.invalid',
      'm1',
      false,
      false,
    );
    expect(store.total()).toBe(2);
    expect(store.counts().get('a@example.invalid|direct|b@example.invalid')).toBe(1);
    expect(store.counts().get('a@example.invalid|muc|room@conference.example.invalid')).toBe(1);
  });

  it('does not increment a visible conversation and clears only the selected conversation', () => {
    const store = new UnreadStore();
    store.recordIncoming('a@example.invalid', 'direct', 'visible@example.invalid', 'm1', true, true);
    store.recordIncoming('a@example.invalid', 'direct', 'other@example.invalid', 'm2', false, true);
    store.recordIncoming('a@example.invalid', 'direct', 'third@example.invalid', 'm3', false, true);
    store.markRead('a@example.invalid', 'direct', 'other@example.invalid');
    expect(store.total()).toBe(1);
    expect(store.counts().get('a@example.invalid|direct|third@example.invalid')).toBe(1);
  });

  it.each([
    { selected: true, focused: true, unread: false, attention: false },
    { selected: true, focused: false, unread: true, attention: true },
    { selected: false, focused: true, unread: true, attention: false },
    { selected: false, focused: false, unread: true, attention: true },
  ])(
    'applies the read and native-attention matrix for selected=$selected focused=$focused',
    ({ selected, focused, unread, attention }) => {
      const store = new UnreadStore();
      const result = store.recordIncoming(
        'a@example.invalid',
        'direct',
        'b@example.invalid',
        `${selected}-${focused}`,
        selected,
        focused,
      );
      expect(result.unreadIncremented).toBe(unread);
      expect(result.attentionRequested).toBe(attention);
      expect(store.total()).toBe(unread ? 1 : 0);
    },
  );

  it('keeps other conversation counters when the focused conversation is acknowledged', () => {
    const store = new UnreadStore();
    store.recordIncoming('a@example.invalid', 'direct', 'a@example.invalid', 'm-a', false, true);
    store.recordIncoming('a@example.invalid', 'muc', 'room@example.invalid', 'm-room', false, true);
    store.markRead('a@example.invalid', 'direct', 'a@example.invalid');
    expect(store.counts().get('a@example.invalid|muc|room@example.invalid')).toBe(1);
    expect(store.total()).toBe(1);
  });
});
