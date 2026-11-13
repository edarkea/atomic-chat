import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import type { ChatState } from '../domain';
import type { ChatStateEvent } from '../domain/domain-event';
import { bareJid } from '../identity';

const INCOMING_COMPOSING_TIMEOUT_MS = 6000;

/**
 * Owns transient incoming typing indicators independently of XMPP transport and
 * chat message history. No subscriptions or timers survive a cleared session.
 */
@Injectable({ providedIn: 'root' })
export class IncomingChatStateStore {
  readonly states = signal<ReadonlyMap<string, ChatState>>(new Map());

  private readonly destroyRef = inject(DestroyRef);
  private readonly incoming = new Map<string, ChatState>();
  private readonly expiryTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    this.destroyRef.onDestroy(() => this.clear());
  }

  receive(event: ChatStateEvent, accountId: string): void {
    if (event.accountId !== accountId || bareJid(event.senderJid) === bareJid(accountId)) return;

    const key = bareJid(event.conversationId);
    const previous = this.expiryTimers.get(key);
    if (previous) clearTimeout(previous);

    if (event.state === 'composing') {
      this.incoming.set(key, event.state);
      this.expiryTimers.set(
        key,
        setTimeout(() => {
          this.expiryTimers.delete(key);
          this.incoming.delete(key);
          this.publish();
        }, INCOMING_COMPOSING_TIMEOUT_MS),
      );
    } else {
      this.incoming.delete(key);
      this.expiryTimers.delete(key);
    }

    this.publish();
  }

  clear(): void {
    for (const timer of this.expiryTimers.values()) clearTimeout(timer);
    this.expiryTimers.clear();
    this.incoming.clear();
    this.publish();
  }

  private publish(): void {
    this.states.set(new Map(this.incoming));
  }
}
