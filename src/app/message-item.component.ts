import { ChangeDetectionStrategy, Component, computed, ElementRef, inject, input, output, signal } from '@angular/core';
import { MessageClassification, MessagePersistenceStatus, ReactionActor, ReactionState } from './core/domain';
import { createOpaqueId } from './core/ids';
import { EXTERNAL_LINK_PORT, ExternalLinkPort } from './core/ports';
import { formatMessageDate, formatMessageDateTime, formatMessageTime } from './message-date-time';
import { EmojiPickerComponent } from './emoji-picker.component';

export type MessageContentSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'link'; readonly value: string; readonly href: string };

const LINK_PATTERN = /https?:\/\/[^\s<>"'`]+/giu;
export const QUICK_REACTION_EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'] as const;
export type MessageOverlay = 'quick' | 'menu' | 'picker';
const EMOJI_TOKEN_PATTERN = /(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|(?:\p{Emoji_Presentation}(?:\uFE0F)?|\p{Extended_Pictographic}\uFE0F)(?:\p{Emoji_Modifier})?(?:\u200D(?:\p{Emoji_Presentation}(?:\uFE0F)?|\p{Extended_Pictographic}\uFE0F)(?:\p{Emoji_Modifier})?)*)/gu;

export function isProtectedMessageOverlayPointer(event: PointerEvent, activeMessageId: string): boolean {
  let insideActiveMessage = false;
  let insideOverlaySurface = false;
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement)) continue;
    if (target.tagName.toLowerCase() === 'app-message-item' && target.dataset['messageId'] === activeMessageId)
      insideActiveMessage = true;
    if (target.hasAttribute('data-overlay-panel') || target.hasAttribute('data-overlay-trigger'))
      insideOverlaySurface = true;
  }
  return insideActiveMessage && insideOverlaySurface;
}

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
  protected readonly quickReactionEmojis = QUICK_REACTION_EMOJIS;
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
  readonly replyAuthor = input('');
  readonly replyTime = input('');
  readonly replyText = input('');
  readonly replyTargetId = input('');
  readonly reactions = input<ReactionState>();
  readonly ownReactionEmojis = input<ReadonlyArray<string>>([]);
  readonly reactionActorLabel = input<(actor: ReactionActor) => string>((actor) => actor.identifiable ? actor.label : 'Participante no verificable');
  readonly activeOverlay = input<MessageOverlay>();
  readonly replyRequested = output<string>();
  readonly replyNavigation = output<string>();
  readonly reactionChanged = output<ReadonlyArray<string>>();
  readonly overlayRequested = output<MessageOverlay | undefined>();
  protected readonly reactionOpen = computed(() => this.activeOverlay() === 'picker');
  protected readonly actionMenuOpen = computed(() => this.activeOverlay() === 'menu');
  protected readonly quickReactionOpen = computed(() => this.activeOverlay() === 'quick');
  protected readonly overlayPlacement = signal<'above' | 'below'>('above');
  protected readonly tooltipEmoji = signal<string | undefined>(undefined);
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
    this.requestOverlay(this.quickReactionOpen() ? undefined : 'quick');
  }
  protected toggleActionMenu(): void {
    if (!this.messageId()) return;
    this.requestOverlay(this.actionMenuOpen() ? undefined : 'menu');
  }
  protected openFullPicker(): void { this.requestOverlay('picker'); }
  protected toggleQuickReaction(emoji: string): void {
    this.chooseReaction(emoji);
  }
  protected chooseReaction(emoji: string): void {
    this.toggleReaction(emoji);
  }
  protected toggleReaction(emoji: string): void {
    const current = new Set(this.ownReactionEmojis());
    if (current.has(emoji)) current.delete(emoji);
    else current.add(emoji);
    this.reactionChanged.emit([...current]);
  }
  protected isOwnReaction(emoji: string): boolean { return this.ownReactionEmojis().includes(emoji); }
  protected showReactionTooltip(emoji: string): void { this.tooltipEmoji.set(emoji); }
  protected hideReactionTooltip(): void { this.tooltipEmoji.set(undefined); }
  protected reactionTooltipId(emoji: string): string {
    return `reaction-tooltip-${this.messageId().replace(/[^a-zA-Z0-9_-]/gu, '_')}-${encodeURIComponent(emoji)}`;
  }
  protected reactionTooltipText(reaction: ReactionState['reactions'][number]): string {
    const labels = reaction.actors.slice(0, 3).map((actor) => this.reactionActorLabel()(actor));
    if (labels.length === 0) return `${reaction.emoji} Participante`;
    if (reaction.actors.length === 1) return `${reaction.emoji} ${labels[0]}`;
    if (reaction.actors.length === 2) return `${reaction.emoji} ${labels[0]} y ${labels[1]}`;
    return `${reaction.emoji} ${labels[0]}, ${labels[1]} y ${reaction.actors.length - 2} más`;
  }
  protected closeReactionPicker(): void { this.requestOverlay(undefined); }
  protected closeOverlays(): void {
    this.hideReactionTooltip();
    this.requestOverlay(undefined);
  }
  protected requestOverlay(overlay: MessageOverlay | undefined): void {
    if (overlay && !this.messageId()) return;
    if (overlay) {
      const element = this.host.nativeElement.querySelector('.message') as HTMLElement | null;
      const bounds = element?.getBoundingClientRect();
      this.overlayPlacement.set(bounds && bounds.top < 190 ? 'below' : 'above');
    }
    this.overlayRequested.emit(overlay);
  }
  private readonly host = inject(ElementRef<HTMLElement>);
}
