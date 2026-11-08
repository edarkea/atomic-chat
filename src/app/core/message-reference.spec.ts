import { describe, expect, it } from 'vitest';
import { Message, MessageReference, RoomMessage } from './domain';
import { matchesDirectMessageReference, matchesRoomMessageReference } from './message-reference';

const directMessage = (overrides: Partial<Message> = {}): Message => ({
  id: 'local-a',
  accountId: 'me@example.invalid',
  conversationId: 'friend@example.invalid',
  clientMessageId: 'client-a',
  senderJid: 'friend@example.invalid',
  body: { kind: 'text', text: 'A' },
  status: 'sent',
  createdAt: '2026-11-07T12:00:00.000Z',
  ...overrides,
});

const reference = (overrides: Partial<MessageReference> = {}): MessageReference => ({
  stanzaIds: [],
  authorJid: 'friend@example.invalid',
  ...overrides,
});

const roomMessage = (overrides: Partial<RoomMessage> = {}): RoomMessage => ({
  id: 'room-local-a',
  accountId: 'me@example.invalid',
  roomJid: 'room@example.invalid',
  occupantJid: 'room@example.invalid/barbara',
  body: { kind: 'text', text: 'A' },
  receivedAt: '2026-11-07T12:00:00.000Z',
  source: 'live',
  sessionGeneration: 1,
  ...overrides,
});

describe('message reference matching', () => {
  it('does not match two messages when every optional identifier is absent', () => {
    expect(matchesDirectMessageReference(directMessage(), reference(), 'me@example.invalid', 'friend@example.invalid')).toBe(false);
  });

  it('does not replace message B with message A when identifiers differ', () => {
    const messageB = directMessage({ id: 'local-b', clientMessageId: 'client-b', messageId: 'wire-b' });
    expect(matchesDirectMessageReference(messageB, reference({ messageId: 'wire-a' }), 'me@example.invalid', 'friend@example.invalid')).toBe(false);
  });

  it('matches a selected own or received direct message only by present identifiers and author', () => {
    const own = directMessage({ id: 'own', clientMessageId: 'own-client', senderJid: 'me@example.invalid', originId: 'own-origin' });
    expect(matchesDirectMessageReference(own, reference({ originId: 'own-origin', authorJid: 'me@example.invalid' }), 'me@example.invalid', 'friend@example.invalid')).toBe(true);
    expect(matchesDirectMessageReference(directMessage({ messageId: 'received-wire' }), reference({ messageId: 'received-wire' }), 'me@example.invalid', 'friend@example.invalid')).toBe(true);
  });

  it('uses the room stanza-id and by for MUC replies', () => {
    const message = roomMessage({ stanzaIds: [{ id: 'room-stanza-a', by: 'room@example.invalid' }] });
    expect(matchesRoomMessageReference(message, reference({ stanzaIds: [{ id: 'room-stanza-a', by: 'room@example.invalid' }], authorJid: 'room@example.invalid/barbara' }), 'me@example.invalid', 'room@example.invalid')).toBe(true);
    expect(matchesRoomMessageReference(message, reference({ stanzaIds: [{ id: 'room-stanza-a', by: 'other.example.invalid' }], authorJid: 'room@example.invalid/barbara' }), 'me@example.invalid', 'room@example.invalid')).toBe(false);
  });
});
