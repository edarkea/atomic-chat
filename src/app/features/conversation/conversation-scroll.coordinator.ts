import { signal } from '@angular/core';
import {
  distanceToBottom,
  SCROLL_TO_LATEST_HIDE_DISTANCE,
  scrollToLatest,
  shouldShowScrollToLatest,
} from './scroll-to-latest';
import type { OlderMessagesRequest } from './conversation-view.models';
import { bareJid } from '../../core/identity';

export interface ConversationScrollContext {
  readonly container: () => HTMLElement | undefined;
  readonly conversation: () => string;
  readonly accountId: () => string;
  readonly visibleMessageKey: () => string;
  readonly initialTimelineReady: () => boolean;
  readonly historyLoading: () => boolean;
  readonly hasOlderMessages: () => boolean;
  readonly hasNewerMessages: () => boolean;
  readonly loadOlder: (request: OlderMessagesRequest) => void;
  readonly loadNewer: (conversation: string) => void;
}

export interface ConversationSearchNavigationTarget {
  readonly accountId: string;
  readonly conversation: string;
}

export class ConversationScrollCoordinator {
  private followLatest = true;
  private renderedConversation = '';
  private renderedAccount = '';
  private frame: number | undefined;
  private readonly scheduledFrames = new Set<number>();
  private scrollGeneration = 0;
  private lifecycleGeneration = 0;
  private destroyed = false;
  private programmaticLatestScroll = false;
  private searchNavigationPending = false;
  private searchNavigationContext:
    { readonly accountId: string; readonly conversation: string } | undefined;
  private pendingOlderScroll?: { readonly conversation: string; readonly accountId: string };
  private observedTimelineKey: string | undefined;
  private observedInitialTimelineReady: boolean | undefined;
  private observedAccountId: string | undefined;
  private observedConversation: string | undefined;

  readonly showScrollToLatest = signal(false);
  readonly previewRoot = signal<HTMLElement | undefined>(undefined);

  constructor(private readonly context: ConversationScrollContext) {}

  observeTimeline(): boolean {
    if (this.destroyed) return false;
    const visibleMessageKey = this.context.visibleMessageKey();
    const initialTimelineReady = this.context.initialTimelineReady();
    const accountId = this.context.accountId();
    const conversation = this.context.conversation();
    const shouldReconcile =
      visibleMessageKey !== this.observedTimelineKey ||
      initialTimelineReady !== this.observedInitialTimelineReady ||
      accountId !== this.observedAccountId ||
      conversation !== this.observedConversation;
    if (!shouldReconcile) return false;
    this.observedTimelineKey = visibleMessageKey;
    this.observedInitialTimelineReady = initialTimelineReady;
    this.observedAccountId = accountId;
    this.observedConversation = conversation;
    if (
      this.searchNavigationPending &&
      this.searchNavigationContext &&
      (this.searchNavigationContext.accountId !== accountId ||
        this.searchNavigationContext.conversation !== conversation)
    ) {
      this.searchNavigationPending = false;
      this.searchNavigationContext = undefined;
    }
    if (!initialTimelineReady || this.searchNavigationPending) {
      this.pendingOlderScroll = undefined;
      this.previewRoot.set(undefined);
      this.invalidatePendingWork();
      return false;
    }
    const contextChanged =
      conversation !== this.renderedConversation || accountId !== this.renderedAccount;
    if (contextChanged) {
      this.invalidatePendingWork();
      this.pendingOlderScroll = undefined;
      this.showScrollToLatest.set(false);
      this.previewRoot.set(undefined);
      this.programmaticLatestScroll = false;
      this.followLatest = true;
    }
    if (conversation) this.scheduleScroll(conversation, accountId, contextChanged);
    return contextChanged;
  }

  onUserScrollIntent(): void {
    if (this.destroyed) return;
    this.programmaticLatestScroll = false;
    const lifecycleGeneration = this.lifecycleGeneration;
    queueMicrotask(() => {
      if (this.destroyed || lifecycleGeneration !== this.lifecycleGeneration) return;
      const element = this.context.container();
      if (!element) return;
      this.updateScrollToLatest(element);
      this.followLatest = distanceToBottom(element) < 48;
    });
  }

