import { Injectable, inject, signal } from '@angular/core';
import {
  Result,
  StickerCapability,
  StickerMessageLoadRequest,
  StickerMessageRef,
  StickerSendRequest,
} from './domain';
import { createOpaqueId } from './ids';
import { STICKER_MESSAGE_PORT, StickerMessagePort } from './ports';

@Injectable({ providedIn: 'root' })
export class StickerMessageFacade {
  private readonly port = inject<StickerMessagePort>(STICKER_MESSAGE_PORT);
  readonly capability = signal<StickerCapability | undefined>(undefined);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);

  async discover(accountId: string): Promise<Result<StickerCapability>> {
    const result = await this.port.discover({
      version: 1,
      requestId: createOpaqueId('sticker-capability'),
      accountId,
    });
    if (result.ok) this.capability.set(result.value);
    else this.error.set(this.friendlyError(result.error.code));
    return result;
  }

  async send(accountId: string, conversationId: string, stickerId: string): Promise<Result<StickerMessageRef>> {
    this.busy.set(true);
    this.error.set(null);
    try {
      const input: StickerSendRequest = {
        version: 1,
        requestId: createOpaqueId('sticker-send'),
        accountId,
        conversationId,
        clientMessageId: createOpaqueId('sticker-message'),
        stickerId,
      };
      const result = await this.port.send(input);
      if (!result.ok) this.error.set(this.friendlyError(result.error.code));
      return result;
    } finally {
      this.busy.set(false);
    }
  }

  async load(ref: StickerMessageRef): Promise<Result<StickerMessageRef>> {
    const input: StickerMessageLoadRequest = {
      version: 1,
      requestId: createOpaqueId('sticker-load'),
      accountId: ref.accountId,
      conversationId: ref.conversationId,
      refId: ref.refId,
    };
    const result = await this.port.load(input);
    if (!result.ok) this.error.set(this.friendlyError(result.error.code));
    return result;
  }

  clearError(): void { this.error.set(null); }

  private friendlyError(code: string): string {
    if (code === 'UNSUPPORTED') return 'El servidor no ofrece stickers compatibles.';
    if (code === 'NOT_CONNECTED') return 'La cuenta no está conectada.';
    if (code.startsWith('MEDIA_')) return 'El sticker no se pudo validar.';
    return 'No se pudo completar el sticker.';
  }
}
