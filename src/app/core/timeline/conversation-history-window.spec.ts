import { describe, expect, it } from 'vitest';
import type { HistoryTimelineItem, Message } from '../domain';
import {
  applyMessageHistoryPage,
  applyTimelineHistoryPage,
  mergeInitialHistoryMessages,
  timelineTextMessages,
  upsertLiveMessage,
  type HistoryPageWindowState,
} from './conversation-history-window';

const accountId = 'a@example.invalid';
const jid = 'friend@example.invalid';

function message(
  id: string,
  clientMessageId = `client-${id}`,
  timestamp = '2026-01-01T00:00:00.000Z',
  conversationId = jid,
): Message {
  return {
    id,
    clientMessageId,
    accountId,
    conversationId,
    senderJid: jid,
    body: { kind: 'text', text: id },
    status: 'sent',
    createdAt: timestamp,
  };
}

function windowState(overrides: Partial<HistoryPageWindowState> = {}): HistoryPageWindowState {
  return {
    pages: [{ cursor: 'initial' }],
    olderCursor: 'initial',
    newerCursor: null,
    hasOlder: true,
    hasNewer: false,
    ...overrides,
  };
}

function text(id: string, sortAt = '2026-01-01T00:00:00.000Z'): HistoryTimelineItem {
  return { kind: 'text', id, sortAt, message: message(id) };
}

