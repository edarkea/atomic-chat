import { signal, type Signal } from '@angular/core';
import { createOpaqueId } from '../ids';
import {
  applyMessageHistoryPage,
  applyTimelineHistoryPage,
  mergeInitialHistoryMessages,
  timelineTextMessages,
  type HistoryPageWindowState,
} from '../timeline/conversation-history-window';
import type {
  HistoryPage,
  HistoryTimelineItem,
  Message,
  MessageAroundInput,
  MessageSearchHit,
  MessageSearchScope,
  Result,
} from '../domain';
import type { HistoryPort } from '../ports';
import { bareJid } from '../identity';

interface HistoryContext {
  readonly accountId: string;
  readonly conversationId: string;
  readonly generation: number;
  readonly loadGeneration: number;
  readonly requestId: string;
}

export interface InitialHistoryState {
  readonly accountId: string;
  readonly conversationId: string;
  readonly generation: number;
  readonly status: 'loading' | 'ready';
}

export interface ConversationHistoryDependencies {
  readonly history: HistoryPort;
  readonly search: MessageSearchPort;
  readonly accountId: () => string;
  readonly identityGeneration: () => number;
  readonly isAvailable: () => boolean;
  readonly reportError: (message: string) => void;
  readonly markConversationRead: (accountId: string, conversationId: string) => void;
}

export interface MessageSearchPort {
  readonly results: Signal<ReadonlyArray<MessageSearchHit>>;
  readonly loading: Signal<boolean>;
  readonly error: Signal<string | null>;
  readonly hasMore: Signal<boolean>;
  search(
    query: string,
    scope: MessageSearchScope,
    currentAccountId: () => string,
    append?: boolean,
  ): Promise<void>;
  reset(): void;
}

/** Coordinates direct-conversation history without exposing the HistoryPort to UI components. */
export class ConversationHistoryCoordinator {
  readonly messages = signal<Message[]>([]);
  readonly messageSearchResults: Signal<ReadonlyArray<MessageSearchHit>>;
  readonly messageSearchLoading: Signal<boolean>;
  readonly messageSearchError: Signal<string | null>;
  readonly messageSearchHasMore: Signal<boolean>;
  readonly timelineItems = signal<ReadonlyArray<HistoryTimelineItem>>([]);
  readonly timelineSupported = signal(false);
  readonly initialHistory = signal<InitialHistoryState | null>(null);
  readonly historyLoading = signal(false);
  readonly hasOlderMessages = signal(false);
  readonly hasNewerMessages = signal(false);

  private olderCursor: string | null = null;
  private newerCursor: string | null = null;
  private historyPages: Array<{ cursor: string }> = [];
  private timelinePages: Array<{ cursor: string }> = [];
  private timelineMode = false;
  private historyContext: HistoryContext | null = null;
  private historyLoadGeneration = 0;

  constructor(private readonly dependencies: ConversationHistoryDependencies) {
    this.messageSearchResults = dependencies.search.results;
    this.messageSearchLoading = dependencies.search.loading;
    this.messageSearchError = dependencies.search.error;
    this.messageSearchHasMore = dependencies.search.hasMore;
  }

  activeConversationId(): string | undefined {
    return this.historyContext?.conversationId;
  }

  reset(): void {
    this.historyLoadGeneration += 1;
    this.historyContext = null;
    this.olderCursor = null;
    this.newerCursor = null;
    this.historyPages = [];
    this.timelinePages = [];
    this.timelineMode = false;
    this.messages.set([]);
    this.timelineItems.set([]);
    this.timelineSupported.set(false);
    this.initialHistory.set(null);
    this.historyLoading.set(false);
    this.hasOlderMessages.set(false);
    this.hasNewerMessages.set(false);
  }

  resetSearch(): void {
    this.dependencies.search.reset();
  }

