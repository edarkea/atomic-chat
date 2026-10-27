import { TestBed } from '@angular/core/testing';
import { describe, expect, it, beforeEach } from 'vitest';
import { ChatFacade } from './chat.facade';
import { InMemoryXmppPort } from './in-memory-xmpp.port';
import { ElectronXmppPort } from './electron-xmpp.port';

const ok = <T>(value: T) => ({ ok: true as const, value, version: 1 as const, requestId: 'test' });

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
});
