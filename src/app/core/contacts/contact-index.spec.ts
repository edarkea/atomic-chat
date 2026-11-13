import { describe, expect, it } from 'vitest';
import type { Contact } from '../domain';
import { contactForConversationSummary, indexContactsByBareJid } from './contact-index';

function contact(jid: string, name: string): Contact {
  return { jid, name, groups: ['team'], source: 'roster' };
}

describe('contact indexing for workspace conversations', () => {
  it('normalizes bare JIDs with resource and case variants', () => {
    const item = contact('Lara@Example.invalid/desktop', 'Lara');
    const index = indexContactsByBareJid([item]);

    expect(index.get('lara@example.invalid')).toBe(item);
    expect(
      contactForConversationSummary(
        { jid: 'LARA@EXAMPLE.INVALID/mobile', title: 'Fallback' },
        index,
      ),
    ).toBe(item);
  });

  it('keeps the first roster item when duplicate bare JIDs occur', () => {
    const first = contact('friend@example.invalid/phone', 'First');
    const second = contact('FRIEND@example.invalid/laptop', 'Second');

    const index = indexContactsByBareJid([first, second]);
    expect(index.size).toBe(1);
    expect(
      contactForConversationSummary({ jid: 'friend@example.invalid', title: 'Other' }, index),
    ).toBe(first);
  });

  it('preserves the original JID, title and local source for unknown contacts', () => {
    const unknown = { jid: 'Unknown@Example.invalid/mobile', title: 'My conversation' };
    const result = contactForConversationSummary(unknown, indexContactsByBareJid([]));

    expect(result).toEqual({
      jid: unknown.jid,
      name: unknown.title,
      groups: [],
      source: 'conversation',
    });
  });

  it('does not mutate the input contacts or lose their object identity', () => {
    const first = contact('one@example.invalid/desktop', 'One');
    const second = contact('two@example.invalid/phone', 'Two');
    const original = [first, second];
    const snapshot = [...original];

    const index = indexContactsByBareJid(original);
    expect(original).toEqual(snapshot);
    expect(index.get('one@example.invalid')).toBe(first);
    expect(index.get('two@example.invalid')).toBe(second);
  });
});