  async loadConversation(
    conversationId: string,
    options?: { readonly deferInitialReady?: boolean },
  ): Promise<void> {
    if (!this.dependencies.isAvailable() || !conversationId) return;
    const accountId = this.dependencies.accountId();
    const generation = this.dependencies.identityGeneration();
    const requestId = createOpaqueId('history');
    const context: HistoryContext = {
      accountId,
      conversationId: bareJid(conversationId),
      generation,
      loadGeneration: ++this.historyLoadGeneration,
      requestId,
    };
    this.historyContext = context;
    this.initialHistory.set({
      accountId,
      conversationId: context.conversationId,
      generation: context.loadGeneration,
      status: 'loading',
    });
    this.historyLoading.set(true);
    this.resetWindow();

    try {
      const timelinePage = this.dependencies.history.timelinePage;
      const timelineResult = timelinePage
        ? await timelinePage.call(this.dependencies.history, {
            version: 1,
            requestId,
            accountId,
            conversationId: context.conversationId,
            limit: 50,
            direction: 'older',
            cursor: null,
          })
        : undefined;
      if (!this.isHistoryContextCurrent(context)) return;
      if (timelineResult?.ok) {
        this.timelineMode = true;
        this.timelineSupported.set(true);
        this.timelineItems.set(timelineResult.value.items);
        this.timelinePages = timelineResult.value.nextCursor
          ? [{ cursor: timelineResult.value.nextCursor }]
          : [];
        this.olderCursor = timelineResult.value.nextCursor;
        this.hasOlderMessages.set(timelineResult.value.hasMore);
        this.hasNewerMessages.set(false);
        this.messages.set(
          mergeInitialHistoryMessages(
            timelineTextMessages(timelineResult.value.items),
            this.messages(),
            context.conversationId,
          ),
        );
        this.markConversationRead(accountId, context.conversationId);
        return;
      }
      if (timelineResult && timelineResult.error.code !== 'UNSUPPORTED') {
        this.dependencies.reportError(timelineResult.error.message);
        return;
      }

      const result = await this.dependencies.history.listPage({
        version: 1,
        requestId,
        accountId,
        conversationId: context.conversationId,
        limit: 50,
        direction: 'older',
        cursor: null,
      });
      if (!this.isHistoryContextCurrent(context)) return;
      if (result.ok) {
        this.historyPages = result.value.nextCursor ? [{ cursor: result.value.nextCursor }] : [];
        this.olderCursor = result.value.nextCursor;
        this.hasOlderMessages.set(result.value.hasMore);
        this.hasNewerMessages.set(false);
        this.messages.set(
          mergeInitialHistoryMessages(result.value.items, this.messages(), context.conversationId),
        );
        this.markConversationRead(accountId, context.conversationId);
      } else this.dependencies.reportError(result.error.message);
    } finally {
      if (this.isHistoryContextCurrent(context)) {
        this.historyLoading.set(false);
        if (!options?.deferInitialReady)
          this.initialHistory.set({
            accountId: context.accountId,
            conversationId: context.conversationId,
            generation: context.loadGeneration,
            status: 'ready',
          });
      }
    }
  }

  searchMessages(query: string, scope: MessageSearchScope, append = false): Promise<void> {
    return this.dependencies.search.search(query, scope, this.dependencies.accountId, append);
  }

  async revealSearchHit(hit: MessageSearchHit): Promise<void> {
    if (hit.accountId !== this.dependencies.accountId()) return;
    await this.loadConversation(hit.conversationId, { deferInitialReady: true });
    const context = this.historyContext;
    if (
      !context ||
      context.conversationId !== bareJid(hit.conversationId) ||
      !this.isHistoryContextCurrent(context)
    )
      return;

    const input: MessageAroundInput = {
      version: 1,
      requestId: createOpaqueId('message-around'),
      accountId: hit.accountId,
      conversationId: bareJid(hit.conversationId),
      messageId: hit.messageId,
      createdAt: hit.createdAt,
      limit: 100,
    };
    try {
      const result: Result<HistoryPage> = await this.dependencies.history.around(input);
      if (!this.isHistoryContextCurrent(context)) return;
      if (!result.ok) {
        this.dependencies.reportError(result.error.message);
        return;
      }
      this.messages.set(result.value.items);
      this.hasOlderMessages.set(false);
      this.hasNewerMessages.set(false);
    } finally {
      if (this.isHistoryContextCurrent(context)) {
        this.initialHistory.set({
          accountId: context.accountId,
          conversationId: context.conversationId,
          generation: context.loadGeneration,
          status: 'ready',
        });
      }
    }
  }

  async loadOlderMessages(conversationId: string): Promise<void> {
    await this.loadHistoryPage(conversationId, 'older');
  }

  async loadNewerMessages(conversationId: string): Promise<void> {
    await this.loadHistoryPage(conversationId, 'newer');
  }

