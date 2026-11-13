import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  HostListener,
  inject,
  input,
  output,
  signal,
  ViewChild,
} from '@angular/core';
import {
  Contact,
  Message,
  MessageSearchHit,
  ReactionActor,
  ReactionState,
} from '../../core/domain';
import { FileTransferCardComponent } from './file-transfer-card.component';
import { MessageComposerComponent } from './message-composer.component';
import { bareJid } from '../../core/identity';
import {
  isProtectedMessageOverlayPointer,
  MessageItemComponent,
  MessageOverlay,
} from './message-item.component';
import { StickerMessageCardComponent } from '../stickers/sticker-message-card.component';
import { MessageSearchComponent } from './message-search.component';
import { ScrollToLatestButtonComponent } from './scroll-to-latest-button.component';
import { formatMessageDay } from './message-date-time';
import { groupMessagesForDisplay, MessageGroupingMetadata } from './message-grouping';
import { ConversationMessageCoordinator } from './conversation-message.coordinator';
import type { ConversationTimelineItem, OlderMessagesRequest } from './conversation-view.models';
import {
  ConversationScrollCoordinator,
  type ConversationSearchNavigationTarget,
} from './conversation-scroll.coordinator';

export type { ConversationTimelineItem, OlderMessagesRequest } from './conversation-view.models';

