import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BroadcastFacade, bareBroadcastJid } from './broadcast.facade';
import { BROADCAST_PORT } from './ports';

describe('BroadcastFacade', () => {
  let send: ReturnType<typeof vi.fn>;
  let facade: BroadcastFacade;

  beforeEach(() => {
    send = vi.fn(async (input: { broadcastId: string; recipientJids: readonly string[] }) => ({
      ok: true as const,
      version: 1 as const,
      requestId: 'request-1',
      value: {
        broadcastId: input.broadcastId,
        recipients: input.recipientJids.map((recipientJid, index) => ({
          recipientJid,
          clientMessageId: `client-${index}`,
          status: 'submitted' as const,
        })),
      },
    }));
    TestBed.configureTestingModule({
      providers: [BroadcastFacade, { provide: BROADCAST_PORT, useValue: { send } }],
    });
    facade = TestBed.inject(BroadcastFacade);
  });

  it('normalizes and deduplicates recipients before crossing IPC', async () => {
    const result = await facade.send({
      broadcastId: 'broadcast-1',
      accountId: 'operator@example.invalid',
      mode: 'normal',
      body: ' hola ',
      recipientJids: ['One@Example.invalid/resource', 'one@example.invalid', 'two@example.invalid'],
    });

    expect(result.recipients.map((item) => item.recipientJid)).toEqual([
      'one@example.invalid',
      'two@example.invalid',
    ]);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { kind: 'text', text: 'hola' },
        recipientJids: ['one@example.invalid', 'two@example.invalid'],
      }),
    );
  });

  it('does not send alert mode through the normal transport', async () => {
    const result = await facade.send({
      broadcastId: 'broadcast-2',
      accountId: 'operator@example.invalid',
      mode: 'alert',
      body: 'hola',
      recipientJids: ['one@example.invalid'],
    });
    expect(result.recipients[0].status).toBe('failed');
    expect(result.recipients[0].errorCode).toBe('UNSUPPORTED');
    expect(send).not.toHaveBeenCalled();
  });

  it('normalizes a resource-bearing jid', () => {
    expect(bareBroadcastJid(' User@Example.invalid/desktop ')).toBe('user@example.invalid');
  });
});
