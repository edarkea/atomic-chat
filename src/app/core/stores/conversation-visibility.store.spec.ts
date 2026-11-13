import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConversationVisibilityStore } from './conversation-visibility.store';

describe('ConversationVisibilityStore', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [{ provide: DOCUMENT, useValue: document }],
    });
  });

  const createStore = (): ConversationVisibilityStore =>
    TestBed.runInInjectionContext(() => new ConversationVisibilityStore());

  it('keeps hidden identities isolated by account and persists reopening data', () => {
    const first = createStore();
    first.setAccount('A@example.invalid');
    first.hide('A@example.invalid', 'direct', 'Contact@example.invalid/resource');
    first.hide('A@example.invalid', 'muc', 'room@example.invalid/nick');

    expect(first.isHidden('a@example.invalid', 'direct', 'contact@example.invalid')).toBe(true);
    expect(first.isHidden('b@example.invalid', 'direct', 'contact@example.invalid')).toBe(false);

    const second = createStore();
    second.setAccount('a@example.invalid');
    expect(second.isHidden('a@example.invalid', 'direct', 'contact@example.invalid')).toBe(true);
    expect(second.isHidden('a@example.invalid', 'muc', 'room@example.invalid')).toBe(true);

    second.reveal('a@example.invalid', 'direct', 'contact@example.invalid');
    expect(second.isHidden('a@example.invalid', 'direct', 'contact@example.invalid')).toBe(false);
    expect(second.isHidden('a@example.invalid', 'muc', 'room@example.invalid')).toBe(true);
  });

  it('clears all stored marks and rejects malformed identities', () => {
    const store = createStore();
    store.setAccount('a@example.invalid');
    store.hide('a@example.invalid', 'direct', 'valid@example.invalid');
    store.hide('a@example.invalid', 'direct', '   ');
    store.hide('a@example.invalid', 'direct', 'x'.repeat(600));
    store.clearAll();

    const restored = createStore();
    restored.setAccount('a@example.invalid');
    expect(restored.isHidden('a@example.invalid', 'direct', 'valid@example.invalid')).toBe(false);
  });
});
