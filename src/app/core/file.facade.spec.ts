import { TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FileTransfer, TypedDomainEvent } from './domain';
import { FileFacade } from './file.facade';
import { FILE_TRANSFER_PORT, FileTransferPort } from './ports';

const ok = <T>(value: T) => ({ ok: true as const, value, version: 1 as const, requestId: 'test' });
const transfer = (accountId: string, transferId: string): FileTransfer => ({
  offer: {
    transferId,
    accountId,
    conversationId: 'contact@example.invalid',
    senderJid: 'sender@example.invalid',
    name: 'fixture.txt',
    sizeBytes: '12',
    transport: 'ibb',
    offeredAt: '2026-01-01T00:00:00.000Z',
  },
  direction: 'incoming',
  state: 'offered',
  bytesTransferred: '0',
  updatedAt: '2026-01-01T00:00:00.000Z',
});

describe('FileFacade injected transfer port', () => {
  let port: FileTransferPort;
  let emit: (event: TypedDomainEvent) => void;
  let unsubscribeCalled: boolean;

  beforeEach(() => {
    unsubscribeCalled = false;
    port = {
      send: vi.fn(async () => ok<FileTransfer | null>(null)),
      accept: vi.fn(async () => ok(transfer('a@example.invalid', 'incoming'))),
      reject: vi.fn(async () => ok(transfer('a@example.invalid', 'incoming'))),
      cancel: vi.fn(async () => ok(transfer('a@example.invalid', 'incoming'))),
      listActive: vi.fn(async () =>
        ok<ReadonlyArray<FileTransfer>>([transfer('a@example.invalid', 'incoming')]),
      ),
      subscribe: vi.fn((listener: (event: TypedDomainEvent) => void) => {
        emit = listener;
        return () => {
          unsubscribeCalled = true;
        };
      }),
    };
    TestBed.configureTestingModule({
      providers: [{ provide: FILE_TRANSFER_PORT, useValue: port }],
    });
  });

  it('routes send, accept, reject and cancel through the injected port', async () => {
    const facade = TestBed.inject(FileFacade);
    await facade.setAccount('a@example.invalid');
    expect(facade.transfers()).toHaveLength(1);
    await facade.accept('incoming');
    await facade.reject('incoming');
    await facade.cancel('incoming');
    await facade.send('contact@example.invalid');
    expect(port.accept).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'a@example.invalid', transferId: 'incoming' }),
    );
    expect(port.reject).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'a@example.invalid', transferId: 'incoming' }),
    );
    expect(port.cancel).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: 'a@example.invalid', transferId: 'incoming' }),
    );
    expect(port.send).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'a@example.invalid',
        conversationId: 'contact@example.invalid',
      }),
    );
  });

  it('ignores a late listActive result after changing account', async () => {
    let release!: (result: ReturnType<typeof ok<ReadonlyArray<FileTransfer>>>) => void;
    (port.listActive as ReturnType<typeof vi.fn>).mockImplementation(
      (input: { accountId: string }) =>
        input.accountId === 'a@example.invalid'
          ? new Promise((resolve) => {
              release = resolve;
            })
          : Promise.resolve(ok<ReadonlyArray<FileTransfer>>([])),
    );
    const facade = TestBed.inject(FileFacade);
    const first = facade.setAccount('a@example.invalid');
    await Promise.resolve();
    await facade.setAccount('b@example.invalid');
    release(ok([transfer('a@example.invalid', 'late')]));
    await first;
    expect(facade.transfers()).toEqual([]);
  });

  it('ignores transfer events belonging to another account', async () => {
    const facade = TestBed.inject(FileFacade);
    await facade.setAccount('a@example.invalid');
    emit({
      version: 1,
      eventId: 'foreign-transfer',
      type: 'file.stateChanged',
      payload: transfer('b@example.invalid', 'foreign'),
    });
    expect(facade.transfers().map((item) => item.offer.transferId)).toEqual(['incoming']);
    emit({
      version: 1,
      eventId: 'owned-transfer',
      type: 'file.stateChanged',
      payload: transfer('a@example.invalid', 'owned'),
    });
    expect(facade.transfers().map((item) => item.offer.transferId)).toEqual(['incoming', 'owned']);
  });

  it('unsubscribes from transfer events when destroyed', () => {
    TestBed.inject(FileFacade);
    TestBed.resetTestingModule();
    expect(unsubscribeCalled).toBe(true);
  });
});
