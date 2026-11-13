import { createOpaqueId } from '../ids';
import type { AttentionPort } from '../ports';
import { ActiveConversationStore } from '../stores/active-conversation.store';
import { WindowFocusStore } from '../stores/window-focus.store';
import { UnreadStore, type UnreadConversationKind } from '../stores/unread.store';
import { bareJid } from '../identity';

export interface IncomingConversationNotification {
  readonly accountId: string;
  readonly kind: UnreadConversationKind;
  readonly conversationId: string;
  readonly messageIdentity: string;
}

export interface UnreadConversationCoordinatorDependencies {
  readonly unread: UnreadStore;
  readonly activeConversation: Pick<ActiveConversationStore, 'isVisible'>;
  readonly windowFocus: Pick<WindowFocusStore, 'isFocused'>;
  readonly attention: AttentionPort | null;
  readonly currentAccountId: () => string;
}

export type IncomingConversationResult = ReturnType<UnreadStore['recordIncoming']>;

export class UnreadConversationCoordinator {
  constructor(private readonly dependencies: UnreadConversationCoordinatorDependencies) {}

  recordIncoming(input: IncomingConversationNotification): IncomingConversationResult {
    if (!this.isCurrentAccount(input.accountId))
      return { isNew: false, unreadIncremented: false, attentionRequested: false };

    const result = this.dependencies.unread.recordIncoming(
      input.accountId,
      input.kind,
      input.conversationId,
      input.messageIdentity,
      this.dependencies.activeConversation.isVisible(
        input.accountId,
        input.kind,
        input.conversationId,
      ),
      this.dependencies.windowFocus.isFocused(),
    );
    if (result.attentionRequested) void this.requestAttention(input);
    return result;
  }

  markConversationRead(
    accountId: string,
    kind: UnreadConversationKind,
    conversationId: string,
  ): boolean {
    if (!this.isCurrentAccount(accountId)) return false;
    const acknowledged = this.dependencies.unread.markReadIfEligible(
      accountId,
      kind,
      conversationId,
      this.dependencies.activeConversation.isVisible(accountId, kind, conversationId),
      this.dependencies.windowFocus.isFocused(),
    );
    if (acknowledged) this.clearAttentionIfRead(accountId);
    return acknowledged;
  }

  resetAccount(accountId: string): void {
    const hadState =
      this.dependencies.unread.totalForAccount(accountId) > 0 ||
      this.dependencies.unread.attention().has(accountId);
    this.dependencies.unread.resetAccount(accountId);
    if (hadState) this.clearAttentionIfRead(accountId);
  }

  private isCurrentAccount(accountId: string): boolean {
    return accountId === this.dependencies.currentAccountId();
  }

  private async requestAttention(input: IncomingConversationNotification): Promise<void> {
    if (!this.dependencies.attention || !this.isCurrentAccount(input.accountId)) return;
    try {
      await this.dependencies.attention.request({
        version: 1,
        requestId: createOpaqueId('attention'),
        accountId: input.accountId,
        conversationId: bareJid(input.conversationId),
      });
    } catch {
      // Native attention is best effort and never blocks message handling.
    }
  }

  private clearAttentionIfRead(accountId: string): void {
    if (!this.dependencies.attention || this.dependencies.unread.totalForAccount(accountId) !== 0)
      return;
    void this.dependencies.attention
      .clear({ version: 1, requestId: createOpaqueId('attention-clear'), accountId })
      .catch(() => undefined);
  }
}
