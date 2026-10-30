import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BroadcastFacade, bareBroadcastJid } from './broadcast.facade';
import { ChatFacade } from './chat.facade';

describe('BroadcastFacade', () => {
  const accountId = 'operator@example.invalid';
  let connected: ReturnType<typeof signal<boolean>>;
  let sendMessageInput: ReturnType<typeof vi.fn>;
  let facade: BroadcastFacade;

  beforeEach(() => {
    connected = signal(true);
    sendMessageInput = vi.fn(
      async (input: { conversationId: string; clientMessageId: string }) => ({
        ok: true as const,
        value: {
          id: `message-${input.clientMessageId}`,
          accountId,
          conversationId: input.conversationId,
          clientMessageId: input.clientMessageId,
          senderJid: accountId,
          body: { kind: 'text' as const, text: 'hola' },
          status: 'sent' as const,
          createdAt: new Date().toISOString(),
        },
        version: 1 as const,
        requestId: `request-${input.clientMessageId}`,
      }),
    );
    TestBed.configureTestingModule({
      providers: [
        BroadcastFacade,
        {
          provide: ChatFacade,
          useValue: {
            accountId: signal(accountId),
            isConnected: connected,
            sendMessageInput,
          },
        },
      ],
    });
    facade = TestBed.inject(BroadcastFacade);
  });

  it('normalizes and deduplicates recipients while using individual message inputs', async () => {
    const result = await facade.send({
      broadcastId: 'broadcast-1',
      accountId,
      mode: 'normal',
      body: ' hola ',
      recipientJids: ['One@Example.invalid/resource', 'one@example.invalid', 'two@example.invalid'],
    });

    expect(result.recipients.map((item) => item.recipientJid)).toEqual([
      'one@example.invalid',
      'two@example.invalid',
    ]);
    expect(result.recipients.every((item) => item.status === 'submitted')).toBe(true);
    expect(sendMessageInput).toHaveBeenCalledTimes(2);
    expect(sendMessageInput.mock.calls.map(([input]) => input.conversationId)).toEqual([
      'one@example.invalid',
      'two@example.invalid',
    ]);
    expect(new Set(sendMessageInput.mock.calls.map(([input]) => input.clientMessageId)).size).toBe(
      2,
    );
  });

  it('keeps partial failures visible and does not retry unknown outcomes', async () => {
    sendMessageInput
      .mockResolvedValueOnce({
        ok: true as const,
        value: {},
        version: 1 as const,
        requestId: 'request-1',
      })
      .mockRejectedValueOnce(new Error('connection lost'))
      .mockResolvedValueOnce({
        ok: false as const,
        version: 1 as const,
        error: {
          code: 'INVALID_INPUT' as const,
          retryable: false,
          requestId: 'request-3',
          message: 'invalid',
        },
      });

    const result = await facade.send({
      broadcastId: 'broadcast-2',
      accountId,
      mode: 'normal',
      body: 'hola',
      recipientJids: ['one@example.invalid', 'two@example.invalid', 'three@example.invalid'],
    });

    expect(result.recipients.map((item) => item.status)).toEqual([
      'submitted',
      'unknown',
      'failed',
    ]);
    expect(result.recipients[1].errorCode).toBe('TRANSPORT_FAILED');
    expect(result.recipients[2].errorCode).toBe('INVALID_INPUT');
  });

  it('stops queued sends after the account is disconnected', async () => {
    let releaseFirst: (() => void) | undefined;
    sendMessageInput.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          releaseFirst = () =>
            resolve({
              ok: true as const,
              value: {},
              version: 1 as const,
              requestId: 'request-1',
            });
        }),
    );
    const pending = facade.send({
      broadcastId: 'broadcast-3',
      accountId,
      mode: 'normal',
      body: 'hola',
      recipientJids: [
        'one@example.invalid',
        'two@example.invalid',
        'three@example.invalid',
        'four@example.invalid',
      ],
    });
    connected.set(false);
    releaseFirst?.();
    const result = await pending;
    expect(result.recipients.filter((item) => item.status === 'failed').length).toBeGreaterThan(0);
    expect(sendMessageInput).toHaveBeenCalledTimes(3);
  });

  it('normalizes a resource-bearing jid', () => {
    expect(bareBroadcastJid(' User@Example.invalid/desktop ')).toBe('user@example.invalid');
  });
});
