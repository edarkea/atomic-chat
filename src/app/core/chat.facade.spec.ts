import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ChatFacade } from './chat.facade';
import { CertificateTrustRequest } from './domain';
import { ActiveConversationStore } from './active-conversation.store';
import { WindowFocusStore } from './window-focus.store';
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
  let accountPort: any;
  let emitEvent: (event: unknown) => void;
  beforeEach(() => {
    history = {
      'a@example.invalid': [
        { accountId: 'a@example.invalid', jid: 'old@example.invalid', lastActivity: '2026-01-01' },
      ],
      'b@example.invalid': [],
    };
    port = {
      connect: vi.fn(async (input: any) =>
        ok({
          accountId: input.accountId,
          status: 'connected',
          retryable: false,
          since: new Date().toISOString(),
        }),
      ),
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
    accountPort = {
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
      setSecret: vi.fn(async () => ok({ stored: true })),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: XMPP_PORT, useValue: port },
        { provide: ACCOUNT_PORT, useValue: accountPort },
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

  it('requires a new secret when remember is explicitly disabled', async () => {
    const facade = TestBed.inject(ChatFacade);
    const profile = {
      accountId: 'a@example.invalid',
      domain: 'example.invalid',
      mode: 'automatic' as const,
      updatedAt: '2026-10-29',
      hasPersistentCredential: true,
    };
    facade.profiles.set([profile]);
    const result = await facade.connect('a@example.invalid', '', {
      profile,
      domain: profile.domain,
      remember: false,
      autoLogin: false,
      autoLoginExplicit: true,
    });
    expect(result).toBe(false);
    expect(accountPort.setSecret).not.toHaveBeenCalled();
    expect(port.connect).not.toHaveBeenCalled();
    expect(facade.error()).toContain('Introduce la contraseña');
  });

  it('stores a new temporary secret before connecting and revokes persistent metadata', async () => {
    const facade = TestBed.inject(ChatFacade);
    const profile = {
      accountId: 'a@example.invalid',
      domain: 'example.invalid',
      mode: 'automatic' as const,
      updatedAt: '2026-10-29',
      hasPersistentCredential: true,
    };
    facade.profiles.set([profile]);
    const result = await facade.connect('a@example.invalid', 'temporary', {
      profile,
      domain: profile.domain,
      remember: false,
      autoLogin: true,
      autoLoginExplicit: true,
    });
    expect(result).toBe(true);
    expect(accountPort.setSecret).toHaveBeenCalledWith(
      expect.objectContaining({
        accountId: 'a@example.invalid',
        credentialRef: 'account:a@example.invalid',
        secret: 'temporary',
        remember: false,
      }),
    );
    expect(port.connect).toHaveBeenCalledOnce();
    expect(facade.profiles()[0].hasPersistentCredential).toBe(false);
    expect(preferencesPort.update).toHaveBeenCalledWith({
      accountId: 'a@example.invalid',
      changes: { autoLogin: false },
    });
  });

  it('reuses a persistent credential only for an explicitly remembered profile', async () => {
    const facade = TestBed.inject(ChatFacade);
    const profile = {
      accountId: 'a@example.invalid',
      domain: 'example.invalid',
      mode: 'automatic' as const,
      updatedAt: '2026-10-29',
      hasPersistentCredential: true,
    };
    facade.profiles.set([profile]);
    const result = await facade.connect('a@example.invalid', '', {
      profile,
      domain: profile.domain,
      remember: true,
      autoLogin: true,
      autoLoginExplicit: true,
    });
    expect(result).toBe(true);
    expect(accountPort.setSecret).not.toHaveBeenCalled();
    expect(port.connect).toHaveBeenCalledOnce();
  });

  it('preserves pending messages across a temporary connection loss', async () => {
    const facade = TestBed.inject(ChatFacade);
    await facade.connect('a@example.invalid');
    emitEvent({
      type: 'message.received',
      payload: historyMessage('a@example.invalid', 'new@example.invalid', 99),
    });
    expect(facade.unreadTotal()).toBe(1);
    emitEvent({
      type: 'connection.stateChanged',
      payload: {
        accountId: 'a@example.invalid',
        status: 'failed',
        retryable: true,
        since: new Date().toISOString(),
      },
    });
    expect(facade.unreadTotal()).toBe(1);
  });

  it('counts a direct message for the selected conversation while the window is unfocused', async () => {
    const facade = TestBed.inject(ChatFacade);
    const active = TestBed.inject(ActiveConversationStore);
    const focus = TestBed.inject(WindowFocusStore);
    await facade.connect('a@example.invalid');
    active.set({ accountId: 'a@example.invalid', kind: 'direct', jid: 'new@example.invalid' });
    focus.isFocused.set(false);

    emitEvent({
      type: 'message.received',
      payload: historyMessage('a@example.invalid', 'new@example.invalid', 100),
    });

    expect(facade.unreadCounts().get('a@example.invalid|direct|new@example.invalid')).toBe(1);
  });

  it('keeps a direct conversation unread when a MUC is the active conversation', async () => {
    const facade = TestBed.inject(ChatFacade);
    const active = TestBed.inject(ActiveConversationStore);
    const focus = TestBed.inject(WindowFocusStore);
    await facade.connect('a@example.invalid');
    active.set({ accountId: 'a@example.invalid', kind: 'muc', jid: 'room@conference.example.invalid' });
    focus.isFocused.set(true);

    emitEvent({
      type: 'message.received',
      payload: historyMessage('a@example.invalid', 'contact@example.invalid', 101),
    });

    expect(facade.unreadCounts().get('a@example.invalid|direct|contact@example.invalid')).toBe(1);
  });
});

describe('ChatFacade login profile safety', () => {
  it('skips autologin for a legacy profile without a persisted domain', async () => {
    const connect = vi.fn(async () =>
      ok({
        accountId: 'juan',
        status: 'connected' as const,
        retryable: false,
        since: new Date().toISOString(),
      }),
    );
    await TestBed.configureTestingModule({
      providers: [
        {
          provide: ACCOUNT_PORT,
          useValue: {
            getConfig: () => undefined,
            listProfiles: async () =>
              ok([
                {
                  accountId: 'juan',
                  domain: '',
                  mode: 'manual' as const,
                  updatedAt: '2026-10-29',
                  hasPersistentCredential: true,
                },
              ]),
          },
        },
        {
          provide: XMPP_PORT,
          useValue: {
            connect,
            disconnect: async () => ok(undefined),
            getState: async () => ok({}),
            setPresence: async () => ok({}),
            listRoster: async () => ok([]),
            sendMessage: async () => ok({}),
            subscribe: () => () => undefined,
          },
        },
        {
          provide: HISTORY_PORT,
          useValue: {
            list: async () => ok([]),
            listPage: async () => ok({}),
            conversations: async () => ok([]),
          },
        },
        {
          provide: PREFERENCES_PORT,
          useValue: {
            get: async () => ok({ theme: 'atomic' as const, notifications: true, autoLogin: true }),
            update: async () => ok({}),
            reset: async () =>
              ok({ theme: 'atomic' as const, notifications: true, autoLogin: false }),
          },
        },
        { provide: CERTIFICATE_PORT, useValue: { decide: async () => ok(undefined) } },
      ],
    }).compileComponents();
    const facade = TestBed.inject(ChatFacade);
    await facade.tryAutoLogin();
    expect(connect).not.toHaveBeenCalled();
  });
});
