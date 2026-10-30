import { describe, expect, it } from 'vitest';
import { ConversationVisibilityStore } from './conversation-visibility.store';

describe('ConversationVisibilityStore', () => {
  it('keeps hidden identities isolated by account and persists reopening data', () => {
    const first = new ConversationVisibilityStore(document);
    first.setAccount('A@example.invalid');
    first.hide('A@example.invalid', 'direct', 'Contact@example.invalid/resource');
    first.hide('A@example.invalid', 'muc', 'room@example.invalid/nick');

    expect(first.isHidden('a@example.invalid', 'direct', 'contact@example.invalid')).toBe(true);
    expect(first.isHidden('b@example.invalid', 'direct', 'contact@example.invalid')).toBe(false);

    const second = new ConversationVisibilityStore(document);
    second.setAccount('a@example.invalid');
    expect(second.isHidden('a@example.invalid', 'direct', 'contact@example.invalid')).toBe(true);
    expect(second.isHidden('a@example.invalid', 'muc', 'room@example.invalid')).toBe(true);

    second.reveal('a@example.invalid', 'direct', 'contact@example.invalid');
    expect(second.isHidden('a@example.invalid', 'direct', 'contact@example.invalid')).toBe(false);
    expect(second.isHidden('a@example.invalid', 'muc', 'room@example.invalid')).toBe(true);
  });

  it('clears all stored marks and rejects malformed identities', () => {
    const store = new ConversationVisibilityStore(document);
    store.setAccount('a@example.invalid');
    store.hide('a@example.invalid', 'direct', 'valid@example.invalid');
    store.hide('a@example.invalid', 'direct', '   ');
    store.hide('a@example.invalid', 'direct', 'x'.repeat(600));
    store.clearAll();

    const restored = new ConversationVisibilityStore(document);
    restored.setAccount('a@example.invalid');
    expect(restored.isHidden('a@example.invalid', 'direct', 'valid@example.invalid')).toBe(false);
  });
});
