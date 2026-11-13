import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { normalizedAccountId, normalizedBareJid } from '../identity';

type ConversationKind = 'direct' | 'muc';

const STORAGE_KEY = 'atomic-chat.hidden-conversations.v1';
const MAX_ACCOUNTS = 32;
const MAX_HIDDEN_PER_ACCOUNT = 256;
const MAX_IDENTITY_LENGTH = 512;

@Injectable({ providedIn: 'root' })
export class ConversationVisibilityStore {
  private readonly document = inject(DOCUMENT);
  private readonly hiddenByAccount = signal<ReadonlyMap<string, ReadonlySet<string>>>(new Map());
  private activeAccount = '';
  readonly hidden = computed(
    () => this.hiddenByAccount().get(this.activeAccount) || new Set<string>(),
  );

  setAccount(accountId: string): void {
    const normalized = this.normalizeAccount(accountId);
    if (normalized === this.activeAccount) return;
    this.activeAccount = normalized;
    this.hiddenByAccount.set(this.readStored());
  }

  isHidden(accountId: string, kind: ConversationKind, jid: string): boolean {
    const account = this.normalizeAccount(accountId);
    const identity = this.identity(kind, jid);
    return Boolean(account && identity && this.hiddenByAccount().get(account)?.has(identity));
  }

  hide(accountId: string, kind: ConversationKind, jid: string): void {
    const account = this.normalizeAccount(accountId);
    const identity = this.identity(kind, jid);
    if (!account || !identity) return;
    const next = this.copyMap();
    const values = new Set(next.get(account) || []);
    values.add(identity);
    if (!next.has(account) && next.size >= MAX_ACCOUNTS)
      next.delete(next.keys().next().value || '');
    next.set(account, new Set([...values].slice(-MAX_HIDDEN_PER_ACCOUNT)));
    this.hiddenByAccount.set(next);
    this.persist(next);
  }

  reveal(accountId: string, kind: ConversationKind, jid: string): void {
    const account = this.normalizeAccount(accountId);
    const identity = this.identity(kind, jid);
    if (!account || !identity) return;
    const current = this.hiddenByAccount().get(account);
    if (!current?.has(identity)) return;
    const next = this.copyMap();
    const values = new Set(current);
    values.delete(identity);
    if (values.size) next.set(account, values);
    else next.delete(account);
    this.hiddenByAccount.set(next);
    this.persist(next);
  }

  clearAll(): void {
    this.hiddenByAccount.set(new Map());
    try {
      this.document.defaultView?.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Local persistence is best effort and never blocks navigation.
    }
  }

  private copyMap(): Map<string, Set<string>> {
    return new Map(
      [...this.hiddenByAccount().entries()].map(([account, values]) => [account, new Set(values)]),
    );
  }

  private readStored(): Map<string, Set<string>> {
    let parsed: unknown;
    try {
      const raw = this.document.defaultView?.localStorage.getItem(STORAGE_KEY);
      parsed = raw ? JSON.parse(raw) : {};
    } catch {
      return new Map();
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return new Map();
    const result = new Map<string, Set<string>>();
    for (const [accountValue, identities] of Object.entries(parsed).slice(0, MAX_ACCOUNTS)) {
      const account = this.normalizeAccount(accountValue);
      if (!account || !Array.isArray(identities)) continue;
      const valid = identities
        .filter((value): value is string => typeof value === 'string')
        .filter((value) => this.isValidIdentity(value))
        .slice(-MAX_HIDDEN_PER_ACCOUNT);
      if (valid.length) result.set(account, new Set(valid));
    }
    return result;
  }

  private persist(values: ReadonlyMap<string, ReadonlySet<string>>): void {
    try {
      const serialized = Object.fromEntries(
        [...values.entries()]
          .slice(0, MAX_ACCOUNTS)
          .map(([account, identities]) => [
            account,
            [...identities].slice(-MAX_HIDDEN_PER_ACCOUNT),
          ]),
      );
      this.document.defaultView?.localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
    } catch {
      // Local persistence is best effort and never blocks navigation.
    }
  }

  private identity(kind: ConversationKind, jid: string): string {
    const normalized = normalizedBareJid(jid);
    if (!normalized || normalized.length > MAX_IDENTITY_LENGTH) return '';
    return `${kind}:${normalized}`;
  }

  private isValidIdentity(value: string): boolean {
    const separator = value.indexOf(':');
    const jid = separator >= 0 ? value.slice(separator + 1) : '';
    return (
      (value.startsWith('direct:') || value.startsWith('muc:')) &&
      separator > 0 &&
      Boolean(jid) &&
      !/[\s/]/.test(jid) &&
      value.length <= MAX_IDENTITY_LENGTH
    );
  }

  private normalizeAccount(accountId: string): string {
    const normalized = normalizedAccountId(accountId);
    return normalized.length <= MAX_IDENTITY_LENGTH ? normalized : '';
  }
}
