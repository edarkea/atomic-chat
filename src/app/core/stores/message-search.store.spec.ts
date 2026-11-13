import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { MessageSearchHit, MessageSearchInput, MessageSearchPage, Result } from '../domain';
import { MessageSearchStore } from './message-search.store';
import { HISTORY_PORT } from '../ports';

const accountA = 'a@example.invalid';
const allConversations = { kind: 'all' } as const;

function hit(messageId: string): MessageSearchHit {
  return {
    messageId,
    accountId: accountA,
    conversationId: 'friend@example.invalid',
    senderJid: 'friend@example.invalid',
    bodyPreview: 'mensaje de prueba',
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function page(
  items: ReadonlyArray<MessageSearchHit>,
  nextCursor: string | null = null,
  hasMore = false,
): Result<MessageSearchPage> {
  return { ok: true, version: 1, requestId: 'test', value: { items, nextCursor, hasMore } };
}

function deferred<T>() {
  let settle: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve(value: T): void {
      if (!settle) throw new Error('Deferred promise was not initialized');
      settle(value);
    },
  };
}

function setup(search: (input: MessageSearchInput) => Promise<Result<MessageSearchPage>>) {
  const searchSpy = vi.fn(search);
  TestBed.configureTestingModule({
    providers: [{ provide: HISTORY_PORT, useValue: { search: searchSpy } }],
  });
  return { store: TestBed.inject(MessageSearchStore), searchSpy };
}

describe('MessageSearchStore', () => {
  it('uses the existing search contract, trimming queries and paginating without replacing earlier hits', async () => {
    const { store, searchSpy } = setup(async (input) =>
      input.cursor === 'next-page'
        ? page([hit('second')])
        : page([hit('first')], 'next-page', true),
    );

    await store.search('  hola  ', allConversations, () => accountA);
    expect(searchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 1,
        requestId: expect.any(String),
        accountId: accountA,
        query: 'hola',
        scope: allConversations,
        limit: 50,
        cursor: null,
      }),
    );
    expect(store.results().map((result) => result.messageId)).toEqual(['first']);
    expect(store.hasMore()).toBe(true);

    await store.search('hola', allConversations, () => accountA, true);
    expect(searchSpy).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'next-page' }));
    expect(store.results().map((result) => result.messageId)).toEqual(['first', 'second']);
    expect(store.hasMore()).toBe(false);
    expect(store.loading()).toBe(false);
  });

  it('ignores an older response that completes after a newer query', async () => {
    const first = deferred<Result<MessageSearchPage>>();
    const second = deferred<Result<MessageSearchPage>>();
    let calls = 0;
    const { store } = setup(() => {
      calls += 1;
      return calls === 1 ? first.promise : second.promise;
    });

    const pendingFirst = store.search('old', allConversations, () => accountA);
    const pendingSecond = store.search('new', allConversations, () => accountA);
    first.resolve(page([hit('stale')]));
    await pendingFirst;
    expect(store.loading()).toBe(true);

    second.resolve(page([hit('current')]));
    await pendingSecond;
    expect(store.results().map((result) => result.messageId)).toEqual(['current']);
    expect(store.loading()).toBe(false);
  });

  it('invalidates an in-flight response on account reset and clears the pending indicator', async () => {
    const pending = deferred<Result<MessageSearchPage>>();
    const { store } = setup(() => pending.promise);
    let accountId = accountA;
    const oldSearch = store.search('private', allConversations, () => accountId);
    expect(store.loading()).toBe(true);

    accountId = 'b@example.invalid';
    store.reset();
    expect(store.results()).toEqual([]);
    expect(store.loading()).toBe(false);
    expect(store.hasMore()).toBe(false);
    expect(store.error()).toBeNull();

    pending.resolve(page([hit('from-previous-account')]));
    await oldSearch;
    expect(store.results()).toEqual([]);
    expect(store.loading()).toBe(false);
  });

  it('clears a pending search when the query becomes empty', async () => {
    const pending = deferred<Result<MessageSearchPage>>();
    const { store, searchSpy } = setup(() => pending.promise);
    const oldSearch = store.search('pending', allConversations, () => accountA);
    await store.search('   ', allConversations, () => accountA);
    expect(store.loading()).toBe(false);
    expect(store.results()).toEqual([]);
    expect(searchSpy).toHaveBeenCalledTimes(1);
    pending.resolve(page([hit('stale')]));
    await oldSearch;
    expect(store.results()).toEqual([]);
  });

  it('shows an explicit port error and a safe fallback for thrown failures', async () => {
    const failure: Result<MessageSearchPage> = {
      ok: false,
      version: 1,
      error: {
        code: 'STORAGE_FAILED',
        retryable: true,
        requestId: 'test',
        message: 'El historial no está disponible.',
      },
    };
    const { store } = setup(async () => failure);
    await store.search('hola', allConversations, () => accountA);
    expect(store.error()).toBe('El historial no está disponible.');
    expect(store.loading()).toBe(false);
  });

  it('does not reveal an exception message from the history adapter', async () => {
    const { store } = setup(async () => {
      throw new Error('private path/token');
    });
    await store.search('hola', allConversations, () => accountA);
    expect(store.error()).toBe('No fue posible buscar en los mensajes.');
    expect(store.loading()).toBe(false);
  });
});
