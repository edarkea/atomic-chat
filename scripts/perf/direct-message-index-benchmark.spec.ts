import { describe, expect, it } from 'vitest';
import type { Message, MessageReference } from '../../src/app/core/domain';
import { DirectMessageIndex } from '../../src/app/core/direct-message-index';
import { matchesDirectMessageReference } from '../../src/app/core/message-reference';

const MESSAGE_COUNT = 10_000;
const LOOKUP_COUNT = 2_000;

function messages(): ReadonlyArray<Message> {
  return Array.from({ length: MESSAGE_COUNT }, (_, index) => ({
    id: `server-${index}`,
    accountId: 'me@example.invalid',
    conversationId: 'friend@example.invalid',
    clientMessageId: `client-${index}`,
    senderJid: index % 2 === 0 ? 'friend@example.invalid' : 'me@example.invalid',
    body: { kind: 'text', text: `message-${index}` },
    status: 'sent',
    createdAt: `2026-11-11T12:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
  }));
}

function reference(index: number): MessageReference {
  return {
    messageId: `server-${index}`,
    stanzaIds: [],
    authorJid: index % 2 === 0 ? 'friend@example.invalid' : 'me@example.invalid',
  };
}

function linearResolve(
  timeline: ReadonlyArray<Message>,
  target: MessageReference,
): Message | undefined {
  return timeline.find((message) =>
    matchesDirectMessageReference(message, target, 'me@example.invalid', 'friend@example.invalid'),
  );
}

function elapsed(operation: () => void): number {
  const started = performance.now();
  operation();
  return performance.now() - started;
}

describe('direct message resolution performance', () => {
  it('compares the compatibility scan with the indexed resolver', () => {
    const timeline = messages();
    const targets = Array.from({ length: LOOKUP_COUNT }, (_, index) =>
      reference(MESSAGE_COUNT - 1 - (index % MESSAGE_COUNT)),
    );
    let linearChecksum = 0;
    let indexedChecksum = 0;
    const index = new DirectMessageIndex();

    linearResolve(timeline, targets[0]);
    index.findByReference(timeline, targets[0], 'me@example.invalid', 'friend@example.invalid');

    const linearMs = elapsed(() => {
      for (const target of targets)
        linearChecksum += linearResolve(timeline, target)?.id.length || 0;
    });
    const indexedMs = elapsed(() => {
      for (const target of targets)
        indexedChecksum +=
          index.findByReference(timeline, target, 'me@example.invalid', 'friend@example.invalid')
            ?.id.length || 0;
    });

    expect(indexedChecksum).toBe(linearChecksum);
    console.log(
      JSON.stringify({
        scenario: 'direct-message-reference-resolution',
        messageCount: MESSAGE_COUNT,
        lookupCount: LOOKUP_COUNT,
        linearMs: Number(linearMs.toFixed(3)),
        indexedMs: Number(indexedMs.toFixed(3)),
        speedup: Number((linearMs / indexedMs).toFixed(2)),
      }),
    );
  });
});