  private async loadHistoryPage(
    conversationId: string,
    direction: 'older' | 'newer',
  ): Promise<void> {
    if (!this.dependencies.isAvailable() || !conversationId || this.historyLoading()) return;
    const context = this.historyContext;
    const cursor = direction === 'older' ? this.olderCursor : this.newerCursor;
    if (!cursor || !context || context.conversationId !== bareJid(conversationId)) return;
    const accountId = this.dependencies.accountId();
    this.historyLoading.set(true);
    try {
      if (this.timelineMode && this.dependencies.history.timelinePage) {
        await this.loadTimelinePage(context, accountId, direction);
        return;
      }
      const result = await this.dependencies.history.listPage({
        version: 1,
        requestId: createOpaqueId('history'),
        accountId,
        conversationId: context.conversationId,
        limit: 50,
        direction,
        cursor,
      });
      if (!this.isHistoryContextCurrent(context)) return;
      if (!result.ok) {
        this.dependencies.reportError(result.error.message);
        return;
      }
      const applied = applyMessageHistoryPage(
        this.messages(),
        result.value.items,
        this.historyWindow(this.historyPages),
        direction,
        result.value.nextCursor,
        result.value.hasMore,
      );
      if (!applied) {
        this.setHasMore(direction, false);
        return;
      }
      this.historyPages = [...applied.window.pages];
      this.publishHistoryWindow(applied.window);
      this.messages.set(applied.items);
    } finally {
      if (this.isHistoryContextCurrent(context)) this.historyLoading.set(false);
    }
  }

  private async loadTimelinePage(
    context: HistoryContext,
    accountId: string,
    direction: 'older' | 'newer',
  ): Promise<void> {
    const cursor = direction === 'older' ? this.olderCursor : this.newerCursor;
    const timelinePage = this.dependencies.history.timelinePage;
    if (!cursor || !timelinePage) return;
    const result = await timelinePage.call(this.dependencies.history, {
      version: 1,
      requestId: createOpaqueId('timeline'),
      accountId,
      conversationId: context.conversationId,
      limit: 50,
      direction,
      cursor,
    });
    if (!this.isHistoryContextCurrent(context)) return;
    if (!result.ok) {
      this.dependencies.reportError(result.error.message);
      return;
    }
    const applied = applyTimelineHistoryPage(
      this.timelineItems(),
      result.value.items,
      this.historyWindow(this.timelinePages),
      direction,
      result.value.nextCursor,
      result.value.hasMore,
    );
    if (!applied) {
      this.setHasMore(direction, false);
      return;
    }
    this.timelinePages = [...applied.window.pages];
    this.publishHistoryWindow(applied.window);
    this.timelineItems.set(applied.items);
    this.messages.set(
      mergeInitialHistoryMessages(
        timelineTextMessages(applied.items),
        this.messages(),
        context.conversationId,
      ),
    );
  }

  private resetWindow(): void {
    this.olderCursor = null;
    this.newerCursor = null;
    this.historyPages = [];
    this.timelinePages = [];
    this.timelineMode = false;
    this.timelineItems.set([]);
    this.timelineSupported.set(false);
    this.messages.set([]);
    this.hasOlderMessages.set(false);
    this.hasNewerMessages.set(false);
  }

  private historyWindow(pages: ReadonlyArray<{ readonly cursor: string }>): HistoryPageWindowState {
    return {
      pages,
      olderCursor: this.olderCursor,
      newerCursor: this.newerCursor,
      hasOlder: this.hasOlderMessages(),
      hasNewer: this.hasNewerMessages(),
    };
  }

  private publishHistoryWindow(window: HistoryPageWindowState): void {
    this.olderCursor = window.olderCursor;
    this.newerCursor = window.newerCursor;
    this.hasOlderMessages.set(window.hasOlder);
    this.hasNewerMessages.set(window.hasNewer);
  }

  private setHasMore(direction: 'older' | 'newer', value: boolean): void {
    if (direction === 'older') this.hasOlderMessages.set(value);
    else this.hasNewerMessages.set(value);
  }

  private isHistoryContextCurrent(context: HistoryContext): boolean {
    return (
      this.dependencies.identityGeneration() === context.generation &&
      this.dependencies.accountId() === context.accountId &&
      this.historyContext?.requestId === context.requestId &&
      this.historyContext?.conversationId === context.conversationId
    );
  }

  private markConversationRead(accountId: string, conversationId: string): void {
    this.dependencies.markConversationRead(accountId, conversationId);
  }
}
