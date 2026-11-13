import { signal, type Signal, type WritableSignal } from '@angular/core';
import { createOpaqueId } from '../ids';
import {
  applyRemoteContactPresence,
  resetRosterContactPresence,
} from '../contacts/contact-presence';
import { reconcileRosterContacts } from '../contacts/roster-reconciliation';
import type { Contact, ConversationSummary, Presence } from '../domain';
import type { HistoryPort, XmppPort } from '../ports';
import { bareJid } from '../identity';

export interface RosterConversationDependencies {
  readonly history: HistoryPort;
  readonly xmpp: XmppPort;
  readonly unreadCounts: Signal<ReadonlyMap<string, number>>;
  readonly accountId: () => string;
  readonly identityGeneration: () => number;
  readonly isCurrent: (generation: number, accountId: string) => boolean;
  readonly reportError: (message: string) => void;
}

/** Owns roster contacts and direct-conversation summaries for the active account. */
export class RosterConversationCoordinator {
  readonly contacts: WritableSignal<Contact[]> = signal<Contact[]>([]);
  readonly conversationSummaries = signal<ReadonlyArray<ConversationSummary>>([]);

  private contactsOwner = '';

  constructor(private readonly dependencies: RosterConversationDependencies) {}

  resetForAccount(accountId: string): void {
    this.contactsOwner = accountId;
    this.contacts.set([]);
    this.conversationSummaries.set([]);
  }

  async refreshRoster(): Promise<void> {
    const accountId = this.dependencies.accountId();
    const generation = this.dependencies.identityGeneration();
    const result = await this.dependencies.xmpp.listRoster(accountId);
    if (result.ok && this.dependencies.isCurrent(generation, accountId)) {
      this.mergeRoster(result.value);
      await this.loadStoredConversations(accountId, generation);
    } else if (!result.ok && this.dependencies.isCurrent(generation, accountId)) {
      this.dependencies.reportError(result.error.message);
    }
  }

  async loadStoredConversations(accountId: string, generation: number): Promise<void> {
    try {
      const result = await this.dependencies.history.conversations({
        version: 1,
        requestId: createOpaqueId('req'),
        accountId,
      });
      if (!this.dependencies.isCurrent(generation, accountId) || !result.ok) return;
      const persistedSummaries = result.value.map((conversation) => ({
        id: `${accountId}|direct|${conversation.jid}`,
        accountId,
        kind: 'direct' as const,
        jid: bareJid(conversation.jid),
        title: this.contactTitle(conversation.jid),
        unreadCount: this.unreadCount(accountId, 'direct', conversation.jid),
        lastMessageAt: Date.parse(conversation.lastActivity) || undefined,
      }));
      const persistedIds = new Set(persistedSummaries.map((summary) => summary.id));
      const liveOnly = this.conversationSummaries().filter(
        (summary) => summary.accountId !== accountId || !persistedIds.has(summary.id),
      );
      this.conversationSummaries.set([...persistedSummaries, ...liveOnly]);
      for (const conversation of result.value)
        this.addConversation(accountId, conversation.jid, Date.parse(conversation.lastActivity));
    } catch {
      // History recovery is best effort; it must not turn a valid login into a failure.
    }
  }

  addConversation(accountId: string, jid: string, activity = Date.now()): void {
    if (accountId !== this.dependencies.accountId() || !jid) return;
    const safeActivity = Number.isFinite(activity) ? activity : Date.now();
    const bare = bareJid(jid);
    this.contacts.update((items) =>
      items.some((item) => bareJid(item.jid) === bare)
        ? items
        : [...items, { jid: bare, name: bare, groups: [], source: 'conversation' }],
    );
    this.conversationSummaries.update((items) => {
      const existing = items.find(
        (item) => item.accountId === accountId && item.kind === 'direct' && item.jid === bare,
      );
      const next: ConversationSummary = {
        id: `${accountId}|direct|${bare}`,
        accountId,
        kind: 'direct',
        jid: bare,
        title: this.contactTitle(bare),
        unreadCount: this.unreadCount(accountId, 'direct', bare),
        lastMessageAt: Math.max(existing?.lastMessageAt || 0, safeActivity),
      };
      return existing
        ? items.map((item) => (item.id === existing.id ? next : item))
        : [...items, next];
    });
  }

  updateConversationUnread(accountId: string, jid: string): void {
    const bare = bareJid(jid);
    this.conversationSummaries.update((items) =>
      items.map((item) =>
        item.accountId === accountId && item.kind === 'direct' && item.jid === bare
          ? { ...item, unreadCount: this.unreadCount(accountId, 'direct', bare) }
          : item,
      ),
    );
  }

  mergeRoster(roster: Contact[]): void {
    const accountId = this.dependencies.accountId();
    if (this.contactsOwner !== accountId) {
      this.contacts.set([]);
      this.contactsOwner = accountId;
    }
    this.contacts.update((items) => reconcileRosterContacts(items, roster));
  }

  applyRemoteContactPresence(presence: Presence): void {
    this.contacts.update((items) => applyRemoteContactPresence(items, presence));
  }

  resetRemotePresence(_accountId: string): void {
    const updatedAt = new Date().toISOString();
    this.contacts.update((items) => resetRosterContactPresence(items, updatedAt));
  }

  private contactTitle(jid: string): string {
    const bare = bareJid(jid);
    return (
      this.contacts()
        .find((contact) => bareJid(contact.jid) === bare)
        ?.name?.trim() || bare
    );
  }

  private unreadCount(accountId: string, kind: 'direct' | 'muc', jid: string): number {
    return (
      this.dependencies.unreadCounts().get(`${accountId.toLowerCase()}|${kind}|${bareJid(jid)}`) ||
      0
    );
  }
}
