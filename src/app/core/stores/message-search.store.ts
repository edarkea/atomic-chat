import { Injectable, inject, signal } from '@angular/core';
import { MessageSearchHit, MessageSearchScope } from '../domain';
import { createOpaqueId } from '../ids';
import { HISTORY_PORT, HistoryPort } from '../ports';

/**
 * Owns the result window and request generation for message search.
 * Historical messages and navigation remain the responsibility of ChatFacade.
 */
@Injectable({ providedIn: 'root' })
export class MessageSearchStore {
  private readonly history = inject<HistoryPort>(HISTORY_PORT);
  readonly results = signal<ReadonlyArray<MessageSearchHit>>([]);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly hasMore = signal(false);

  private cursor: string | null = null;
  private generation = 0;

  reset(): void {
    this.generation += 1;
    this.results.set([]);
    this.cursor = null;
    this.hasMore.set(false);
    this.error.set(null);
    this.loading.set(false);
  }

  async search(
    query: string,
    scope: MessageSearchScope,
    currentAccountId: () => string,
    append = false,
  ): Promise<void> {
    const normalized = query.trim();
    if (!normalized) {
      this.reset();
      return;
    }

    const generation = ++this.generation;
    const accountId = currentAccountId();
    const cursor = append ? this.cursor : null;
    if (!append) {
      this.results.set([]);
      this.cursor = null;
      this.hasMore.set(false);
    }
    this.loading.set(true);
    this.error.set(null);

    try {
      const result = await this.history.search({
        version: 1,
        requestId: createOpaqueId('message-search'),
        accountId,
        query: normalized,
        scope,
        limit: 50,
        cursor,
      });
      if (generation !== this.generation || accountId !== currentAccountId()) return;
      if (!result.ok) {
        this.error.set(result.error.message);
        return;
      }
      const previous = append ? this.results() : [];
      this.results.set([...previous, ...result.value.items]);
      this.cursor = result.value.nextCursor;
      this.hasMore.set(result.value.hasMore);
    } catch {
      if (generation === this.generation && accountId === currentAccountId())
        this.error.set('No fue posible buscar en los mensajes.');
    } finally {
      if (generation === this.generation && accountId === currentAccountId())
        this.loading.set(false);
    }
  }
}
