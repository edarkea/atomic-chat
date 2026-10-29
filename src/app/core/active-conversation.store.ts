import { Injectable, computed, signal } from '@angular/core';
import { ActiveConversation } from './domain';

@Injectable({ providedIn: 'root' })
export class ActiveConversationStore {
  private readonly selection = signal<ActiveConversation>(null);
  readonly current = computed(() => this.selection());

  set(value: ActiveConversation): void {
    this.selection.set(
      value
        ? {
            accountId: this.normalizeAccount(value.accountId),
            kind: value.kind,
            jid: this.normalizeJid(value.jid),
          }
        : null,
    );
  }

  isVisible(accountId: string, kind: 'direct' | 'muc', jid: string): boolean {
    const current = this.selection();
    return Boolean(
      current &&
        current.accountId === this.normalizeAccount(accountId) &&
        current.kind === kind &&
        current.jid === this.normalizeJid(jid),
    );
  }

  private normalizeAccount(accountId: string): string {
    return accountId.trim().toLowerCase();
  }

  private normalizeJid(jid: string): string {
    return jid.split('/')[0].trim().toLowerCase();
  }
}
