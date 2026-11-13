import { DestroyRef, Injectable, inject } from '@angular/core';
import { createOpaqueId } from '../ids';
import type { ChatState, ChatStateInput } from '../domain';
import { XMPP_PORT, type XmppPort } from '../ports';
import { bareJid } from '../identity';

const OUTGOING_TYPING_PAUSE_MS = 1200;

export interface OutgoingChatStateContext {
  readonly accountId: () => string;
  readonly isConnected: () => boolean;
}

/** Owns outgoing typing timers and deduplication without subscribing to XMPP events. */
@Injectable({ providedIn: 'root' })
export class OutgoingChatStateStore {
  private readonly xmpp = inject<XmppPort>(XMPP_PORT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly sentStates = new Map<string, ChatState>();

  constructor() {
    this.destroyRef.onDestroy(() => this.clear());
  }

  async updateDraft(
    conversationId: string,
    draft: string,
    context: OutgoingChatStateContext,
  ): Promise<void> {
    const state: ChatState = draft.trim() ? 'composing' : 'active';
    await this.send(conversationId, state, context);
    const key = bareJid(conversationId);
    const previous = this.typingTimers.get(key);
    if (previous) clearTimeout(previous);
    if (state === 'composing') {
      this.typingTimers.set(
        key,
        setTimeout(() => {
          void this.send(conversationId, 'paused', context);
          this.typingTimers.delete(key);
        }, OUTGOING_TYPING_PAUSE_MS),
      );
    }
  }

  async setActivity(
    conversationId: string,
    state: Extract<ChatState, 'active' | 'inactive'>,
    context: OutgoingChatStateContext,
  ): Promise<void> {
    const key = bareJid(conversationId);
    const timer = this.typingTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.typingTimers.delete(key);
    }
    await this.send(conversationId, state, context);
  }

  async send(
    conversationId: string,
    state: ChatState,
    context: OutgoingChatStateContext,
  ): Promise<void> {
    const send = this.xmpp.sendChatState;
    if (!send || !context.isConnected() || !conversationId.trim()) return;
    const key = bareJid(conversationId);
    if (this.sentStates.get(key) === state) return;
    this.sentStates.set(key, state);
    const input: ChatStateInput = {
      version: 1,
      requestId: createOpaqueId('chat-state'),
      accountId: context.accountId(),
      conversationId: conversationId.trim(),
      state,
    };
    try {
      await send.call(this.xmpp, input);
    } catch {
      if (this.sentStates.get(key) === state) this.sentStates.delete(key);
      // Typing notifications are best effort and must never block chat messages.
    }
  }

  clear(): void {
    for (const timer of this.typingTimers.values()) clearTimeout(timer);
    this.typingTimers.clear();
    this.sentStates.clear();
  }
}
