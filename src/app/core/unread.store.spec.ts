import { describe, expect, it } from 'vitest';
import { UnreadStore } from './unread.store';

describe('UnreadStore', () => {
  it('deduplicates incoming messages and keeps direct and MUC counters separate', () => {
    const store = new UnreadStore();
    store.recordIncoming('a@example.invalid', 'direct', 'b@example.invalid', 'm1', false);
    store.recordIncoming('a@example.invalid', 'direct', 'b@example.invalid', 'm1', false);
    store.recordIncoming('a@example.invalid', 'muc', 'room@conference.example.invalid', 'm1', false);
    expect(store.total()).toBe(2);
    expect(store.counts().get('a@example.invalid|direct|b@example.invalid')).toBe(1);
    expect(store.counts().get('a@example.invalid|muc|room@conference.example.invalid')).toBe(1);
  });

  it('does not increment a visible conversation and clears only the selected conversation', () => {
    const store = new UnreadStore();
    store.recordIncoming('a@example.invalid', 'direct', 'visible@example.invalid', 'm1', true);
    store.recordIncoming('a@example.invalid', 'direct', 'other@example.invalid', 'm2', false);
    store.recordIncoming('a@example.invalid', 'direct', 'third@example.invalid', 'm3', false);
    store.markRead('a@example.invalid', 'direct', 'other@example.invalid');
    expect(store.total()).toBe(1);
    expect(store.counts().get('a@example.invalid|direct|third@example.invalid')).toBe(1);
  });
});