  onChatScroll(state?: {
    readonly historyLoading: boolean;
    readonly hasOlderMessages: boolean;
    readonly hasNewerMessages: boolean;
  }): void {
    if (this.destroyed) return;
    const element = this.context.container();
    const conversation = this.context.conversation();
    const accountId = this.context.accountId();
    if (!element) return;
    this.updateScrollToLatest(element);
    if (this.programmaticLatestScroll) return;
    if (
      !conversation ||
      (state?.historyLoading ?? this.context.historyLoading()) ||
      this.pendingOlderScroll
    )
      return;
    this.followLatest = distanceToBottom(element) < 48;
    if (element.scrollTop < 48 && (state?.hasOlderMessages ?? this.context.hasOlderMessages())) {
      this.pendingOlderScroll = { conversation, accountId };
      this.followLatest = false;
      this.context.loadOlder({
        conversation,
        accountId,
        previousHeight: element.scrollHeight,
        anchor: this.visibleTimelineAnchor(element),
      });
    } else if (this.followLatest && (state?.hasNewerMessages ?? this.context.hasNewerMessages()))
      this.context.loadNewer(conversation);
  }

  onViewportResize(): void {
    if (this.destroyed) return;
    const element = this.context.container();
    if (element) this.updateScrollToLatest(element);
  }

  restoreScrollAfterPrepend(request: OlderMessagesRequest): void {
    if (this.destroyed) return;
    const lifecycleGeneration = this.lifecycleGeneration;
    this.scheduleFrame(() => {
      if (this.destroyed || lifecycleGeneration !== this.lifecycleGeneration) return;
      if (
        this.pendingOlderScroll?.accountId === request.accountId &&
        this.pendingOlderScroll.conversation === request.conversation
      )
        this.pendingOlderScroll = undefined;
      const current = this.context.container();
      if (
        !current ||
        this.context.accountId() !== request.accountId ||
        this.context.conversation() !== request.conversation
      )
        return;
      const anchored =
        request.anchor &&
        Array.from(current.querySelectorAll<HTMLElement>('[data-timeline-id]')).find(
          (element) => element.dataset['timelineId'] === request.anchor?.id,
        );
      if (anchored && request.anchor) {
        const offsetTop =
          anchored.getBoundingClientRect().top - current.getBoundingClientRect().top;
        current.scrollTop += offsetTop - request.anchor.offsetTop;
      } else {
        current.scrollTop += current.scrollHeight - request.previousHeight;
      }
      this.followLatest = distanceToBottom(current) < 48;
      this.updateScrollToLatest(current);
    });
  }

  scrollToLatestFromButton(): void {
    if (this.destroyed) return;
    const element = this.context.container();
    if (!element) return;
    this.followLatest = true;
    this.programmaticLatestScroll = true;
    this.showScrollToLatest.set(false);
    scrollToLatest(element);
    if (distanceToBottom(element) < SCROLL_TO_LATEST_HIDE_DISTANCE)
      this.programmaticLatestScroll = false;
  }

  scrollToLatest(conversation: string): void {
    if (this.destroyed) return;
    this.scheduleScroll(bareJid(conversation), this.context.accountId(), true);
  }

  scrollToMessage(messageId: string): void {
    if (this.destroyed) return;
    this.followLatest = false;
    const lifecycleGeneration = this.lifecycleGeneration;
    const accountId = this.context.accountId();
    const conversation = this.context.conversation();
    this.scheduleFrame(() => {
      if (
        this.destroyed ||
        lifecycleGeneration !== this.lifecycleGeneration ||
        this.context.accountId() !== accountId ||
        this.context.conversation() !== conversation
      )
        return;
      this.scheduleFrame(() => {
        if (
          this.destroyed ||
          lifecycleGeneration !== this.lifecycleGeneration ||
          this.context.accountId() !== accountId ||
          this.context.conversation() !== conversation
        )
          return;
        const content = this.context.container();
        if (!content || !this.context.conversation()) return;
        const message = Array.from(content.querySelectorAll<HTMLElement>('[data-message-id]')).find(
          (element) => element.dataset['messageId'] === messageId,
        );
        message?.scrollIntoView({ block: 'center', behavior: 'smooth' });
        this.searchNavigationPending = false;
        this.searchNavigationContext = undefined;
        this.renderedConversation = this.context.conversation();
        this.renderedAccount = this.context.accountId();
        this.previewRoot.set(content);
      });
    });
  }

