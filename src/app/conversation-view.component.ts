import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  ElementRef,
  effect,
  inject,
  input,
  output,
  ViewChild,
} from '@angular/core';
import { Contact, FileTransfer, Message } from './core/domain';
import { FileTransferCardComponent } from './file-transfer-card.component';
import { MessageComposerComponent } from './message-composer.component';
import { MessageItemComponent } from './message-item.component';

export type ConversationTimelineItem =
  | {
      readonly kind: 'text';
      readonly id: string;
      readonly sortAt: string;
      readonly message: Message;
      readonly senderLabel: string;
      readonly outgoing: boolean;
    }
  | {
      readonly kind: 'file';
      readonly id: string;
      readonly sortAt: string;
      readonly transfer: FileTransfer;
      readonly senderLabel: string;
      readonly outgoing: boolean;
      readonly label: string;
      readonly progressLabel: string;
    };

export interface OlderMessagesRequest {
  readonly conversation: string;
  readonly accountId: string;
  readonly previousHeight: number;
}

@Component({
  selector: 'app-conversation-view',
  imports: [FileTransferCardComponent, MessageComposerComponent, MessageItemComponent],
  templateUrl: './conversation-view.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConversationViewComponent {
  readonly activeContact = input<Contact>();
  readonly selectedJid = input.required<string>();
  readonly accountId = input.required<string>();
  readonly timeline = input.required<ReadonlyArray<ConversationTimelineItem>>();
  readonly error = input<string | null>(null);
  readonly draft = input.required<string>();
  readonly historyLoading = input.required<boolean>();
  readonly hasOlderMessages = input.required<boolean>();
  readonly hasNewerMessages = input.required<boolean>();

  readonly draftChange = output<string>();
  readonly messageSend = output<void>();
  readonly attach = output<void>();
  readonly accept = output<string>();
  readonly reject = output<string>();
  readonly fileCancel = output<string>();
  readonly loadOlder = output<OlderMessagesRequest>();
  readonly loadNewer = output<string>();

  @ViewChild('chatContent') private chatContent?: ElementRef<HTMLElement>;
  private followLatest = true;
  private renderedConversation = '';
  private frame: number | undefined;
  private scrollGeneration = 0;
  private readonly destroyRef = inject(DestroyRef);
  private readonly visibleMessageKey = computed(() => {
    const items = this.timeline();
    const last = items[items.length - 1];
    return `${this.bareJid(this.selectedJid())}|${items.length}|${last?.id || ''}|${last?.sortAt || ''}`;
  });

  constructor() {
    effect(() => {
      this.visibleMessageKey();
      const conversation = this.bareJid(this.selectedJid());
      if (conversation)
        this.scheduleScroll(conversation, conversation !== this.renderedConversation);
    });
    this.destroyRef.onDestroy(() => {
      if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    });
  }

  protected isSelected(): boolean {
    return Boolean(this.selectedJid());
  }

  public onUserScrollIntent(): void {
    queueMicrotask(() => {
      const element = this.chatContent?.nativeElement;
      if (element)
        this.followLatest = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    });
  }

  public onChatScroll(state?: {
    readonly historyLoading: boolean;
    readonly hasOlderMessages: boolean;
    readonly hasNewerMessages: boolean;
  }): void {
    const element = this.chatContent?.nativeElement;
    const conversation = this.bareJid(this.selectedJid());
    const accountId = this.accountId();
    if (!element || !conversation || (state?.historyLoading ?? this.historyLoading())) return;
    this.followLatest = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
    if (element.scrollTop < 48 && (state?.hasOlderMessages ?? this.hasOlderMessages())) {
      this.loadOlder.emit({ conversation, accountId, previousHeight: element.scrollHeight });
    } else if (this.followLatest && (state?.hasNewerMessages ?? this.hasNewerMessages()))
      this.loadNewer.emit(conversation);
  }

  public restoreScrollAfterPrepend(request: OlderMessagesRequest): void {
    requestAnimationFrame(() => {
      const current = this.chatContent?.nativeElement;
      if (
        current &&
        this.accountId() === request.accountId &&
        this.bareJid(this.selectedJid()) === request.conversation
      )
        current.scrollTop += current.scrollHeight - request.previousHeight;
    });
  }

  public scrollToLatest(conversation: string): void {
    this.scheduleScroll(this.bareJid(conversation), true);
  }

  private scheduleScroll(conversation: string, force: boolean): void {
    const generation = ++this.scrollGeneration;
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    if (!force && !this.followLatest) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = undefined;
      if (generation !== this.scrollGeneration || this.bareJid(this.selectedJid()) !== conversation)
        return;
      const element = this.chatContent?.nativeElement;
      if (!element) return;
      element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      this.renderedConversation = conversation;
    });
  }

  private bareJid(jid: string): string {
    return jid.split('/')[0].toLowerCase();
  }
}