@Component({
  selector: 'app-conversation-view',
  imports: [
    FileTransferCardComponent,
    MessageComposerComponent,
    MessageItemComponent,
    ScrollToLatestButtonComponent,
    StickerMessageCardComponent,
    MessageSearchComponent,
  ],
  templateUrl: './conversation-view.component.html',
  styleUrls: ['./conversation-view.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConversationViewComponent {
  readonly activeContact = input<Contact>();
  readonly selectedJid = input.required<string>();
  readonly accountId = input.required<string>();
  readonly timeline = input.required<ReadonlyArray<ConversationTimelineItem>>();
  readonly initialTimelineReady = input.required<boolean>();
  readonly error = input<string | null>(null);
  readonly draft = input.required<string>();
  readonly historyLoading = input.required<boolean>();
  readonly hasOlderMessages = input.required<boolean>();
  readonly hasNewerMessages = input.required<boolean>();
  readonly typing = input('');
  readonly searchQuery = input('');
  readonly searchScope = input<'all' | 'conversation'>('conversation');
  readonly searchConversationNames = input<ReadonlyMap<string, string>>(new Map());
  readonly searchResults = input<ReadonlyArray<MessageSearchHit>>([]);
  readonly searchLoading = input(false);
  readonly searchError = input<string | null>(null);
  readonly searchHasMore = input(false);
  readonly reactions = input<ReadonlyMap<string, ReactionState>>(new Map());
  readonly replyingTo = input<{
    readonly id: string;
    readonly author: string;
    readonly quote: string;
  }>();

  readonly closeRequested = output<void>();
  readonly filesDropped = output<ReadonlyArray<File>>();
  readonly filesPasted = output<ReadonlyArray<File>>();
  readonly dropRejected = output<string>();
  readonly draftChange = output<string>();
  readonly typingFocus = output<void>();
  readonly typingBlur = output<void>();
  readonly messageSend = output<void>();
  readonly attach = output<void>();
  readonly stickerSend = output<string>();
  readonly stickerLoad = output<string>();
  readonly stickerSave = output<string>();
  readonly accept = output<string>();
  readonly reject = output<string>();
  readonly fileCancel = output<string>();
  readonly fileOpen = output<string>();
  readonly fileReveal = output<string>();
  readonly historicalOpened = output<{ fileId: string; conversationId: string }>();
  readonly historicalRevealed = output<{ fileId: string; conversationId: string }>();
  readonly fileActionPending = input<(transferId: string) => boolean>(() => false);
  readonly loadOlder = output<OlderMessagesRequest>();
  readonly loadNewer = output<string>();
  readonly searchQueryChange = output<string>();
  readonly searchScopeChange = output<'all' | 'conversation'>();
  readonly searchResultSelected = output<MessageSearchHit>();
  readonly searchLoadMore = output<void>();
  readonly replyRequested = output<Message>();
  readonly replyCancel = output<void>();
  readonly reactionChanged = output<{
    readonly messageId: string;
    readonly emojis: ReadonlyArray<string>;
  }>();
  protected readonly searchOpen = signal(false);
  protected readonly activeOverlay = signal<
    { readonly messageId: string; readonly overlay: MessageOverlay } | undefined
  >(undefined);

  @ViewChild('chatContent') private chatContent?: ElementRef<HTMLElement>;
  @ViewChild(MessageComposerComponent) private messageComposer?: MessageComposerComponent;
  protected readonly dropActive = signal(false);
  private dragDepth = 0;
  private readonly destroyRef = inject(DestroyRef);
  private readonly visibleMessageKey = computed(() => {
    const items = this.timeline();
    const last = items[items.length - 1];
    return `${this.accountId()}|${bareJid(this.selectedJid())}|${items.length}|${last?.id || ''}|${last?.sortAt || ''}`;
  });
  private readonly scroll = new ConversationScrollCoordinator({
    container: () => this.chatContent?.nativeElement,
    conversation: () => bareJid(this.selectedJid()),
    accountId: () => this.accountId(),
    visibleMessageKey: () => this.visibleMessageKey(),
    initialTimelineReady: () => this.initialTimelineReady(),
    historyLoading: () => this.historyLoading(),
    hasOlderMessages: () => this.hasOlderMessages(),
    hasNewerMessages: () => this.hasNewerMessages(),
    loadOlder: (request) => this.loadOlder.emit(request),
    loadNewer: (conversation) => this.loadNewer.emit(conversation),
  });
  protected readonly showScrollToLatest = this.scroll.showScrollToLatest;
  protected readonly previewRoot = this.scroll.previewRoot;
  private readonly messageCoordinator = new ConversationMessageCoordinator({
    activeContact: this.activeContact,
    selectedJid: this.selectedJid,
    accountId: this.accountId,
    timeline: this.timeline,
    reactions: this.reactions,
  });
  protected readonly displayTimeline = computed(() =>
    groupMessagesForDisplay(
      this.timeline(),
      (item): MessageGroupingMetadata | undefined =>
        item.kind === 'text'
          ? {
              senderKey: `${item.outgoing ? 'out:' : 'in:'}${bareJid(item.message.senderJid)}`,
              conversationKey: bareJid(item.message.conversationId),
              createdAt: item.message.createdAt,
              classification: item.message.classification,
            }
          : undefined,
      (item) => item.id,
      (item) => item.sortAt,
    ),
  );

  constructor() {
    effect(() => {
      this.visibleMessageKey();
      this.initialTimelineReady();
      if (this.scroll.observeTimeline()) this.activeOverlay.set(undefined);
    });
    this.destroyRef.onDestroy(() => this.scroll.destroy());
  }

  protected isSelected(): boolean {
    return Boolean(this.selectedJid());
  }
  protected profileTooltip(): string {
    const name =
      this.activeContact()?.name?.trim() || this.selectedJid() || 'Selecciona un contacto';
    const jid = this.selectedJid();
    return jid && jid !== name ? `${name}\n${jid}` : name;
  }
  protected toggleSearch(): void {
    if (!this.isSelected()) return;
    this.searchOpen.update((open) => !open);
  }
  protected dayLabel(sortAt: string): string {
    return formatMessageDay(sortAt);
  }
  protected requestReply(message: Message): void {
    this.replyRequested.emit(message);
  }

  focusComposer(): void {
    this.messageComposer?.focusComposer();
  }

  protected overlayFor(messageId: string): MessageOverlay | undefined {
    return this.activeOverlay()?.messageId === messageId
      ? this.activeOverlay()?.overlay
      : undefined;
  }
  protected setOverlay(messageId: string, overlay: MessageOverlay | undefined): void {
    this.activeOverlay.set(overlay ? { messageId, overlay } : undefined);
  }
  @HostListener('document:pointerdown', ['$event'])
  protected onDocumentPointerdown(event: PointerEvent): void {
    const active = this.activeOverlay();
    if (!active) return;
    if (isProtectedMessageOverlayPointer(event, active.messageId)) return;
    this.activeOverlay.set(undefined);
  }
  protected reactionFor(messageId: string): ReactionState | undefined {
    return this.messageCoordinator.reactionFor(messageId);
  }
  protected ownReactionEmojis(messageId: string): ReadonlyArray<string> {
    return this.messageCoordinator.ownReactionEmojis(messageId);
  }
  protected stableActionId(message: Message): string {
    return this.messageCoordinator.stableActionId(message);
  }
  protected actionTargetId(message: Message): string {
    return this.messageCoordinator.actionTargetId(message);
  }
  protected replyTargetId(reference: Message['replyTo']): string {
    return this.messageCoordinator.replyTargetId(reference);
  }
  protected replyAuthor(reference: Message['replyTo']): string {
    return this.messageCoordinator.replyAuthor(reference);
  }
  protected replyQuote(reference: Message['replyTo']): string {
    return this.messageCoordinator.replyQuote(reference);
  }
  protected replyTime(reference: Message['replyTo']): string {
    return this.messageCoordinator.replyTime(reference);
  }
  protected readonly reactionActorLabel = (actor: ReactionActor): string => {
    return this.messageCoordinator.reactionActorLabel(actor);
  };

  protected onDragEnter(event: DragEvent): void {
    if (!this.isFileDrag(event)) return;
    event.preventDefault();
    if (!this.isSelected()) return;
    this.dragDepth += 1;
    this.dropActive.set(true);
  }

  protected onDragOver(event: DragEvent): void {
    const fileDrag = this.isFileDrag(event);
    if (!fileDrag) return;
    event.preventDefault();
    if (event.dataTransfer)
      event.dataTransfer.dropEffect = fileDrag && this.isSelected() ? 'copy' : 'none';
  }

  protected onDragLeave(event: DragEvent): void {
    if (!this.isFileDrag(event)) return;
    event.preventDefault();
    this.dragDepth = Math.max(0, this.dragDepth - 1);
    if (!this.dragDepth) this.dropActive.set(false);
  }

  protected onDrop(event: DragEvent): void {
    if (!this.isFileDrag(event)) return;
    event.preventDefault();
    this.dragDepth = 0;
    this.dropActive.set(false);
    if (!this.isFileDrag(event) || !this.isSelected()) return;
    const items = Array.from(event.dataTransfer?.items ?? []);
    const hasDirectory = items.some((item) => {
      const entry = (
        item as DataTransferItem & { webkitGetAsEntry?: () => { isDirectory?: boolean } | null }
      ).webkitGetAsEntry?.();
      return entry?.isDirectory === true;
    });
    if (hasDirectory) {
      this.dropRejected.emit('No se pueden enviar carpetas.');
      return;
    }
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (!files.length) {
      this.dropRejected.emit('El elemento arrastrado no es un archivo válido.');
      return;
    }
    this.filesDropped.emit(files);
  }

  public onUserScrollIntent(): void {
    this.scroll.onUserScrollIntent();
  }

  public onChatScroll(state?: {
    readonly historyLoading: boolean;
    readonly hasOlderMessages: boolean;
    readonly hasNewerMessages: boolean;
  }): void {
    this.activeOverlay.set(undefined);
    this.scroll.onChatScroll(state);
  }

  @HostListener('window:resize')
  protected onViewportResize(): void {
    this.scroll.onViewportResize();
  }

  public restoreScrollAfterPrepend(request: OlderMessagesRequest): void {
    this.scroll.restoreScrollAfterPrepend(request);
  }

  protected scrollToLatestFromButton(): void {
    this.scroll.scrollToLatestFromButton();
  }

  public scrollToLatest(conversation: string): void {
    this.scroll.scrollToLatest(conversation);
  }

  public scrollToMessage(messageId: string): void {
    this.scroll.scrollToMessage(messageId);
  }

  public beginSearchNavigation(target?: ConversationSearchNavigationTarget): void {
    this.scroll.beginSearchNavigation(target);
  }

  private isFileDrag(event: DragEvent): boolean {
    return event.dataTransfer?.types.includes('Files') ?? false;
  }
}
