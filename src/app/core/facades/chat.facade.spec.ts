import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { ChatFacade } from './chat.facade';
import { CertificateTrustRequest, Message } from '../domain';
import { ActiveConversationStore } from '../stores/active-conversation.store';
import { UnreadStore } from '../stores/unread.store';
import { WindowFocusStore } from '../stores/window-focus.store';
import {
  ACCOUNT_PORT,
  CERTIFICATE_PORT,
  HISTORY_PORT,
  PREFERENCES_PORT,
  XMPP_PORT,
  type HistoryPort,
  type PreferencesPort,
  type XmppPort,
} from '../ports';

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
  let port: {
    connect(input: Parameters<XmppPort['connect']>[0]): Promise<unknown>;
    disconnect(accountId: string): Promise<unknown>;
    getState(accountId: string): Promise<unknown>;
    setPresence(input: Parameters<XmppPort['setPresence']>[0]): Promise<unknown>;
    listRoster(accountId: string): Promise<unknown>;
    sendMessage(input: Parameters<XmppPort['sendMessage']>[0]): Promise<unknown>;
    sendReaction(input: Parameters<XmppPort['sendReaction']>[0]): Promise<unknown>;
    sendChatState?: (
      input: Parameters<NonNullable<XmppPort['sendChatState']>>[0],
    ) => Promise<unknown>;
    subscribe(listener: (event: unknown) => void): () => void;
  };
  let history: Record<string, Array<{ accountId: string; jid: string; lastActivity: string }>>;
  let historyPort: {
    list: () => Promise<unknown>;
    listPage: (input: Parameters<HistoryPort['listPage']>[0]) => Promise<unknown>;
    search?: (...args: never[]) => Promise<unknown>;
    around?: (...args: never[]) => Promise<unknown>;
    timelinePage?: (...args: never[]) => Promise<unknown>;
    conversations: (input: Parameters<HistoryPort['conversations']>[0]) => Promise<unknown>;
  };
  let preferencesPort: {
    get: (input: Parameters<PreferencesPort['get']>[0]) => Promise<unknown>;
    update: (input: Parameters<PreferencesPort['update']>[0]) => Promise<unknown>;
    reset: (input: Parameters<PreferencesPort['reset']>[0]) => Promise<unknown>;
    selectDownloadDirectory: () => Promise<unknown>;
  };
  let certificatePort: { decide: (...args: never[]) => Promise<unknown> };
  let accountPort: { getConfig: () => unknown; setSecret: (...args: never[]) => Promise<unknown> };
  let emitEvent: (event: unknown) => void;
  beforeEach(() => {
    history = {
      'a@example.invalid': [
        { accountId: 'a@example.invalid', jid: 'old@example.invalid', lastActivity: '2026-01-01' },
      ],
      'b@example.invalid': [],
    };
    port = {
      connect: vi.fn(async (input: Parameters<XmppPort['connect']>[0]) =>
        ok({
          accountId: input.accountId,
          status: 'connected',
          retryable: false,
          since: new Date().toISOString(),
        }),
      ),
      disconnect: async () => ok(undefined),
      getState: async () => ok({}),
      setPresence: async (input: Parameters<XmppPort['setPresence']>[0]) =>
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
      sendReaction: vi.fn(async () => ok(undefined)),
      subscribe: (listener: (event: unknown) => void) => {
        emitEvent = listener;
        return () => undefined;
      },
    };
    historyPort = {
      list: async () => ok([]),
      listPage: async () => ok({ items: [], nextCursor: null, hasMore: false }),
      conversations: async (input: Parameters<HistoryPort['conversations']>[0]) =>
        ok(history[input.accountId]),
    };
    preferencesPort = {
      get: async () =>
        ok({
          theme: 'atomic',
          notifications: true,
          autoAcceptFileTransfers: false,
          autoLogin: false,
          hideClosedConversations: false,
          fileTransferTimeoutSeconds: 300,
          downloadDirectory: '',
        }),
      update: vi.fn(async () => ok({})),
      selectDownloadDirectory: vi.fn(async () => ok(null)),
      reset: vi.fn(async () =>
        ok({
          theme: 'atomic',
          notifications: true,
          autoAcceptFileTransfers: false,
          autoLogin: false,
          hideClosedConversations: false,
          fileTransferTimeoutSeconds: 300,
          downloadDirectory: '',
        }),
      ),
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

  it('reconciles roster subscription downgrade without retaining unauthorized presence', async () => {
    const facade = TestBed.inject(ChatFacade);
    await facade.connect('a@example.invalid');
    emitEvent({
      type: 'presence.changed',
      payload: {
        accountId: 'a@example.invalid',
        jid: 'keep@example.invalid',
        availability: 'available',
        updatedAt: new Date().toISOString(),
      },
    });
    expect(facade.contacts()[0].presence?.availability).toBe('available');

    port.listRoster = vi.fn(async () =>
      ok([
        {
          jid: 'KEEP@example.invalid/mobile',
          name: 'Renamed',
          groups: [],
          subscription: 'from',
          source: 'roster',
        },
      ]),
    );
    await facade.refreshRoster();

    const contact = facade.contacts().find((item) => item.jid === 'keep@example.invalid');
    expect(contact?.name).toBe('Renamed');
    expect(contact?.presence?.availability).toBe('unknown');
    expect(facade.contacts().some((item) => item.jid === 'old@example.invalid')).toBe(true);
  });

  it('keeps rapid reaction updates as the latest complete actor set', async () => {
    const facade = TestBed.inject(ChatFacade);
    await facade.connect('a@example.invalid');
    facade.messages.set([
      historyMessage('a@example.invalid', 'friend@example.invalid', 1),
    ] as unknown as Message[]);

    const first = facade.sendReaction('friend@example.invalid', 'message-1', ['👍']);
    const second = facade.sendReaction('friend@example.invalid', 'message-1', ['👍', '❤️']);
    expect(
      facade
        .reactionFor('friend@example.invalid', 'message-1')
        ?.reactions.map((item) => item.emoji),
    ).toEqual(['👍', '❤️']);
    await Promise.all([first, second]);
    expect(
      facade
        .reactionFor('friend@example.invalid', 'message-1')
        ?.reactions.map((item) => item.emoji),
    ).toEqual(['👍', '❤️']);
  });

  it('does not apply a stale roster result after the active account changes', async () => {
    type RosterResult = Awaited<ReturnType<XmppPort['listRoster']>>;
    let release!: (value: RosterResult) => void;
    port.listRoster = (accountId: string) =>
      accountId === 'a@example.invalid'
        ? new Promise<RosterResult>((resolve) => {
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

  it('invalidates a pending connection when the session is disconnected', async () => {
    let releaseConnect!: (value: Awaited<ReturnType<XmppPort['connect']>>) => void;
    port.connect = () =>
      new Promise((resolve) => {
        releaseConnect = resolve;
      });
    const facade = TestBed.inject(ChatFacade);
    const pending = facade.connect('a@example.invalid');
    await Promise.resolve();

    await facade.disconnect();
    releaseConnect(
      ok({
        accountId: 'a@example.invalid',
        status: 'connected' as const,
        retryable: false,
        since: new Date().toISOString(),
      }),
    );

    await expect(pending).resolves.toBe(false);
    expect(facade.connection().status).toBe('idle');
  });

  it('ignores late connection events after disconnect and accepts a later reconnect', async () => {
    const facade = TestBed.inject(ChatFacade);
    await facade.connect('a@example.invalid');
    await facade.disconnect();

    emitEvent({
      type: 'connection.stateChanged',
      payload: {
        accountId: 'a@example.invalid',
        status: 'connected',
        retryable: false,
        since: new Date().toISOString(),
      },
    });
    expect(facade.connection().status).toBe('idle');

    await expect(facade.connect('a@example.invalid')).resolves.toBe(true);
    emitEvent({
      type: 'connection.stateChanged',
      payload: {
        accountId: 'a@example.invalid',
        status: 'failed',
        retryable: true,
        since: new Date().toISOString(),
      },
    });
    expect(facade.connection().status).toBe('failed');
  });

  it('ignores connection events from a previous account without changing the active session', async () => {
    const facade = TestBed.inject(ChatFacade);
    await facade.connect('a@example.invalid');
    await facade.connect('b@example.invalid');

    emitEvent({
      type: 'connection.stateChanged',
      payload: {
        accountId: 'a@example.invalid',
        status: 'failed',
        retryable: true,
        since: new Date().toISOString(),
      },
    });

    expect(facade.accountId()).toBe('b@example.invalid');
    expect(facade.connection().accountId).toBe('b@example.invalid');
    expect(facade.connection().status).toBe('connected');
  });

  it('accepts incoming messages after authentication while roster loading is pending', async () => {
    let releaseRoster!: (value: Awaited<ReturnType<XmppPort['listRoster']>>) => void;
    port.listRoster = () =>
      new Promise((resolve) => {
        releaseRoster = resolve;
      });
    const facade = TestBed.inject(ChatFacade);
    const pending = facade.connect('a@example.invalid');
    for (let attempt = 0; attempt < 10 && !releaseRoster; attempt += 1) await Promise.resolve();

    const incoming = historyMessage('a@example.invalid', 'roster-pending@example.invalid', 991);
    emitEvent({ type: 'message.received', payload: incoming });

    expect(facade.messages().some((message) => message.id === incoming.id)).toBe(true);
    expect(facade.unreadTotal()).toBe(1);
    releaseRoster(ok([]));
    await expect(pending).resolves.toBe(true);
  });

  it('accepts incoming messages while stored conversations are loading', async () => {
    let releaseConversations!: (
      value: Awaited<ReturnType<NonNullable<HistoryPort['conversations']>>>,
    ) => void;
    let conversationCalls = 0;
    historyPort.conversations = () => {
      conversationCalls += 1;
      if (conversationCalls === 1)
        return new Promise((resolve) => {
          releaseConversations = resolve;
        });
      return Promise.resolve(ok([]));
    };
    const facade = TestBed.inject(ChatFacade);
    const pending = facade.connect('a@example.invalid');
    for (let attempt = 0; attempt < 10 && !releaseConversations; attempt += 1)
      await Promise.resolve();

    const incoming = historyMessage('a@example.invalid', 'history-pending@example.invalid', 992);
    emitEvent({ type: 'message.received', payload: incoming });

    expect(facade.messages().some((message) => message.id === incoming.id)).toBe(true);
    releaseConversations(ok([]));
    await expect(pending).resolves.toBe(true);
  });

  it('accepts incoming messages while preferences are loading', async () => {
    let releasePreferences!: (
      value: Awaited<ReturnType<NonNullable<PreferencesPort['get']>>>,
    ) => void;
    preferencesPort.get = () =>
      new Promise((resolve) => {
        releasePreferences = resolve;
      });
    const facade = TestBed.inject(ChatFacade);
    const pending = facade.connect('a@example.invalid');
    for (let attempt = 0; attempt < 10 && !releasePreferences; attempt += 1)
      await Promise.resolve();

    const incoming = historyMessage(
      'a@example.invalid',
      'preferences-pending@example.invalid',
      993,
    );
    emitEvent({ type: 'message.received', payload: incoming });

    expect(facade.messages().some((message) => message.id === incoming.id)).toBe(true);
    releasePreferences(
      ok({
        theme: 'atomic',
        notifications: true,
        autoAcceptFileTransfers: false,
        autoLogin: false,
        hideClosedConversations: false,
        fileTransferTimeoutSeconds: 300,
        downloadDirectory: '',
      }),
    );
    await expect(pending).resolves.toBe(true);
  });

  it('returns false when roster loading finishes after disconnect', async () => {
    let releaseRoster!: (value: Awaited<ReturnType<XmppPort['listRoster']>>) => void;
    port.listRoster = () =>
      new Promise((resolve) => {
        releaseRoster = resolve;
      });
    const facade = TestBed.inject(ChatFacade);
    const pending = facade.connect('a@example.invalid');
    for (let attempt = 0; attempt < 10 && !releaseRoster; attempt += 1) await Promise.resolve();
    await facade.disconnect();
    releaseRoster(ok([]));

    await expect(pending).resolves.toBe(false);
  });

  it('returns false when stored conversations finish after disconnect', async () => {
    let releaseConversations!: (
      value: Awaited<ReturnType<NonNullable<HistoryPort['conversations']>>>,
    ) => void;
    let conversationCalls = 0;
    historyPort.conversations = () => {
      conversationCalls += 1;
      if (conversationCalls === 1)
        return new Promise((resolve) => {
          releaseConversations = resolve;
        });
      return Promise.resolve(ok([]));
    };
    const facade = TestBed.inject(ChatFacade);
    const pending = facade.connect('a@example.invalid');
    for (let attempt = 0; attempt < 10 && !releaseConversations; attempt += 1)
      await Promise.resolve();
    await facade.disconnect();
    releaseConversations(ok([]));

    await expect(pending).resolves.toBe(false);
  });

  it('returns false when preferences finish after disconnect', async () => {
    let releasePreferences!: (
      value: Awaited<ReturnType<NonNullable<PreferencesPort['get']>>>,
    ) => void;
    preferencesPort.get = () =>
      new Promise((resolve) => {
        releasePreferences = resolve;
      });
    const facade = TestBed.inject(ChatFacade);
    const pending = facade.connect('a@example.invalid');
    for (let attempt = 0; attempt < 10 && !releasePreferences; attempt += 1)
      await Promise.resolve();
    await facade.disconnect();
    releasePreferences(
      ok({
        theme: 'atomic',
        notifications: true,
        autoAcceptFileTransfers: false,
        autoLogin: false,
        hideClosedConversations: false,
        fileTransferTimeoutSeconds: 300,
        downloadDirectory: '',
      }),
    );

    await expect(pending).resolves.toBe(false);
  });

  it('ignores direct messages that arrive after the session is closed', async () => {
    const facade = TestBed.inject(ChatFacade);
    await facade.connect('a@example.invalid');
    await facade.disconnect();

    emitEvent({
      type: 'message.received',
      payload: historyMessage('a@example.invalid', 'late@example.invalid', 991),
    });

    expect(facade.messages()).toEqual([]);
    expect(facade.unreadTotal()).toBe(0);
  });

  it('uses injected preferences and certificate ports for autologin and decisions', async () => {
    preferencesPort.get = vi.fn(async () =>
      ok({
        theme: 'atomic',
        notifications: false,
        autoAcceptFileTransfers: false,
        autoLogin: true,
        hideClosedConversations: false,
        fileTransferTimeoutSeconds: 300,
        downloadDirectory: '',
      }),
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
    historyPort.listPage = async (input: Parameters<HistoryPort['listPage']>[0]) => page(input);
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

  it('discards a late older-page response after switching conversations', async () => {
    const accountId = 'a@example.invalid';
    const older = 'old@example.invalid';
    const newer = 'new@example.invalid';
    let resolveOldPage!: (value: ReturnType<typeof ok>) => void;
    historyPort.listPage = (input: { conversationId: string; cursor?: string | null }) => {
      if (input.conversationId === older && input.cursor === 'older-cursor')
        return new Promise((resolve) => {
          resolveOldPage = resolve as (value: ReturnType<typeof ok>) => void;
        });
      if (input.conversationId === older)
        return Promise.resolve(
          ok({
            items: [historyMessage(accountId, older, 1)],
            nextCursor: 'older-cursor',
            hasMore: true,
          }),
        );
      return Promise.resolve(
        ok({
          items: [historyMessage(accountId, newer, 2)],
          nextCursor: null,
          hasMore: false,
        }),
      );
    };
    const facade = TestBed.inject(ChatFacade);
    await facade.loadConversation(older);
    const pendingOldPage = facade.loadOlderMessages(older);
    expect(facade.historyLoading()).toBe(true);

    await facade.loadConversation(newer);
    expect(facade.messages().map((message) => message.id)).toEqual(['message-2']);
    expect(facade.historyLoading()).toBe(false);

    resolveOldPage(
      ok({
        items: [historyMessage(accountId, older, 0)],
        nextCursor: 'earlier-stale',
        hasMore: true,
      }),
    );
    await pendingOldPage;
    expect(facade.messages().map((message) => message.id)).toEqual(['message-2']);
    expect(facade.hasOlderMessages()).toBe(false);
    expect(facade.historyLoading()).toBe(false);
  });

  it('invalidates a pending conversation response', async () => {
    type HistoryPageResult = Awaited<ReturnType<HistoryPort['listPage']>>;
    let releaseFirst!: (value: HistoryPageResult) => void;
    let releaseSecond!: (value: HistoryPageResult) => void;
    let calls = 0;
    historyPort.listPage = () =>
      new Promise<HistoryPageResult>((resolve) => {
        calls += 1;
        if (calls === 1) releaseFirst = resolve;
        else releaseSecond = resolve;
      });
    const facade = TestBed.inject(ChatFacade);
    const pending = facade.loadConversation('first@example.invalid');
    await Promise.resolve();
    const firstGeneration = facade.initialHistory()?.generation;
    const second = facade.loadConversation('second@example.invalid');
    expect(facade.initialHistory()).toEqual({
      accountId: 'a@example.invalid',
      conversationId: 'second@example.invalid',
      generation: expect.any(Number),
      status: 'loading',
    });
    expect(facade.initialHistory()?.generation).toBeGreaterThan(firstGeneration ?? 0);
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
    expect(facade.initialHistory()).toMatchObject({
      conversationId: 'second@example.invalid',
      status: 'ready',
    });
  });

  it('ignores a stale timeline response after changing conversations', async () => {
    let releaseFirst!: (value: ReturnType<typeof ok>) => void;
    let releaseSecond!: (value: ReturnType<typeof ok>) => void;
    let calls = 0;
    historyPort.timelinePage = () =>
      new Promise((resolve) => {
        calls += 1;
        if (calls === 1) releaseFirst = resolve;
        else releaseSecond = resolve;
      }) as unknown as Promise<unknown>;
    const facade = TestBed.inject(ChatFacade);
    const first = facade.loadConversation('first@example.invalid');
    await Promise.resolve();
    const second = facade.loadConversation('second@example.invalid');
    await Promise.resolve();
    releaseFirst(
      ok({
        items: [
          {
            kind: 'text' as const,
            id: 'first-history',
            sortAt: '2026-01-01T00:00:00.000Z',
            message: historyMessage('a@example.invalid', 'first@example.invalid', 1),
          },
        ],
        nextCursor: null,
        hasMore: false,
      }),
    );
    await first;
    expect(facade.timelineItems()).toEqual([]);
    expect(facade.messages()).toEqual([]);
    expect(facade.historyLoading()).toBe(true);

    releaseSecond(
      ok({
        items: [
          {
            kind: 'text' as const,
            id: 'second-history',
            sortAt: '2026-01-02T00:00:00.000Z',
            message: historyMessage('a@example.invalid', 'second@example.invalid', 2),
          },
        ],
        nextCursor: null,
        hasMore: false,
      }),
    );
    await second;
    expect(facade.timelineItems().map((item) => item.id)).toEqual(['second-history']);
    expect(facade.messages().map((message) => message.id)).toEqual(['message-2']);
    expect(facade.historyLoading()).toBe(false);
  });

  it('keeps the timeline unavailable while a search hit replaces the initial page', async () => {
    historyPort.listPage = async () => ok({ items: [], nextCursor: null, hasMore: false });
    let releaseAround!: (value: ReturnType<typeof ok>) => void;
    historyPort.around = () =>
      new Promise((resolve) => {
        releaseAround = resolve as (value: ReturnType<typeof ok>) => void;
      });
    const facade = TestBed.inject(ChatFacade);
    const pending = facade.revealSearchHit({
      accountId: 'a@example.invalid',
      conversationId: 'search@example.invalid',
      messageId: 'message-1',
      senderJid: 'search@example.invalid',
      bodyPreview: 'resultado',
      createdAt: new Date(1700000000000).toISOString(),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(facade.initialHistory()).toMatchObject({
      conversationId: 'search@example.invalid',
      status: 'loading',
    });

    releaseAround(
      ok({
        items: [historyMessage('a@example.invalid', 'search@example.invalid', 1)],
        nextCursor: null,
        hasMore: false,
      }),
    );
    await pending;
    expect(facade.initialHistory()).toMatchObject({
      conversationId: 'search@example.invalid',
      status: 'ready',
    });
  });

  it('reconciles live message receipts without contaminating the selected conversation', async () => {
    const facade = TestBed.inject(ChatFacade);
    await facade.loadConversation('friend@example.invalid');

    const incoming = historyMessage('a@example.invalid', 'friend@example.invalid', 910);
    emitEvent({ type: 'message.received', payload: incoming });
    expect(facade.messages().map((item) => item.id)).toEqual(['message-910']);

    const acknowledged = { ...incoming, id: 'server-910', status: 'sent' as const };
    emitEvent({ type: 'message.stateChanged', payload: acknowledged });
    expect(facade.messages().map((item) => item.id)).toEqual(['server-910']);

    emitEvent({
      type: 'message.received',
      payload: historyMessage('a@example.invalid', 'other@example.invalid', 911),
    });
    expect(facade.messages().map((item) => item.id)).toEqual(['server-910']);
    expect(
      facade.conversationSummaries().some((summary) => summary.jid === 'other@example.invalid'),
    ).toBe(true);
  });

  it('keeps an incoming message that arrives while history is loading', async () => {
    let release!: (value: ReturnType<typeof ok>) => void;
    historyPort.listPage = () =>
      new Promise((resolve) => {
        release = resolve as (value: ReturnType<typeof ok>) => void;
      });
    const facade = TestBed.inject(ChatFacade);
    const pending = facade.loadConversation('sender@example.invalid');
    await Promise.resolve();
    emitEvent({
      type: 'message.received',
      payload: historyMessage('a@example.invalid', 'sender@example.invalid', 200),
    });
    release(ok({ items: [], nextCursor: null, hasMore: false }));
    await pending;
    expect(facade.messages().map((message) => message.clientMessageId)).toContain('client-200');
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
    await facade.connect('a@example.invalid');
    expect(facade.unreadTotal()).toBe(1);
  });

  it('preserves the public outbound typing API and deduplicates XMPP chat-state emissions', async () => {
    const sendChatState = vi.fn(async () => ok(undefined));
    port.sendChatState = sendChatState;
    const facade = TestBed.inject(ChatFacade);
    await facade.connect('a@example.invalid');

    await facade.updateTypingState('FRIEND@example.invalid/desktop', 'hola');
    await facade.updateTypingState('friend@example.invalid/phone', 'hola otra vez');

    expect(sendChatState).toHaveBeenCalledTimes(1);
    expect(sendChatState).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        accountId: 'a@example.invalid',
        conversationId: 'FRIEND@example.invalid/desktop',
        state: 'composing',
      }),
    );

    await facade.setTypingActivity('friend@example.invalid', 'inactive');
    expect(sendChatState).toHaveBeenCalledTimes(2);
    expect(sendChatState).toHaveBeenLastCalledWith(expect.objectContaining({ state: 'inactive' }));
    await facade.disconnect();
  });

  it('keeps incoming chat-state notifications scoped to the current account and clears on failure', async () => {
    const facade = TestBed.inject(ChatFacade);
    await facade.connect('a@example.invalid');

    emitEvent({
      type: 'chatState.changed',
      payload: {
        accountId: 'a@example.invalid',
        conversationId: 'FRIEND@example.invalid/desktop',
        senderJid: 'friend@example.invalid/phone',
        state: 'composing',
      },
    });
    expect(facade.chatStates().get('friend@example.invalid')).toBe('composing');

    emitEvent({
      type: 'chatState.changed',
      payload: {
        accountId: 'b@example.invalid',
        conversationId: 'other@example.invalid',
        senderJid: 'other@example.invalid',
        state: 'composing',
      },
    });
    emitEvent({
      type: 'chatState.changed',
      payload: {
        accountId: 'a@example.invalid',
        conversationId: 'a@example.invalid',
        senderJid: 'a@example.invalid/desktop',
        state: 'composing',
      },
    });
    expect([...facade.chatStates().keys()]).toEqual(['friend@example.invalid']);

    emitEvent({
      type: 'connection.stateChanged',
      payload: {
        accountId: 'a@example.invalid',
        status: 'failed',
        retryable: true,
        since: new Date().toISOString(),
      },
    });
    expect(facade.chatStates().size).toBe(0);
  });

  it('ignores remote presence events after roster authorization is lost', async () => {
    const facade = TestBed.inject(ChatFacade);
    await facade.connect('a@example.invalid');

    port.listRoster = vi.fn(async () =>
      ok([
        {
          jid: 'keep@example.invalid',
          name: 'Keep',
          groups: [],
          subscription: 'from',
          source: 'roster',
        },
      ]),
    );
    await facade.refreshRoster();
    const prior = facade.contacts().find((contact) => contact.jid === 'keep@example.invalid');
    expect(prior?.presence?.availability).toBe('unknown');

    emitEvent({
      type: 'presence.changed',
      payload: {
        accountId: 'a@example.invalid',
        jid: 'keep@example.invalid',
        availability: 'available',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    });

    const after = facade.contacts().find((contact) => contact.jid === 'keep@example.invalid');
    expect(after).toBe(prior);
    expect(after?.presence?.availability).toBe('unknown');

    emitEvent({
      type: 'presence.changed',
      payload: {
        accountId: 'b@example.invalid',
        jid: 'keep@example.invalid',
        availability: 'available',
        updatedAt: '2026-01-03T00:00:00.000Z',
      },
    });
    expect(facade.contacts().find((contact) => contact.jid === 'keep@example.invalid')).toBe(prior);
  });

  it('resets remote presence on session failure before the next session publishes fresh evidence', async () => {
    const facade = TestBed.inject(ChatFacade);
    await facade.connect('a@example.invalid');
    emitEvent({
      type: 'presence.changed',
      payload: {
        accountId: 'a@example.invalid',
        jid: 'keep@example.invalid',
        availability: 'available',
        updatedAt: new Date().toISOString(),
      },
    });
    expect(
      facade.contacts().find((contact) => contact.jid === 'keep@example.invalid')?.presence
        ?.availability,
    ).toBe('available');

    emitEvent({
      type: 'connection.stateChanged',
      payload: {
        accountId: 'a@example.invalid',
        status: 'failed',
        retryable: true,
        since: new Date().toISOString(),
      },
    });
    expect(
      facade.contacts().find((contact) => contact.jid === 'keep@example.invalid')?.presence
        ?.availability,
    ).toBe('unknown');
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
    active.set({
      accountId: 'a@example.invalid',
      kind: 'muc',
      jid: 'room@conference.example.invalid',
    });
    focus.isFocused.set(true);

    emitEvent({
      type: 'message.received',
      payload: historyMessage('a@example.invalid', 'contact@example.invalid', 101),
    });

    expect(facade.unreadCounts().get('a@example.invalid|direct|contact@example.invalid')).toBe(1);
  });

  it('does not acknowledge a pending direct message when history finishes unfocused', async () => {
    const facade = TestBed.inject(ChatFacade);
    const active = TestBed.inject(ActiveConversationStore);
    const focus = TestBed.inject(WindowFocusStore);
    const unread = TestBed.inject(UnreadStore);
    let release!: (value: ReturnType<typeof ok>) => void;
    historyPort.listPage = () =>
      new Promise((resolve) => {
        release = resolve as (value: ReturnType<typeof ok>) => void;
      });
    active.set({ accountId: 'a@example.invalid', kind: 'direct', jid: 'pending@example.invalid' });
    focus.isFocused.set(false);
    unread.recordIncoming(
      'a@example.invalid',
      'direct',
      'pending@example.invalid',
      'pending-1',
      true,
      false,
    );

    const pending = facade.loadConversation('pending@example.invalid');
    await Promise.resolve();
    release(ok({ items: [], nextCursor: null, hasMore: false }));
    await pending;

    expect(unread.counts().get('a@example.invalid|direct|pending@example.invalid')).toBe(1);
  });

  it('does not acknowledge an old history request after the active conversation changes', async () => {
    const facade = TestBed.inject(ChatFacade);
    const active = TestBed.inject(ActiveConversationStore);
    const focus = TestBed.inject(WindowFocusStore);
    const unread = TestBed.inject(UnreadStore);
    let release!: (value: ReturnType<typeof ok>) => void;
    historyPort.listPage = () =>
      new Promise((resolve) => {
        release = resolve as (value: ReturnType<typeof ok>) => void;
      });
    unread.recordIncoming(
      'a@example.invalid',
      'direct',
      'old@example.invalid',
      'old-1',
      false,
      true,
    );
    active.set({ accountId: 'a@example.invalid', kind: 'direct', jid: 'old@example.invalid' });
    focus.isFocused.set(true);

    const pending = facade.loadConversation('old@example.invalid');
    await Promise.resolve();
    active.set({ accountId: 'a@example.invalid', kind: 'direct', jid: 'new@example.invalid' });
    release(ok({ items: [], nextCursor: null, hasMore: false }));
    await pending;

    expect(unread.counts().get('a@example.invalid|direct|old@example.invalid')).toBe(1);
  });

  it('acknowledges only the active direct conversation after focus recovery', () => {
    const facade = TestBed.inject(ChatFacade);
    const active = TestBed.inject(ActiveConversationStore);
    const focus = TestBed.inject(WindowFocusStore);
    const unread = TestBed.inject(UnreadStore);
    unread.recordIncoming(
      'a@example.invalid',
      'direct',
      'visible@example.invalid',
      'visible-1',
      true,
      false,
    );
    unread.recordIncoming(
      'a@example.invalid',
      'direct',
      'other@example.invalid',
      'other-1',
      false,
      true,
    );
    active.set({ accountId: 'a@example.invalid', kind: 'direct', jid: 'visible@example.invalid' });
    focus.isFocused.set(false);
    facade.markConversationRead('visible@example.invalid');
    expect(unread.counts().get('a@example.invalid|direct|visible@example.invalid')).toBe(1);

    focus.isFocused.set(true);
    facade.markConversationRead('visible@example.invalid');
    expect(unread.counts().get('a@example.invalid|direct|visible@example.invalid')).toBeUndefined();
    expect(unread.counts().get('a@example.invalid|direct|other@example.invalid')).toBe(1);
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
            get: async () =>
              ok({
                theme: 'atomic' as const,
                notifications: true,
                autoAcceptFileTransfers: false,
                autoLogin: true,
                hideClosedConversations: false,
                fileTransferTimeoutSeconds: 300,
                downloadDirectory: '',
              }),
            update: async () => ok({}),
            selectDownloadDirectory: async () => ok(null),
            reset: async () =>
              ok({
                theme: 'atomic' as const,
                notifications: true,
                autoAcceptFileTransfers: false,
                autoLogin: false,
                hideClosedConversations: false,
                fileTransferTimeoutSeconds: 300,
                downloadDirectory: '',
              }),
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
