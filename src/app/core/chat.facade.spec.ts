import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ChatFacade } from './chat.facade';
import { CertificateTrustRequest } from './domain';
import { ACCOUNT_PORT, CERTIFICATE_PORT, HISTORY_PORT, PREFERENCES_PORT, XMPP_PORT } from './ports';

const ok = <T>(value: T) => ({ ok: true as const, value, version: 1 as const, requestId: 'test' });
const historyMessage = (accountId: string, conversationId: string, index: number) => ({
  id: `message-${index}`,
  accountId,
  conversationId,
  clientMessageId: `client-${index}`,
  senderJid: conversationId,
  body: { kind: 'text' as const, text: String(index) },
  status: 'sent' as const,
  createdAt: new Date(1700000000000 + index).toISOString(),
});

describe('ChatFacade roster reconciliation', () => {
  let port: any;
  let history: Record<string, any[]>;
  let historyPort: any;
  let preferencesPort: any;
  let certificatePort: any;
  let emitEvent: (event: unknown) => void;
  beforeEach(() => {
    history = {
      'a@example.invalid': [
        { accountId: 'a@example.invalid', jid: 'old@example.invalid', lastActivity: '2026-01-01' },
      ],
      'b@example.invalid': [],
    };
    port = {
      connect: async (input: any) =>
        ok({
          accountId: input.accountId,
          status: 'connected',
          retryable: false,
          since: new Date().toISOString(),
        }),
      disconnect: async () => ok(undefined),
      getState: async () => ok({}),
      setPresence: async (input: any) =>
        ok({ jid: input.accountId, ...input, updatedAt: new Date().toISOString() }),
      listRoster: async (accountId: string) =>
        ok(
          accountId === 'a@example.invalid'
            ? [
                {
                  jid: 'keep@example.invalid/desktop',
                  name: 'Keep',
                  groups: ['g'],
                  subscription: 'both',
                  ask: 'subscribe',
                  source: 'roster',
                },
              ]
            : [],
        ),
      sendMessage: async () => ok({}),
      subscribe: (listener: (event: unknown) => void) => {
        emitEvent = listener;
        return () => undefined;
      },
    };
    historyPort = {
      list: async () => ok([]),
      listPage: async () => ok({ items: [], nextCursor: null, hasMore: false }),
      conversations: async (input: any) => ok(history[input.accountId]),
    };
    preferencesPort = {
      get: async () => ok({ theme: 'atomic', notifications: true, autoLogin: false }),
      update: vi.fn(async () => ok({})),
      reset: vi.fn(async () => ok({ theme: 'atomic', notifications: true, autoLogin: false })),
    };
    certificatePort = { decide: vi.fn(async () => ok(undefined)) };
    TestBed.configureTestingModule({
      providers: [
        { provide: XMPP_PORT, useValue: port },
        {
          provide: ACCOUNT_PORT,
          useValue: {
            getConfig: () => ({
              accountId: 'a@example.invalid',
              endpoint: {
                host: 'example.invalid',
                port: 5222,
                tls: true,
                domain: 'example.invalid',
                allowInsecureTls: false,
              },
            }),
            setSecret: async () => ok({ stored: true }),
          },
        },
        { provide: HISTORY_PORT, useValue: historyPort },
        { provide: PREFERENCES_PORT, useValue: preferencesPort },
        { provide: CERTIFICATE_PORT, useValue: certificatePort },
      ],
    });
  });

  it('isolates A, restores A, and preserves local history after roster removal', async () => {
    const facade = TestBed.inject(ChatFacade);
    await facade.connect('a@example.invalid');
    expect(facade.contacts().map((contact) => contact.jid)).toEqual([
      'keep@example.invalid',
      'old@example.invalid',
    ]);
    expect(facade.contacts()[0].subscription).toBe('both');
    await facade.connect('b@example.invalid');
    expect(facade.contacts()).toEqual([]);
    await facade.connect('a@example.invalid');
    expect(facade.contacts().map((contact) => contact.jid)).toEqual([
      'keep@example.invalid',
      'old@example.invalid',
    ]);
    port.listRoster = async () => ok([]);
    await facade.refreshRoster();
    expect(facade.contacts().map((contact) => contact.jid)).toEqual(['old@example.invalid']);
  });

  it('does not apply a stale roster result after the active account changes', async () => {
    let release!: (value: any) => void;
    port.listRoster = (accountId: string) =>
      accountId === 'a@example.invalid'
        ? new Promise((resolve) => {
            release = resolve;
          })
        : Promise.resolve(ok([]));
    const facade = TestBed.inject(ChatFacade);
    const first = facade.connect('a@example.invalid');
    await Promise.resolve();
    await facade.connect('b@example.invalid');
    release(ok([{ jid: 'late@example.invalid', name: 'late', groups: [] }]));
    await first;
    expect(facade.accountId()).toBe('b@example.invalid');
    expect(facade.contacts()).toEqual([]);
  });

  it('uses injected preferences and certificate ports for autologin and decisions', async () => {
    preferencesPort.get = vi.fn(async () =>
      ok({ theme: 'atomic', notifications: false, autoLogin: true }),
    );
    const facade = TestBed.inject(ChatFacade);
    await facade.tryAutoLogin();
    expect(facade.preferences().notifications).toBe(false);
    await facade.updatePreferences({ notifications: true });
    await facade.resetPreferences();
    expect(preferencesPort.update).toHaveBeenCalledWith({
      accountId: 'a@example.invalid',
      changes: { notifications: true },
    });
    expect(preferencesPort.reset).toHaveBeenCalledWith({ accountId: 'a@example.invalid' });
    const request = {
      requestId: 'certificate-request',
      accountId: 'a@example.invalid',
      host: 'example.invalid',
      port: 5222,
      transport: 'starttls' as const,
      certificate: {
        fingerprintSha256: 'AA',
        subject: 'CN=example.invalid',
        issuer: 'CA',
        validFrom: '2026-01-01',
        validTo: '2027-01-01',
        subjectAltNames: [],
        chain: [],
        pem: 'pem',
      },
    } satisfies CertificateTrustRequest;
    emitEvent({
      version: 1,
      eventId: 'certificate-event',
      type: 'certificate.trustRequired',
      payload: request,
    });
    await facade.decideCertificate('trust_once');
    expect(certificatePort.decide).toHaveBeenCalledWith(
      expect.objectContaining({ requestId: 'certificate-request', decision: 'trust_once' }),
    );
  });

  it('walks a 10000-message history in both directions with a bounded window', async () => {
    const accountId = 'a@example.invalid';
    const conversationId = 'history@example.invalid';
    const all = Array.from({ length: 10000 }, (_, index) =>
      historyMessage(accountId, conversationId, index),
    );
    const page = (input: {
      direction: 'older' | 'newer';
      cursor?: string | null;
      limit: number;
    }) => {
      const initial = !input.cursor;
      const cursor = input.cursor
        ? input.cursor.split(':').map(Number)
        : [Math.max(0, all.length - input.limit), all.length];
      const start = initial
        ? Math.max(0, all.length - input.limit)
        : input.direction === 'older'
          ? Math.max(0, cursor[0] - input.limit)
          : cursor[1];
      const end = initial
        ? all.length
        : input.direction === 'older'
          ? cursor[0]
          : Math.min(all.length, cursor[1] + input.limit);
      const items = all.slice(start, end);
      return ok({
        items,
        nextCursor: items.length ? `${start}:${end}` : null,
        hasMore: input.direction === 'older' ? start > 0 : end < all.length,
      });
    };
    historyPort.listPage = async (input: any) => page(input);
    const facade = TestBed.inject(ChatFacade);
    await facade.loadConversation(conversationId);
    expect(facade.messages().map((message) => message.id)).toEqual(
      all.slice(all.length - 50).map((message) => message.id),
    );
    for (let index = 0; index < 199; index += 1) await facade.loadOlderMessages(conversationId);
    expect(facade.messages()).toHaveLength(200);
    expect(facade.messages()[0].id).toBe('message-0');
    expect(facade.hasOlderMessages()).toBe(false);
    expect(facade.hasNewerMessages()).toBe(true);
    for (let index = 0; index < 199; index += 1) await facade.loadNewerMessages(conversationId);
    expect(facade.messages()).toHaveLength(200);
    expect(facade.messages().at(-1)?.id).toBe('message-9999');
    expect(new Set(facade.messages().map((message) => message.id)).size).toBe(200);
  });

  it('invalidates a pending conversation response', async () => {
    let releaseFirst!: (value: any) => void;
    let releaseSecond!: (value: any) => void;
    let calls = 0;
    historyPort.listPage = () =>
      new Promise((resolve) => {
        calls += 1;
        if (calls === 1) releaseFirst = resolve;
        else releaseSecond = resolve;
      }) as any;
    const facade = TestBed.inject(ChatFacade);
    const pending = facade.loadConversation('first@example.invalid');
    await Promise.resolve();
    const second = facade.loadConversation('second@example.invalid');
    releaseFirst(
      ok({
        items: [historyMessage('a@example.invalid', 'first@example.invalid', 1)],
        nextCursor: null,
        hasMore: false,
      }),
    );
    await pending;
    expect(facade.messages()).toEqual([]);
    expect(facade.historyLoading()).toBe(true);
    releaseSecond(ok({ items: [], nextCursor: null, hasMore: false }));
    await second;
    expect(facade.historyLoading()).toBe(false);
  });
});