  beginSearchNavigation(target?: ConversationSearchNavigationTarget): void {
    if (this.destroyed) return;
    this.searchNavigationPending = true;
    this.searchNavigationContext = {
      accountId: target?.accountId || this.context.accountId(),
      conversation: bareJid(target?.conversation || this.context.conversation()),
    };
    this.previewRoot.set(undefined);
    this.invalidatePendingWork();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.searchNavigationPending = false;
    this.searchNavigationContext = undefined;
    this.invalidatePendingWork();
  }

  private scheduleScroll(conversation: string, accountId: string, force: boolean): void {
    if (this.destroyed || !this.context.initialTimelineReady() || this.searchNavigationPending)
      return;
    const generation = ++this.scrollGeneration;
    this.cancelFrame();
    if (!force && !this.followLatest) return;
    const scheduledFrame = this.scheduleFrame(() => {
      if (
        this.destroyed ||
        generation !== this.scrollGeneration ||
        !this.context.initialTimelineReady() ||
        this.searchNavigationPending ||
        this.context.accountId() !== accountId ||
        this.context.conversation() !== conversation
      )
        return;
      const element = this.context.container();
      if (!element) return;
      element.scrollTop = Math.max(0, element.scrollHeight - element.clientHeight);
      this.followLatest = true;
      this.programmaticLatestScroll = false;
      this.showScrollToLatest.set(false);
      this.renderedConversation = conversation;
      this.renderedAccount = accountId;
      this.previewRoot.set(element);
    });
    if (this.scheduledFrames.has(scheduledFrame)) this.frame = scheduledFrame;
  }

  private updateScrollToLatest(element: HTMLElement): void {
    const distance = distanceToBottom(element);
    if (this.programmaticLatestScroll) {
      if (distance < 80) this.programmaticLatestScroll = false;
      this.showScrollToLatest.set(false);
      return;
    }
    this.showScrollToLatest.set(shouldShowScrollToLatest(this.showScrollToLatest(), distance));
  }

  private visibleTimelineAnchor(container: HTMLElement): OlderMessagesRequest['anchor'] {
    const viewport = container.getBoundingClientRect();
    for (const element of Array.from(
      container.querySelectorAll<HTMLElement>('[data-timeline-id]'),
    )) {
      const rectangle = element.getBoundingClientRect();
      const id = element.dataset['timelineId'];
      if (id && rectangle.bottom > viewport.top && rectangle.top < viewport.bottom) {
        return { id, offsetTop: rectangle.top - viewport.top };
      }
    }
    return undefined;
  }

  private cancelFrame(): void {
    if (this.frame !== undefined) {
      cancelAnimationFrame(this.frame);
      this.scheduledFrames.delete(this.frame);
      this.frame = undefined;
    }
  }

  private invalidatePendingWork(): void {
    this.lifecycleGeneration += 1;
    this.scrollGeneration += 1;
    for (const frame of this.scheduledFrames) cancelAnimationFrame(frame);
    this.scheduledFrames.clear();
    this.frame = undefined;
  }

  private scheduleFrame(callback: FrameRequestCallback): number {
    let completedSynchronously = false;
    let frame = 0;
    frame = requestAnimationFrame((timestamp) => {
      completedSynchronously = true;
      this.scheduledFrames.delete(frame);
      if (this.frame === frame) this.frame = undefined;
      callback(timestamp);
    });
    if (!completedSynchronously) this.scheduledFrames.add(frame);
    return frame;
  }
}
