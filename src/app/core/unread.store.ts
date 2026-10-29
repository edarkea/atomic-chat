import { Injectable, computed, signal } from '@angular/core';
import { AttentionState } from './domain';

export type UnreadConversationKind = 'direct' | 'muc';

export function unreadKey(accountId: string, kind: UnreadConversationKind, jid: string): string {
  return `${accountId.toLowerCase()}|${kind}|${jid.split('/')[0].toLowerCase()}`;
}

@Injectable({ providedIn: 'root' })
export class UnreadStore {
  readonly counts = signal<ReadonlyMap<string, number>>(new Map());
  readonly attention = signal<ReadonlyMap<string, AttentionState>>(new Map());
  readonly total = computed(() => [...this.counts().values()].reduce((total, value) => total + value, 0));
  private readonly seenIncoming = new Set<string>();

  recordIncoming(
    accountId: string,
    kind: UnreadConversationKind,
    jid: string,
    messageIdentity: string,
    visible: boolean,
  ): void {
    const identity = `${accountId.toLowerCase()}|${kind}|${messageIdentity}`;
    if (this.seenIncoming.has(identity)) return;
    this.seenIncoming.add(identity);
    if (this.seenIncoming.size > 5000) this.seenIncoming.delete(this.seenIncoming.values().next().value || '');
    if (visible) return;
    const key = unreadKey(accountId, kind, jid);
    this.counts.update((current) => {
      const next = new Map(current);
      next.set(key, (next.get(key) || 0) + 1);
      return next;
    });
    this.attention.update((current) => {
      const next = new Map(current);
      next.set(accountId, { accountId, unreadTotal: this.accountTotal(accountId), attentionRequested: true });
      return next;
    });
  }

  markRead(accountId: string, kind: UnreadConversationKind, jid: string): void {
    const key = unreadKey(accountId, kind, jid);
    this.counts.update((current) => {
      if (!current.has(key)) return current;
      const next = new Map(current);
      next.delete(key);
      return next;
    });
  }

  acknowledgeAttention(accountId: string): void {
    this.attention.update((current) => {
      const state = current.get(accountId);
      if (!state || !state.attentionRequested) return current;
      const next = new Map(current);
      next.set(accountId, { ...state, attentionRequested: false, unreadTotal: this.accountTotal(accountId) });
      return next;
    });
  }

  resetAccount(accountId: string): void {
    const prefix = `${accountId.toLowerCase()}|`;
    this.counts.update((current) => {
      const next = new Map([...current].filter(([key]) => !key.startsWith(prefix)));
      return next.size === current.size ? current : next;
    });
    this.attention.update((current) => {
      if (!current.has(accountId)) return current;
      const next = new Map(current);
      next.delete(accountId);
      return next;
    });
    for (const identity of this.seenIncoming)
      if (identity.startsWith(prefix)) this.seenIncoming.delete(identity);
  }

  private accountTotal(accountId: string): number {
    const prefix = `${accountId.toLowerCase()}|`;
    return [...this.counts()].reduce(
      (total, [key, value]) => (key.startsWith(prefix) ? total + value : total),
      0,
    );
  }
}
