import { formatMessageDate, formatMessageTime, messageDayKey } from './message-date-time';

export const MESSAGE_GROUP_MAX_GAP_MS = 20_000;

export type MessageGroupPosition = 'single' | 'first' | 'middle' | 'last';

export interface MessageGroupingMetadata {
  readonly senderKey: string;
  readonly conversationKey: string;
  readonly createdAt: string;
  readonly classification?: string;
  readonly groupingContext?: string;
}

export interface MessageGroup<T> {
  readonly id: string;
  readonly items: ReadonlyArray<T>;
  readonly firstAt: string;
  readonly lastAt: string;
}

export interface GroupedMessageDisplayItem<T> {
  readonly item: T;
  readonly groupId: string;
  readonly position: MessageGroupPosition;
  readonly showHeader: boolean;
  readonly timestampLabel?: string;
  readonly daySeparator: boolean;
}

function timestamp(value: string): number | undefined {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function canJoin(previous: MessageGroupingMetadata, next: MessageGroupingMetadata): boolean {
  if (previous.classification === 'broadcast' || next.classification === 'broadcast') return false;
  if (previous.senderKey !== next.senderKey || previous.conversationKey !== next.conversationKey)
    return false;
  if (previous.classification !== next.classification) return false;
  if (
    previous.groupingContext !== next.groupingContext &&
    (previous.groupingContext || next.groupingContext)
  )
    return false;
  if (messageDayKey(previous.createdAt) !== messageDayKey(next.createdAt)) return false;
  const previousTime = timestamp(previous.createdAt);
  const nextTime = timestamp(next.createdAt);
  return (
    previousTime !== undefined &&
    nextTime !== undefined &&
    nextTime >= previousTime &&
    nextTime - previousTime <= MESSAGE_GROUP_MAX_GAP_MS
  );
}

export function groupConsecutiveMessages<T>(
  items: ReadonlyArray<T>,
  getMetadata: (item: T) => MessageGroupingMetadata | undefined,
  getId: (item: T) => string,
  getSortAt: (item: T) => string,
): ReadonlyArray<MessageGroup<T>> {
  const groups: MessageGroup<T>[] = [];
  let current: T[] = [];
  let firstMetadata: MessageGroupingMetadata | undefined;
  let previousMetadata: MessageGroupingMetadata | undefined;

  const flush = (): void => {
    if (!current.length) return;
    const last = current[current.length - 1];
    groups.push({
      id: `message-group:${getId(current[0])}`,
      items: current,
      firstAt: firstMetadata?.createdAt || getSortAt(current[0]),
      lastAt: previousMetadata?.createdAt || getSortAt(last),
    });
    current = [];
    firstMetadata = undefined;
    previousMetadata = undefined;
  };

  for (const item of items) {
    const metadata = getMetadata(item);
    if (current.length && metadata && previousMetadata && canJoin(previousMetadata, metadata)) {
      current.push(item);
      previousMetadata = metadata;
      continue;
    }
    flush();
    current = [item];
    firstMetadata = metadata;
    previousMetadata = metadata;
  }
  flush();
  return groups;
}

export function formatMessageGroupTimestamp(firstAt: string, lastAt: string): string {
  const firstTime = formatMessageTime(firstAt);
  const lastTime = formatMessageTime(lastAt);
  const range = firstTime === lastTime ? firstTime : `${firstTime}–${lastTime}`;
  return `${range} · ${formatMessageDate(firstAt)}`;
}

export function groupMessagesForDisplay<T>(
  items: ReadonlyArray<T>,
  getMetadata: (item: T) => MessageGroupingMetadata | undefined,
  getId: (item: T) => string,
  getSortAt: (item: T) => string,
): ReadonlyArray<GroupedMessageDisplayItem<T>> {
  const groups = groupConsecutiveMessages(items, getMetadata, getId, getSortAt);
  const display: GroupedMessageDisplayItem<T>[] = [];
  let previousDay = '';
  for (const group of groups) {
    group.items.forEach((item, index) => {
      const position: MessageGroupPosition =
        group.items.length === 1
          ? 'single'
          : index === 0
            ? 'first'
            : index === group.items.length - 1
              ? 'last'
              : 'middle';
      const day = messageDayKey(getSortAt(item));
      display.push({
        item,
        groupId: group.id,
        position,
        showHeader: index === 0,
        timestampLabel:
          index === 0 ? formatMessageGroupTimestamp(group.firstAt, group.lastAt) : undefined,
        daySeparator: day !== previousDay,
      });
      previousDay = day;
    });
  }
  return display;
}
