import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BroadcastCoordinator } from './broadcast.coordinator';
import type { BroadcastRequest, BroadcastResult, Contact } from '../domain';

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

function result(recipients: BroadcastResult['recipients']): BroadcastResult {
  return { broadcastId: 'broadcast-1', recipients };
}

describe('BroadcastCoordinator', () => {
  let accountId: string;
  let connected: boolean;
  let contacts: Contact[];
  let send: (request: BroadcastRequest) => Promise<BroadcastResult>;
  let coordinator: BroadcastCoordinator;

  beforeEach(() => {
    accountId = 'me@example.invalid';
    connected = true;
    contacts = [
      {
        jid: 'me@example.invalid/resource',
        groups: ['self'],
        source: 'roster',
      },
      {
        jid: 'one@example.invalid/desktop',
        name: 'Uno',
        groups: ['team'],
        source: 'roster',
      },
      {
        jid: 'one@example.invalid/mobile',
        groups: ['alerts'],
        source: 'roster',
      },
      {
        jid: 'conversation@example.invalid',
        groups: ['ignored'],
        source: 'conversation',
      },
    ];
    send = vi.fn(async (_request: BroadcastRequest): Promise<BroadcastResult> =>
      result([
        {
          recipientJid: 'one@example.invalid',
          clientMessageId: 'client-1',
          status: 'submitted',
        },
      ]),
    );
    coordinator = new BroadcastCoordinator({
      sender: { send },
      accountId: () => accountId,
      isConnected: () => connected,
      contacts: () => contacts,
    });
  });

  it('reconciles contacts by bare JID and groups without including the account', () => {
    expect(coordinator.contacts()).toEqual([
      {
        jid: 'one@example.invalid',
        name: 'Uno',
        groups: ['team', 'alerts'],
        source: 'roster',
      },
    ]);
    expect(coordinator.groups()).toEqual(['alerts', 'team']);
  });

  it('exposes the complete broadcast dialog model', () => {
    coordinator.openDialog();
    expect(coordinator.dialogModel()).toMatchObject({
      contacts: coordinator.contacts(),
      groups: coordinator.groups(),
      selectedJids: new Set<string>(),
      body: '',
      mode: 'normal',
      hideOffline: false,
      busy: false,
      error: null,
      result: null,
    });
  });

  it('validates body, recipients and connection before sending', async () => {
    coordinator.openDialog();
    await coordinator.submit();
    expect(coordinator.error()).toBe('Escribe un mensaje antes de difundirlo.');
    coordinator.body.set('hola');
    await coordinator.submit();
    expect(coordinator.error()).toBe('Selecciona al menos un destinatario válido.');
    coordinator.toggleAll();
    connected = false;
    await coordinator.submit();
    expect(coordinator.error()).toBe('La cuenta no está conectada.');
    expect(send).not.toHaveBeenCalled();
  });

  it('sends the selected recipients and closes after a complete result', async () => {
    coordinator.openDialog();
    coordinator.body.set('  hola  ');
    coordinator.toggleContact('one@example.invalid');

    await expect(coordinator.submit()).resolves.toBe(true);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'me@example.invalid',
        body: 'hola',
        recipientJids: ['one@example.invalid'],
      }),
    );
    expect(coordinator.open()).toBe(false);
    expect(coordinator.busy()).toBe(false);
  });

  it('ignores a result that arrives after account cancellation', async () => {
    const pending = deferred<BroadcastResult>();
    vi.mocked(send).mockReturnValueOnce(pending.promise);
    coordinator.openDialog();
    coordinator.body.set('hola');
    coordinator.toggleAll();
    const submission = coordinator.submit();

    coordinator.cancelForAccount();
    pending.resolve(
      result([
        {
          recipientJid: 'one@example.invalid',
          clientMessageId: 'client-late',
          status: 'submitted',
        },
      ]),
    );

    await expect(submission).resolves.toBe(false);
    expect(coordinator.result()).toBeNull();
    expect(coordinator.open()).toBe(false);
    expect(coordinator.busy()).toBe(false);
  });

  it('invalidates a pending result when the coordinator is destroyed', async () => {
    const pending = deferred<BroadcastResult>();
    vi.mocked(send).mockReturnValueOnce(pending.promise);
    coordinator.openDialog();
    coordinator.body.set('hola');
    coordinator.toggleAll();
    const submission = coordinator.submit();

    coordinator.destroy();
    pending.resolve(
      result([
        {
          recipientJid: 'one@example.invalid',
          clientMessageId: 'client-destroyed',
          status: 'submitted',
        },
      ]),
    );

    await expect(submission).resolves.toBe(false);
    expect(coordinator.result()).toBeNull();
    expect(coordinator.open()).toBe(false);
    expect(coordinator.busy()).toBe(false);
  });

  it('retries only failed recipients from the previous attempt', async () => {
    vi.mocked(send).mockResolvedValueOnce(
      result([
        {
          recipientJid: 'one@example.invalid',
          clientMessageId: 'client-failed',
          status: 'failed',
          errorCode: 'TRANSPORT_FAILED',
        },
      ]),
    );
    coordinator.openDialog();
    coordinator.body.set('hola');
    coordinator.toggleAll();
    await expect(coordinator.submit()).resolves.toBe(false);
    expect(coordinator.open()).toBe(true);

    vi.mocked(send).mockResolvedValueOnce(
      result([
        {
          recipientJid: 'one@example.invalid',
          clientMessageId: 'client-retry',
          status: 'submitted',
        },
      ]),
    );
    await expect(coordinator.retryFailed()).resolves.toBe(true);
    expect(send).toHaveBeenLastCalledWith(
      expect.objectContaining({ recipientJids: ['one@example.invalid'] }),
    );
    expect(coordinator.open()).toBe(false);
  });
});
