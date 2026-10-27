import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { ChatFacade } from './chat.facade';
import { InMemoryXmppPort } from './in-memory-xmpp.port';
import { ElectronXmppPort } from './electron-xmpp.port';

const ok = <T>(value: T) => ({ ok: true as const, value, version: 1 as const, requestId: 'test' });
const historyMessage = (accountId: string, conversationId: string, index: number) => ({ id: `message-${index}`, accountId, conversationId, clientMessageId: `client-${index}`, senderJid: conversationId, body: { kind: 'text' as const, text: String(index) }, status: 'sent' as const, createdAt: new Date(1700000000000 + index).toISOString() });

describe('ChatFacade roster reconciliation', () => {
  let port: any; let history: Record<string, any[]>;
  beforeEach(() => {
    history = { 'a@example.invalid': [{ accountId: 'a@example.invalid', jid: 'old@example.invalid', lastActivity: '2026-01-01' }], 'b@example.invalid': [] };
    port = { connect: async (input: any) => ok({ accountId: input.accountId, status: 'connected', retryable: false, since: new Date().toISOString() }), disconnect: async () => ok(undefined), getState: async () => ok({}), setPresence: async (input: any) => ok({ jid: input.accountId, ...input, updatedAt: new Date().toISOString() }), listRoster: async (accountId: string) => ok(accountId === 'a@example.invalid' ? [{ jid: 'keep@example.invalid/desktop', name: 'Keep', groups: ['g'], subscription: 'both', ask: 'subscribe', source: 'roster' }] : []), sendMessage: async () => ok({}), subscribe: () => () => {} };
    window.atomicChat = { config: { accountId: '', endpoint: { host: 'example.invalid', domain: 'example.invalid', port: 5222, tls: true, allowInsecureTls: false } }, account: { setSecret: async () => ok({ stored: true }), connect: port.connect, disconnect: port.disconnect }, session: { getState: port.getState }, presence: { set: port.setPresence }, roster: { list: port.listRoster }, messaging: { send: port.sendMessage }, history: { list: async () => ok([]), conversations: async (input: any) => ok(history[input.accountId]) }, preferences: { get: async () => ok({ theme: 'atomic', notifications: true, autoLogin: false }), update: async () => ok({}), reset: async () => ok({}) }, subscribe: () => () => {} } as any;
    TestBed.configureTestingModule({ providers: [{ provide: InMemoryXmppPort, useValue: port }, { provide: ElectronXmppPort, useValue: port }] });
  });

  it('isolates A, restores A, and preserves local history after roster removal', async () => {
    const facade = TestBed.inject(ChatFacade); await facade.connect('a@example.invalid');
    expect(facade.contacts().map((contact) => contact.jid)).toEqual(['keep@example.invalid', 'old@example.invalid']);
    expect(facade.contacts()[0].subscription).toBe('both');
    await facade.connect('b@example.invalid'); expect(facade.contacts()).toEqual([]);
    await facade.connect('a@example.invalid'); expect(facade.contacts().map((contact) => contact.jid)).toEqual(['keep@example.invalid', 'old@example.invalid']);
    port.listRoster = async () => ok([]); await facade.refreshRoster(); expect(facade.contacts().map((contact) => contact.jid)).toEqual(['old@example.invalid']);
  });

  it('does not apply a stale roster result after the active account changes', async () => {
    let release!: (value: any) => void; port.listRoster = (accountId: string) => accountId === 'a@example.invalid' ? new Promise((resolve) => { release = resolve; }) : Promise.resolve(ok([]));
    const facade = TestBed.inject(ChatFacade); const first = facade.connect('a@example.invalid'); await Promise.resolve(); await facade.connect('b@example.invalid'); release(ok([{ jid: 'late@example.invalid', name: 'late', groups: [] }])); await first; expect(facade.accountId()).toBe('b@example.invalid'); expect(facade.contacts()).toEqual([]);
  });

  it('walks a 1000-message history in both directions with a bounded window', async () => {
    const accountId = 'a@example.invalid'; const conversationId = 'history@example.invalid'; const all = Array.from({ length: 1000 }, (_, index) => historyMessage(accountId, conversationId, index));
    const page = (input: { direction: 'older' | 'newer'; cursor?: string | null; limit: number }) => { const initial = !input.cursor; const cursor = input.cursor ? input.cursor.split(':').map(Number) : [950, 1000]; const start = initial ? 950 : input.direction === 'older' ? Math.max(0, cursor[0] - input.limit) : cursor[1]; const end = initial ? 1000 : input.direction === 'older' ? cursor[0] : Math.min(all.length, cursor[1] + input.limit); const items = all.slice(start, end); return ok({ items, nextCursor: items.length ? `${start}:${end}` : null, hasMore: input.direction === 'older' ? start > 0 : end < all.length }); };
    window.atomicChat!.history.listPage = async (input: any) => page(input);
    const facade = TestBed.inject(ChatFacade); await facade.loadConversation(conversationId); expect(facade.messages().map((message) => message.id)).toEqual(all.slice(950).map((message) => message.id));
    for (let index = 0; index < 19; index += 1) await facade.loadOlderMessages(conversationId);
    expect(facade.messages()).toHaveLength(200); expect(facade.messages()[0].id).toBe('message-0'); expect(facade.hasOlderMessages()).toBe(false); expect(facade.hasNewerMessages()).toBe(true);
    for (let index = 0; index < 19; index += 1) await facade.loadNewerMessages(conversationId);
    expect(facade.messages()).toHaveLength(200); expect(facade.messages().at(-1)?.id).toBe('message-999'); expect(new Set(facade.messages().map((message) => message.id)).size).toBe(200);
  });

  it('invalidates a pending conversation response', async () => {
    let releaseFirst!: (value: any) => void; let releaseSecond!: (value: any) => void; let calls = 0; window.atomicChat!.history.listPage = () => new Promise((resolve) => { calls += 1; if (calls === 1) releaseFirst = resolve; else releaseSecond = resolve; }) as any;
    const facade = TestBed.inject(ChatFacade); const pending = facade.loadConversation('first@example.invalid'); await Promise.resolve(); const second = facade.loadConversation('second@example.invalid'); releaseFirst(ok({ items: [historyMessage('a@example.invalid', 'first@example.invalid', 1)], nextCursor: null, hasMore: false })); await pending; expect(facade.messages()).toEqual([]); expect(facade.historyLoading()).toBe(true); releaseSecond(ok({ items: [], nextCursor: null, hasMore: false })); await second; expect(facade.historyLoading()).toBe(false);
  });
});
