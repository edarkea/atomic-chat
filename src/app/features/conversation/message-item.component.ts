import {
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  HostListener,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import {
  MessageClassification,
  MessagePersistenceStatus,
  ReactionActor,
  ReactionState,
} from '../../core/domain';
import { createOpaqueId } from '../../core/ids';
import { EXTERNAL_LINK_PORT, ExternalLinkPort } from '../../core/ports';
import { QUICK_REACTION_EMOJIS as CATALOG_QUICK_REACTION_EMOJIS } from './emoji-catalog';
import { formatMessageDate, formatMessageDateTime, formatMessageTime } from './message-date-time';
import { EmojiPickerComponent } from './emoji-picker.component';

export type MessageContentSegment =
  | { readonly kind: 'text'; readonly value: string }
  | { readonly kind: 'link'; readonly value: string; readonly href: string };

const LINK_PATTERN = /https?:\/\/[^\s<>"'`]+/giu;
export const QUICK_REACTION_EMOJIS = CATALOG_QUICK_REACTION_EMOJIS;
export type MessageOverlay = 'quick' | 'menu' | 'picker';
const EMOJI_TOKEN_PATTERN =
  /(?:\p{Regional_Indicator}{2}|[0-9#*]\uFE0F?\u20E3|(?:\p{Emoji_Presentation}(?:\uFE0F)?|\p{Extended_Pictographic}\uFE0F)(?:\p{Emoji_Modifier})?(?:\u200D(?:\p{Emoji_Presentation}(?:\uFE0F)?|\p{Extended_Pictographic}\uFE0F)(?:\p{Emoji_Modifier})?)*)/gu;

export function isProtectedMessageOverlayPointer(
  event: PointerEvent,
  activeMessageId: string,
): boolean {
  let insideActiveMessage = false;
  let insideOverlaySurface = false;
  for (const target of event.composedPath()) {
    if (!(target instanceof HTMLElement)) continue;
    if (
      target.tagName.toLowerCase() === 'app-message-item' &&
      target.dataset['messageId'] === activeMessageId
    )
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
    while (
      candidate.endsWith(')') &&
      (candidate.match(/\(/gu)?.length ?? 0) < (candidate.match(/\)/gu)?.length ?? 0)
    )
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
  readonly reactionActorLabel = input<(actor: ReactionActor) => string>((actor) =>
    actor.identifiable ? actor.label : 'Participante no verificable',
  );
  readonly activeOverlay = input<MessageOverlay>();
  readonly replyRequested = output<string>();
  readonly replyNavigation = output<string>();
  readonly reactionChanged = output<ReadonlyArray<string>>();
  readonly overlayRequested = output<MessageOverlay | undefined>();
  protected readonly reactionOpen = computed(() => this.activeOverlay() === 'picker');
  protected readonly actionMenuOpen = computed(() => this.activeOverlay() === 'menu');
  protected readonly quickReactionOpen = computed(() => this.activeOverlay() === 'quick');
  protected readonly overlayPlacement = signal<'above' | 'below'>('above');
  protected readonly reactionPickerStyle = signal('');
  protected readonly tooltipEmoji = signal<string | undefined>(undefined);
  protected readonly contentSegments = computed(() => messageContentSegments(this.body()));
  protected readonly emojiCount = computed(() => emojiOnlyCount(this.body()));
  private readonly externalLinks = inject<ExternalLinkPort>(EXTERNAL_LINK_PORT, { optional: true });
  protected time(value: string | undefined): string {
    return formatMessageTime(value);
  }
  protected date(value: string | undefined): string {
    return formatMessageDate(value);
  }
  protected fullDate(value: string | undefined): string {
    return formatMessageDateTime(value);
  }
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
    void this.externalLinks.open({
      version: 1,
      requestId: createOpaqueId('external-link'),
      url: href,
    });
  }
  protected toggleReactionPicker(): void {
    if (!this.messageId()) return;
    this.requestOverlay(this.quickReactionOpen() ? undefined : 'quick');
  }
  protected toggleActionMenu(): void {
    if (!this.messageId()) return;
    this.requestOverlay(this.actionMenuOpen() ? undefined : 'menu');
  }
  protected openFullPicker(): void {
    this.requestOverlay('picker');
  }
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
  protected isOwnReaction(emoji: string): boolean {
    return this.ownReactionEmojis().includes(emoji);
  }
  protected showReactionTooltip(emoji: string): void {
    this.tooltipEmoji.set(emoji);
  }
  protected hideReactionTooltip(): void {
    this.tooltipEmoji.set(undefined);
  }
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
  protected closeReactionPicker(): void {
    this.requestOverlay(undefined);
  }
  protected closeOverlays(): void {
    this.hideReactionTooltip();
    this.requestOverlay(undefined);
  }
  @HostListener('window:resize')
  protected onViewportResize(): void {
    if (this.reactionOpen()) this.positionReactionPicker();
  }
  protected requestOverlay(overlay: MessageOverlay | undefined): void {
    if (overlay && !this.messageId()) return;
    if (!overlay) this.reactionPickerStyle.set('');
    if (overlay) {
      const element = this.host.nativeElement.querySelector('.message') as HTMLElement | null;
      const bounds = element?.getBoundingClientRect();
      const scrollViewport = element
        ?.closest<HTMLElement>('.chat-content')
        ?.getBoundingClientRect();
      const topOffset =
        bounds && scrollViewport
          ? bounds.top - scrollViewport.top
          : bounds?.top || Number.POSITIVE_INFINITY;
      this.overlayPlacement.set(topOffset < 128 ? 'below' : 'above');
      if (overlay === 'picker') this.positionReactionPicker();
    }
    this.overlayRequested.emit(overlay);
  }
  private positionReactionPicker(): void {
    if (typeof window === 'undefined') return;
    const element = this.host.nativeElement.querySelector('.message') as HTMLElement | null;
    const bounds = element?.getBoundingClientRect();
    if (!bounds) return;

    const margin = 12;
    const gap = 8;
    const panelWidth = Math.min(320, Math.max(0, window.innerWidth - margin * 2));
    const panelHeight = Math.min(420, Math.max(160, window.innerHeight - margin * 2));
    const canFitAbove = bounds.top - gap - panelHeight >= margin;
    const canFitBelow = bounds.bottom + gap + panelHeight <= window.innerHeight - margin;
    let top: number;

    if (this.overlayPlacement() === 'below' && canFitBelow) {
      top = bounds.bottom + gap;
    } else if (canFitAbove) {
      top = bounds.top - gap - panelHeight;
    } else if (canFitBelow) {
      top = bounds.bottom + gap;
    } else {
      top = margin;
    }

    const preferredLeft = this.outgoing() ? bounds.right - panelWidth : bounds.left;
    const maxLeft = Math.max(margin, window.innerWidth - panelWidth - margin);
    const left = Math.min(Math.max(preferredLeft, margin), maxLeft);
    const maxHeight = Math.max(160, Math.min(420, window.innerHeight - margin * 2));
    this.reactionPickerStyle.set(
      'top: ' +
        Math.round(top) +
        'px; left: ' +
        Math.round(left) +
        'px; --emoji-picker-max-height: ' +
        Math.round(maxHeight) +
        'px;',
    );
  }
  private readonly host = inject(ElementRef<HTMLElement>);
}