describe('conversation history window', () => {
  it('inserts live messages in chronological order even when events arrive out of order', () => {
    const first = message('first', 'a', '2026-01-01T00:00:01.000Z');
    const third = message('third', 'c', '2026-01-01T00:00:03.000Z');
    const second = message('second', 'b', '2026-01-01T00:00:02.000Z');

    const result = upsertLiveMessage([first, third], second);
    expect(result.map((item) => item.id)).toEqual(['first', 'second', 'third']);
    expect(result[0]).toBe(first);
    expect(result[2]).toBe(third);
  });

  it('replaces a message with the same server ID while updating its timestamp', () => {
    const existing = message('server-one', 'old-client', '2026-01-01T00:00:01.000Z');
    const other = message('other', 'other-client', '2026-01-01T00:00:02.000Z');
    const revised = message('server-one', 'new-client', '2026-01-01T00:00:04.000Z');

    const result = upsertLiveMessage([existing, other], revised);
    expect(result).toEqual([other, revised]);
    expect(result[1]).toBe(revised);
  });

  it('replaces a pending message using its client ID even when the server ID changes', () => {
    const pending = message('local-id', 'shared-client', '2026-01-01T00:00:01.000Z');
    const receipt = message('remote-id', 'shared-client', '2026-01-01T00:00:03.000Z');

    expect(upsertLiveMessage([pending], receipt)).toEqual([receipt]);
  });

  it('removes every match by server or client ID before inserting the new message', () => {
    const byServer = message('same-server', 'client-a');
    const byClient = message('other-server', 'same-client');
    const unrelated = message('unrelated', 'client-c');
    const incoming = message('same-server', 'same-client');

    const result = upsertLiveMessage([byServer, byClient, unrelated], incoming);
    expect(result).toEqual([unrelated, incoming]);
  });

  it('puts an incoming event after existing peers with equal timestamps', () => {
    const first = message('first');
    const second = message('second');
    const third = message('third');

    expect(upsertLiveMessage([first, second], third)).toEqual([first, second, third]);
  });

  it('maintains a window of the newest 200 items without mutating previous entries', () => {
    const original = Array.from({ length: 200 }, (_, index) =>
      message(String(index), `client-${index}`, new Date(1700000000000 + index).toISOString()),
    );
    const latest = message('latest', 'client-latest', new Date(1700000000200).toISOString());
    const snapshot = [...original];
    const result = upsertLiveMessage(original, latest);

    expect(result).toHaveLength(200);
    expect(result[0]).toBe(original[1]);
    expect(result.at(-1)).toBe(latest);
    expect(original).toEqual(snapshot);
    expect(original[0].id).toBe('0');

    const oldMessage = message('older', 'client-older', new Date(1699999999999).toISOString());
    const bounded = upsertLiveMessage(result, oldMessage);
    expect(bounded.map((item) => item.id)).toEqual(result.map((item) => item.id));
  });

  it('merges initial history with matching live messages only, sorting chronologically', () => {
    const historical = [message('older', 'persisted', '2026-01-01T00:00:00.000Z')];
    const live = [
      message('other', 'unrelated', '2026-01-02T00:00:00.000Z', 'else@example.invalid'),
      message('echo', 'persisted', '2026-01-01T01:00:00.000Z'),
      message('live', 'live-client', '2026-01-02T00:00:00.000Z', 'FRIEND@example.invalid/desktop'),
    ];
    expect(mergeInitialHistoryMessages(historical, live, jid).map((item) => item.id)).toEqual([
      'older',
      'live',
    ]);
  });

  it('keeps the initial history window bounded to 200 messages', () => {
    const historical = Array.from({ length: 250 }, (_, index) =>
      message(String(index), undefined, new Date(1700000000000 + index).toISOString()),
    );
    const merged = mergeInitialHistoryMessages(historical, [], jid);
    expect(merged).toHaveLength(200);
    expect(merged[0].id).toBe('50');
    expect(merged.at(-1)?.id).toBe('249');
  });

  it('deduplicates by message ID or client ID, including rejected intermediary entries', () => {
    const previous = [message('a', 'client-a')];
    const incoming = [message('a', 'client-b'), message('z', 'client-b'), message('b', 'client-c')];
    const next = applyMessageHistoryPage(
      previous,
      incoming,
      windowState(),
      'older',
      'page-one',
      true,
    );
    expect(next?.items.map((item) => item.id)).toEqual(['a', 'b']);
    expect(next?.window.olderCursor).toBe('page-one');
    expect(next?.window.hasNewer).toBe(false);
  });

  it('advances a four-cursor window backwards and forwards without losing boundaries', () => {
    let items = [message('99', 'c-99', new Date(1700000000099).toISOString())];
    let state = windowState();
    for (let step = 0; step < 3; step += 1) {
      const index = 98 - step;
      const next = applyMessageHistoryPage(
        items,
        [message(String(index), `c-${index}`, new Date(1700000000000 + index).toISOString())],
        state,
        'older',
        `older-${step}`,
        true,
      );
      expect(next).not.toBeNull();
      items = next!.items;
      state = next!.window;
    }
    expect(state.pages.map((page) => page.cursor)).toEqual([
      'older-2',
      'older-1',
      'older-0',
      'initial',
    ]);
    expect(state.hasNewer).toBe(true);
    expect(state.newerCursor).toBe('initial');

    const forward = applyMessageHistoryPage(
      items,
      [message('100', 'c-100', new Date(1700000000100).toISOString())],
      state,
      'newer',
      'newer-1',
      false,
    );
    expect(forward?.window.pages.map((page) => page.cursor)).toEqual([
      'older-1',
      'older-0',
      'initial',
      'newer-1',
    ]);
    expect(forward?.window.hasOlder).toBe(true);
    expect(forward?.window.hasNewer).toBe(false);
    expect(forward?.window.olderCursor).toBe('older-1');
    expect(forward?.items.at(-1)?.id).toBe('100');
  });

  it('keeps cursors unchanged for duplicate-only pages or absent nextCursor', () => {
    const previous = [message('a')];
    const state = windowState();
    expect(
      applyMessageHistoryPage(previous, [message('a')], state, 'older', 'new', true),
    ).toBeNull();
    expect(
      applyMessageHistoryPage(previous, [message('b')], state, 'older', null, true),
    ).toBeNull();
    expect(state.olderCursor).toBe('initial');
    expect(state.pages).toHaveLength(1);
  });

  it('keeps mixed timeline media while deduplicating and sorting by sortAt and id', () => {
    const image: HistoryTimelineItem = {
      kind: 'image',
      id: 'image-1',
      sortAt: '2026-01-01T00:00:03.000Z',
      media: {
        mediaId: 'm1',
        transferId: 't1',
        accountId,
        conversationId: jid,
        direction: 'incoming',
        senderJid: jid,
        originalName: 'photo.png',
        mimeType: 'image/png',
        sizeBytes: '1',
        width: 1,
        height: 1,
        createdAt: '2026-01-01T00:00:03.000Z',
        availability: 'available',
      },
    };
    const next = applyTimelineHistoryPage(
      [text('t2', '2026-01-01T00:00:02.000Z')],
      [text('t2', '2026-01-01T00:00:02.000Z'), image, text('t1')],
      windowState(),
      'older',
      'next-media',
      false,
    );
    expect(next?.items.map((item) => item.id)).toEqual(['t1', 't2', 'image-1']);
    expect(next?.window.hasOlder).toBe(false);
    expect(timelineTextMessages(next!.items).map((item) => item.id)).toEqual(['t1', 't2']);
  });

  it('enforces the 200-item limit in both paging directions', () => {
    const previous = Array.from({ length: 200 }, (_, index) =>
      message(String(index + 100), undefined, new Date(1700000000000 + index + 100).toISOString()),
    );
    const incoming = Array.from({ length: 50 }, (_, index) =>
      message(String(index), undefined, new Date(1700000000000 + index).toISOString()),
    );
    const older = applyMessageHistoryPage(
      previous,
      incoming,
      windowState(),
      'older',
      'older-cursor',
      false,
    );
    expect(older?.items).toHaveLength(200);
    expect(older?.items[0].id).toBe('0');
    expect(older?.items.at(-1)?.id).toBe('249');

    const newer = applyMessageHistoryPage(
      older!.items,
      [message('300', 'client-300', new Date(1700000000300).toISOString())],
      older!.window,
      'newer',
      'newer-cursor',
      false,
    );
    expect(newer?.items).toHaveLength(200);
    expect(newer?.items.at(-1)?.id).toBe('300');
  });
});
