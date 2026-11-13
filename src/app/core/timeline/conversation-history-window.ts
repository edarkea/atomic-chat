import type { HistoryTimelineItem, Message } from '../domain';
import { bareJid } from '../identity';

const MAX_WINDOW_ITEMS = 200;
const MAX_CURSOR_PAGES = 4;

export type HistoryDirection = 'older' | 'newer';

export interface HistoryPageWindowState {
  readonly pages: ReadonlyArray<{ readonly cursor: string }>;
  readonly olderCursor: string | null;
  readonly newerCursor: string | null;
  readonly hasOlder: boolean;
  readonly hasNewer: boolean;
}

export interface AppliedHistoryPage<T> {
  readonly items: T[];
  readonly window: HistoryPageWindowState;
}

/**
 * Reconciles the initial persisted page with live messages received during I/O.
 * Only persisted identities shadow live messages.
 */
export function mergeInitialHistoryMessages(
  historical: ReadonlyArray<Message>,
  live: ReadonlyArray<Message>,
  conversationId: string,
): Message[] {
  const ids = new Set(historical.map((message) => message.id));
  const clientIds = new Set(historical.map((message) => message.clientMessageId));
  const liveOnly = live.filter(
    (message) =>
      bareJid(message.conversationId) === conversationId &&
      !ids.has(message.id) &&
      !clientIds.has(message.clientMessageId),
  );
  return [...historical, ...liveOnly]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
    .slice(-MAX_WINDOW_ITEMS);
}

/**
 * Inserts or replaces a live message in a sorted, bounded in-memory window.
 * A match on either server ID or client ID removes the previous entry. Equal
 * timestamps place the newest event after existing peers, matching ChatFacade.
 */
export function upsertLiveMessage(previous: ReadonlyArray<Message>, message: Message): Message[] {
  const next = previous.filter(
    (item) => item.clientMessageId !== message.clientMessageId && item.id !== message.id,
  );
  let low = 0;
  let high = next.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (next[middle].createdAt.localeCompare(message.createdAt) <= 0) low = middle + 1;
    else high = middle;
  }
  next.splice(low, 0, message);
  return next.length > MAX_WINDOW_ITEMS ? next.slice(next.length - MAX_WINDOW_ITEMS) : next;
}

export function timelineTextMessages(items: ReadonlyArray<HistoryTimelineItem>): Message[] {
  return items
    .filter((item): item is Extract<HistoryTimelineItem, { kind: 'text' }> => item.kind === 'text')
    .map((item) => item.message);
}

/**
 * Matches first-match deduplication by id OR clientMessageId.
 * Register keys from discarded items too; the original findIndex scans all items.
 */
function mergeDistinctMessages(
  previous: ReadonlyArray<Message>,
  incoming: ReadonlyArray<Message>,
): Message[] {
  const ids = new Set<string>();
  const clientIds = new Set<string>();
  const unique: Message[] = [];
  for (const message of [...previous, ...incoming]) {
    const duplicate = ids.has(message.id) || clientIds.has(message.clientMessageId);
    ids.add(message.id);
    clientIds.add(message.clientMessageId);
    if (!duplicate) unique.push(message);
  }
  return unique.sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

function mergeDistinctTimelineItems(
  previous: ReadonlyArray<HistoryTimelineItem>,
  incoming: ReadonlyArray<HistoryTimelineItem>,
): HistoryTimelineItem[] {
  const ids = new Set<string>();
  const unique: HistoryTimelineItem[] = [];
  for (const item of [...previous, ...incoming]) {
    if (!ids.has(item.id)) unique.push(item);
    ids.add(item.id);
  }
  return unique.sort(
    (left, right) => left.sortAt.localeCompare(right.sortAt) || left.id.localeCompare(right.id),
  );
}

/** Returns null when the page made no progress, preserving the caller's window. */
function applyPage<T>(
  previous: ReadonlyArray<T>,
  incoming: ReadonlyArray<T>,
  state: HistoryPageWindowState,
  direction: HistoryDirection,
  nextCursor: string | null,
  hasMore: boolean,
  merge: (current: ReadonlyArray<T>, incoming: ReadonlyArray<T>) => T[],
): AppliedHistoryPage<T> | null {
  const merged = merge(previous, incoming);
  if (merged.length <= previous.length || !nextCursor) return null;

  const pages =
    direction === 'older'
      ? [{ cursor: nextCursor }, ...state.pages].slice(0, MAX_CURSOR_PAGES)
      : [...state.pages, { cursor: nextCursor }].slice(-MAX_CURSOR_PAGES);
  const full = pages.length === MAX_CURSOR_PAGES;

  return {
    items:
      direction === 'older' ? merged.slice(0, MAX_WINDOW_ITEMS) : merged.slice(-MAX_WINDOW_ITEMS),
    window: {
      pages,
      olderCursor:
        direction === 'older'
          ? pages[0]?.cursor || null
          : full
            ? pages[0]?.cursor || null
            : state.olderCursor,
      newerCursor:
        direction === 'older'
          ? full
            ? pages[pages.length - 1]?.cursor || null
            : null
          : pages[pages.length - 1]?.cursor || null,
      hasOlder: direction === 'older' ? hasMore : full || state.hasOlder,
      hasNewer: direction === 'older' ? full : hasMore,
    },
  };
}

export function applyMessageHistoryPage(
  previous: ReadonlyArray<Message>,
  incoming: ReadonlyArray<Message>,
  state: HistoryPageWindowState,
  direction: HistoryDirection,
  nextCursor: string | null,
  hasMore: boolean,
): AppliedHistoryPage<Message> | null {
  return applyPage(
    previous,
    incoming,
    state,
    direction,
    nextCursor,
    hasMore,
    mergeDistinctMessages,
  );
}

export function applyTimelineHistoryPage(
  previous: ReadonlyArray<HistoryTimelineItem>,
  incoming: ReadonlyArray<HistoryTimelineItem>,
  state: HistoryPageWindowState,
  direction: HistoryDirection,
  nextCursor: string | null,
  hasMore: boolean,
): AppliedHistoryPage<HistoryTimelineItem> | null {
  return applyPage(
    previous,
    incoming,
    state,
    direction,
    nextCursor,
    hasMore,
    mergeDistinctTimelineItems,
  );
}
