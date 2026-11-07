import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MessageClassification, MessagePersistenceStatus, ReactionState } from './core/domain';
import { createOpaqueId } from './core/ids';
import { EXTERNAL_LINK_PORT, ExternalLinkPort } from './core/ports';
import { formatMessageDate, formatMessageDateTime, formatMessageTime } from './message-date-time';
import { EmojiPickerComponent } from './emoji-picker.component';

export type MessageContentSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'link'; readonly value: string; readonly href: string };

const LINK_PATTERN = /https?:\/\/[^\s<>"'`]+/giu;
const EMOJI_TOKEN_PATTERN = /(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|(?:\p{Emoji_Presentation}(?:\uFE0F)?|\p{Extended_Pictographic}\uFE0F)(?:\p{Emoji_Modifier})?(?:\u200D(?:\p{Emoji_Presentation}(?:\uFE0F)?|\p{Extended_Pictographic}\uFE0F)(?:\p{Emoji_Modifier})?)*)/gu;

/** Returns the number of emoji grapheme-like tokens when no other content is present. */
export function emojiOnlyCount(value: string): number {
  const normalized = value.trim().replace(/\s/gu, '');
  if (!normalized) return 0;
  const tokens = normalized.match(EMOJI_TOKEN_PATTERN);
  return tokens && tokens.join('') === normalized ? tokens.length : 0;
}

export function messageContentSegments(value: string): ReadonlyArray<MessageContentSegment> {
  const segments: MessageContentSegment[] = [];
  let cursor = 0;
  for (const match of value.matchAll(LINK_PATTERN)) {
    const raw = match[0];
    const start = match.index ?? cursor;
    let candidate = raw;
    while (/[.,!?;:]+$/u.test(candidate)) candidate = candidate.slice(0, -1);
    while (candidate.endsWith(')') &&
      (candidate.match(/\(/gu)?.length ?? 0) < (candidate.match(/\)/gu)?.length ?? 0))
      candidate = candidate.slice(0, -1);
    if (!candidate || start < cursor) continue;
    if (start > cursor) segments.push({ kind: 'text', value: value.slice(cursor, start) });
    try {
      const url = new URL(candidate);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname) throw new Error('invalid');
      segments.push({ kind: 'link', value: candidate, href: url.href });
      cursor = start + candidate.length;
    } catch {
      segments.push({ kind: 'text', value: raw });
      cursor = start + raw.length;
    }
  }
  if (cursor < value.length) segments.push({ kind: 'text', value: value.slice(cursor) });
  return segments.length ? segments : [{ kind: 'text', value }];
}

@Component({
  selector: 'app-message-item',
  templateUrl: './message-item.component.html',
  styleUrls: ['./message-item.component.scss'],
  imports: [EmojiPickerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageItemComponent {
  readonly sender = input.required<string>();
  readonly body = input.required<string>();
  readonly outgoing = input.required<boolean>();
  readonly classification = input<MessageClassification>();
  readonly persistenceStatus = input<MessagePersistenceStatus>();
  readonly createdAt = input<string>();
  readonly receivedLocally = input(false);
  readonly showSender = input(true);
  readonly showTime = input(true);
  readonly timestampLabel = input<string>();
  readonly groupPosition = input<'single' | 'first' | 'middle' | 'last'>('single');
  readonly messageId = input('');
  readonly replyTo = input<{ readonly authorJid: string; readonly quote?: string }>();
  readonly replyTargetId = input('');
  readonly reactions = input<ReactionState>();
  readonly ownReactionEmojis = input<ReadonlyArray<string>>([]);
  readonly replyRequested = output<string>();
  readonly replyNavigation = output<string>();
  readonly reactionChanged = output<ReadonlyArray<string>>();
  protected readonly reactionOpen = signal(false);
  protected readonly contentSegments = computed(() => messageContentSegments(this.body()));
  protected readonly emojiCount = computed(() => emojiOnlyCount(this.body()));
  private readonly externalLinks = inject<ExternalLinkPort>(EXTERNAL_LINK_PORT, { optional: true });
  protected time(value: string | undefined): string { return formatMessageTime(value); }
  protected date(value: string | undefined): string { return formatMessageDate(value); }
  protected fullDate(value: string | undefined): string { return formatMessageDateTime(value); }
  protected accessibleDate(value: string | undefined, receivedLocally: boolean): string {
    return `${receivedLocally ? 'Hora local de recepción' : 'Hora local'}: ${this.fullDate(value)}`;
  }
  protected openLink(event: MouseEvent, href: string): void {
    event.preventDefault();
    if (!this.externalLinks || typeof window === 'undefined') return;
    const confirmed = window.confirm(
      `Este enlace se abrirá en el navegador predeterminado de tu sistema operativo:\n\n${href}\n\n¿Deseas continuar?`,
    );
    if (!confirmed) return;
    void this.externalLinks.open({ version: 1, requestId: createOpaqueId('external-link'), url: href });
  }
  protected toggleReactionPicker(): void {
    if (!this.messageId()) return;
    this.reactionOpen.update((open) => !open);
  }
  protected chooseReaction(emoji: string): void {
    const current = new Set(this.ownReactionEmojis());
    if (current.has(emoji)) current.delete(emoji);
    else current.add(emoji);
    this.reactionChanged.emit([...current]);
  }
  protected closeReactionPicker(): void { this.reactionOpen.set(false); }
}
