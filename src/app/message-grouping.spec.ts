import { MESSAGE_GROUP_MAX_GAP_MS, groupConsecutiveMessages, groupMessagesForDisplay } from './message-grouping';

interface TestMessage {
  readonly id: string;
  readonly createdAt: string;
  readonly sender: string;
  readonly conversation: string;
  readonly classification?: string;
  readonly renderable?: boolean;
}

const metadata = (item: TestMessage) =>
  item.renderable === false
    ? undefined
    : {
        senderKey: item.sender,
        conversationKey: item.conversation,
        createdAt: item.createdAt,
        classification: item.classification,
      };

const id = (item: TestMessage): string => item.id;
const sortAt = (item: TestMessage): string => item.createdAt;
const message = (idValue: string, createdAt: string, sender = 'alice', classification?: string): TestMessage => ({
  id: idValue,
  createdAt,
  sender,
  conversation: 'chat@example.test',
  classification,
});

describe('message grouping', () => {
  it('groups consecutive messages from the same sender within two minutes', () => {
    const messages = Array.from({ length: 5 }, (_, index) =>
      message(`m${index}`, `2026-06-11T14:20:${String(index * 4).padStart(2, '0')}Z`),
    );
    const groups = groupConsecutiveMessages(messages, metadata, id, sortAt);
    expect(groups).toHaveLength(1);
    expect(groups[0].items).toEqual(messages);
  });

  it('starts a new group after the maximum gap', () => {
    const groups = groupConsecutiveMessages(
      [message('a', '2026-06-11T14:20:00Z'), message('b', '2026-06-11T14:20:21Z')],
      metadata,
      id,
      sortAt,
    );
    expect(groups.map((group) => group.items)).toHaveLength(2);
    expect(MESSAGE_GROUP_MAX_GAP_MS).toBe(20_000);
  });

  it('does not group sender, day, classification or non-renderable boundaries', () => {
    const messages = [
      message('a', '2026-06-11T23:59:00-05:00'),
      message('b', '2026-06-12T00:00:00-05:00'),
      message('c', '2026-06-12T00:01:00-05:00', 'bob'),
      message('d', '2026-06-12T00:02:00-05:00', 'bob', 'broadcast'),
      { ...message('e', '2026-06-12T00:03:00-05:00', 'bob'), renderable: false },
      message('f', '2026-06-12T00:04:00-05:00', 'bob'),
    ];
    const groups = groupConsecutiveMessages(messages, metadata, id, sortAt);
    expect(groups.map((group) => group.items.map((item) => item.id))).toEqual([
      ['a'],
      ['b'],
      ['c'],
      ['d'],
      ['e'],
      ['f'],
    ]);
  });

  it('preserves item identity and exposes compact display positions', () => {
    const messages = [message('a', '2026-06-11T14:20:00Z'), message('b', '2026-06-11T14:20:10Z'), message('c', '2026-06-11T14:20:20Z')];
    const display = groupMessagesForDisplay(messages, metadata, id, sortAt);
    expect(display.map((entry) => entry.position)).toEqual(['first', 'middle', 'last']);
    expect(display[0].showHeader).toBe(true);
    expect(display[1].showHeader).toBe(false);
    expect(display[0].timestampLabel).toMatch(/20/);
    expect(display.map((entry) => entry.item)).toEqual(messages);
  });
});
