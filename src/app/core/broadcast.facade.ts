import { Injectable, inject } from '@angular/core';
import { BroadcastRequest, BroadcastResult } from './domain';
import { createOpaqueId } from './ids';
import { BROADCAST_PORT, BroadcastPort } from './ports';

export function bareBroadcastJid(jid: string): string {
  return jid.trim().split('/')[0].toLowerCase();
}

@Injectable({ providedIn: 'root' })
export class BroadcastFacade {
  private readonly port = inject<BroadcastPort>(BROADCAST_PORT);

  async send(request: BroadcastRequest): Promise<BroadcastResult> {
    const recipients = [...new Set(request.recipientJids.map(bareBroadcastJid).filter(Boolean))];
    const result = await this.port.send({
      version: 1,
      requestId: createOpaqueId('broadcast'),
      accountId: request.accountId,
      broadcastId: request.broadcastId,
      mode: request.mode,
      recipientJids: recipients,
      body: { kind: 'text', text: request.body.trim() },
    });
    if (result.ok) return result.value;
    return {
      broadcastId: request.broadcastId,
      recipients: recipients.map((recipientJid) => ({
        recipientJid,
        clientMessageId: createOpaqueId('client-msg'),
        status: 'failed',
        errorCode: result.error.code,
      })),
    };
  }
}
