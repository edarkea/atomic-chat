import { describe, expect, it } from 'vitest';
import type { Message } from '../domain';
import { DirectMessageIndex } from './direct-message-index';

function message(overrides: Partial<Message> = {}): Message {
  return {
    id: 'server-1',
    accountId: 'me@example.invalid',
    conversationId: 'friend@example.invalid',
    clientMessageId: 'client-1',
    senderJid: 'friend@example.invalid',
    body: { kind: 'text', text: 'hello' },
    status: 'sent',
    createdAt: '2026-11-11T12:00:00.000Z',
    ...overrides,
  };
}

describe('DirectMessageIndex', () => {
  it('resolves all direct message identities and preserves the first duplicate', () => {
    const first = message({ id: 'duplicate' });
    const second = message({ id: 'duplicate', clientMessageId: 'client-2' });
    const index = new DirectMessageIndex();

    expect(index.findByTargetId([first, second], 'duplicate')).toBe(first);
    expect(index.findByTargetId([first, second], 'client-2')).toBe(second);
  });

  it('resolves stanza identities only when the stanza has an issuer', () => {
    const withoutIssuer = message({ stanzaIds: [{ id: 'stanza-1', by: '' }] });
    const withIssuer = message({
      id: 'server-2',
      stanzaIds: [{ id: 'stanza-2', by: 'example.invalid' }],
    });
    const index = new DirectMessageIndex();

    expect(index.findByTargetId([withoutIssuer], 'stanza-1')).toBeUndefined();
    expect(index.findByTargetId([withIssuer], 'stanza-2')).toBe(withIssuer);
  });

  it('uses indexed candidates but keeps the existing reference validation', () => {
    const target = message({
      id: 'server-3',
      conversationId: 'friend@example.invalid/resource',
      stanzaIds: [{ id: 'stanza-3', by: 'example.invalid' }],
    });
    const index = new DirectMessageIndex();

    expect(
      index.findByReference(
        [target],
        { messageId: 'server-3', stanzaIds: [], authorJid: 'other@example.invalid' },
        'me@example.invalid',
        'friend@example.invalid',
      ),
    ).toBe(target);
    expect(
      index.findByReference(
        [target],
        { messageId: 'missing', stanzaIds: [], authorJid: 'friend@example.invalid' },
        'me@example.invalid',
        'friend@example.invalid',
      ),
    ).toBeUndefined();
  });

  it('can apply author validation for presentation references', () => {
    const target = message({ senderJid: 'friend@example.invalid' });
    const index = new DirectMessageIndex();

    expect(
      index.findByReference(
        [target],
        { messageId: target.id, stanzaIds: [], authorJid: 'other@example.invalid' },
        'me@example.invalid',
        'friend@example.invalid',
        true,
      ),
    ).toBeUndefined();
  });

  it('rebuilds when the timeline collection changes', () => {
    const first = message();
    const initial = [first];
    const next = [...initial, message({ id: 'server-2' })];
    const index = new DirectMessageIndex();

    expect(index.findByTargetId(initial, 'server-1')).toBe(first);
    expect(index.findByTargetId(next, 'server-2')).toBe(next[1]);
  });
});
