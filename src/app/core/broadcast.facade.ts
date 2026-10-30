import { Injectable, inject } from '@angular/core';
import { ChatFacade } from './chat.facade';
import {
  BroadcastRecipientResult,
  BroadcastRequest,
  BroadcastResult,
  MessageSendInput,
} from './domain';
import { createOpaqueId } from './ids';

interface BroadcastOperation {
  readonly accountId: string;
  cancelled: boolean;
}

const MAX_CONCURRENT_SENDS = 3;

export function bareBroadcastJid(jid: string): string {
  return jid.trim().split('/')[0].toLowerCase();
}

@Injectable({ providedIn: 'root' })
export class BroadcastFacade {
  private readonly chat = inject(ChatFacade);
  private readonly operations = new Set<BroadcastOperation>();

  async send(request: BroadcastRequest): Promise<BroadcastResult> {
    const recipients = [...new Set(request.recipientJids.map(bareBroadcastJid).filter(Boolean))];
    const operation: BroadcastOperation = { accountId: request.accountId, cancelled: false };
    this.operations.add(operation);
    const results: BroadcastRecipientResult[] = recipients.map((recipientJid) => ({
      recipientJid,
      clientMessageId: createOpaqueId('client-msg'),
      status: 'queued',
    }));
    let nextIndex = 0;

    try {
      if (!request.body.trim()) {
        return {
          broadcastId: request.broadcastId,
          recipients: results.map((result) => ({
            ...result,
            status: 'failed',
            errorCode: 'INVALID_INPUT',
          })),
        };
      }
      if (request.mode === 'alert') {
        return {
          broadcastId: request.broadcastId,
          recipients: results.map((result) => ({
            ...result,
            status: 'failed',
            errorCode: 'UNSUPPORTED',
          })),
        };
      }

      const worker = async (): Promise<void> => {
        while (true) {
          const index = nextIndex++;
          if (index >= results.length) return;
          const current = results[index];
          if (operation.cancelled || !this.canContinue(operation.accountId)) {
            results[index] = { ...current, status: 'failed', errorCode: 'NOT_CONNECTED' };
            continue;
          }

          const input: MessageSendInput = {
            version: 1,
            requestId: createOpaqueId('req'),
            accountId: operation.accountId,
            conversationId: current.recipientJid,
            clientMessageId: current.clientMessageId,
            body: { kind: 'text', text: request.body.trim() },
          };
          try {
            const result = await this.chat.sendMessageInput(input);
            results[index] = result.ok
              ? { ...current, status: 'submitted' }
              : { ...current, status: 'failed', errorCode: result.error.code };
          } catch {
            results[index] = { ...current, status: 'unknown', errorCode: 'TRANSPORT_FAILED' };
          }
        }
      };

      const workerCount = Math.min(MAX_CONCURRENT_SENDS, Math.max(recipients.length, 1));
      await Promise.all(Array.from({ length: workerCount }, () => worker()));
      return { broadcastId: request.broadcastId, recipients: results };
    } finally {
      this.operations.delete(operation);
    }
  }

  cancel(accountId: string): void {
    for (const operation of this.operations) {
      if (operation.accountId === accountId) operation.cancelled = true;
    }
  }

  private canContinue(accountId: string): boolean {
    return this.chat.accountId() === accountId && this.chat.isConnected();
  }
}
