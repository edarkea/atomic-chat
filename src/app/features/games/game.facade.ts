import { Injectable, inject, signal } from '@angular/core';
import type {
  GameActionReceipt,
  GameDomainEventPayload,
  GameInviteRequest,
  GameMoveRequest,
  GameSessionDto,
  GameSessionRequest,
  Result,
  TypedDomainEvent,
} from '../../core/domain';
import { GAMES_PORT } from '../../core/ports/ports';
import type { GamesPort } from '../../core/ports/games.port';
import { GameLifecycleCoordinator } from './game-lifecycle.coordinator';
import { GameSessionStore } from './game-session.store';

let requestSequence = 0;

function nextRequestId(operation: string): string {
  requestSequence += 1;
  return `games-${operation}-${Date.now()}-${requestSequence}`;
}

@Injectable({ providedIn: 'root' })
export class GameFacade {
  private readonly port = inject<GamesPort>(GAMES_PORT);
  private readonly lifecycle = new GameLifecycleCoordinator();
  readonly store = inject(GameSessionStore);
  private readonly accountIdState = signal('');
  private readonly conversationIdState = signal('');

  readonly catalog = this.store.catalog;
  readonly sessions = this.store.sessions;
  readonly snapshots = this.store.snapshots;
  readonly currentSession = this.store.currentSession;
  readonly currentSnapshot = this.store.currentSnapshot;
  readonly selectedSessionId = this.store.selectedSessionId;
  readonly pending = this.store.pending;
  readonly error = this.store.error;

  openConversation(accountId: string, conversationId: string): void {
    const normalizedAccount = accountId.trim();
    const normalizedConversation = conversationId.trim().toLowerCase();
    if (!normalizedAccount || !normalizedConversation) {
      this.closeConversation();
      return;
    }
    this.accountIdState.set(normalizedAccount);
    this.conversationIdState.set(normalizedConversation);
    this.store.setContext(normalizedAccount, normalizedConversation);
    const generation = this.lifecycle.start(
      this.port,
      {
        version: 1,
        requestId: nextRequestId('subscribe'),
        accountId: normalizedAccount,
        conversationId: normalizedConversation,
      },
      (event) => this.acceptEvent(event),
    );
    void this.load(generation, normalizedAccount, normalizedConversation);
  }

  closeConversation(): void {
    this.lifecycle.stop();
    this.accountIdState.set('');
    this.conversationIdState.set('');
    this.store.clearContext();
  }

  selectSession(sessionId: string): void {
    this.store.selectSession(sessionId);
  }

  async invite(gameId: string, gameVersion: string): Promise<void> {
    const accountId = this.accountIdState();
    const conversationId = this.conversationIdState();
    if (!accountId || !conversationId) return Promise.resolve();
    const request: GameInviteRequest = {
      version: 1,
      requestId: nextRequestId('invite'),
      accountId,
      conversationId,
      gameId,
      gameVersion,
    };
    await this.run(
      'invite',
      gameId,
      () => this.port.invite(request),
      request.requestId,
      accountId,
      conversationId,
    );
  }

  async accept(session: GameSessionDto): Promise<void> {
    const accepted = await this.sessionOperation('accept', session, (request) =>
      this.port.accept(request),
    );
    if (accepted && session.localRole === 'responder') await this.start(session);
  }
  async reject(session: GameSessionDto): Promise<void> {
    await this.sessionOperation('reject', session, (request) => this.port.reject(request));
  }
  async cancel(session: GameSessionDto): Promise<void> {
    await this.sessionOperation('cancel', session, (request) => this.port.cancel(request));
  }
  async start(session: GameSessionDto): Promise<void> {
    await this.sessionOperation('start', session, (request) => this.port.start(request));
  }
  async resign(session: GameSessionDto): Promise<void> {
    await this.sessionOperation('resign', session, (request) => this.port.resign(request));
  }
  async resync(session: GameSessionDto): Promise<void> {
    await this.sessionOperation('resync', session, (request) => this.port.resync(request));
  }
  async rematch(session: GameSessionDto): Promise<void> {
    await this.sessionOperation('rematch', session, (request) => this.port.rematch(request));
  }
  async close(session: GameSessionDto): Promise<void> {
    await this.sessionOperation('close', session, (request) => this.port.close(request));
  }

  async move(session: GameSessionDto, move: unknown): Promise<void> {
    const accountId = this.accountIdState();
    const conversationId = this.conversationIdState();
    if (!accountId || !conversationId || session.state !== 'active') return;
    const request: GameMoveRequest = {
      version: 1,
      requestId: nextRequestId('move'),
      accountId,
      conversationId,
      sessionId: session.sessionId,
      sessionGeneration: session.sessionGeneration,
      connectionGeneration: session.connectionGeneration,
      actor: session.localRole,
      move,
    };
    await this.run(
      'move',
      session.sessionId,
      () => this.port.move(request),
      request.requestId,
      accountId,
      conversationId,
    );
  }

  destroy(): void {
    this.closeConversation();
  }

  private async load(generation: number, accountId: string, conversationId: string): Promise<void> {
    const [catalog, sessions] = await Promise.all([
      this.port.catalog({ version: 1, requestId: nextRequestId('catalog'), accountId }),
      this.port.sessions({
        version: 1,
        requestId: nextRequestId('sessions'),
        accountId,
        conversationId,
      }),
    ]);
    if (!this.lifecycle.isCurrent(generation)) return;
    if (catalog.ok) this.store.setCatalog(catalog.value);
    else this.store.setError(catalog.error.message);
    if (!sessions.ok) {
      this.store.setError(sessions.error.message);
      return;
    }
    this.store.setSessions(sessions.value);
    await Promise.all(
      sessions.value.map(async (session) => {
        const snapshot = await this.port.snapshot({
          version: 1,
          requestId: nextRequestId('snapshot'),
          accountId,
          conversationId,
          sessionId: session.sessionId,
          sessionGeneration: session.sessionGeneration,
          connectionGeneration: session.connectionGeneration,
        });
        if (this.lifecycle.isCurrent(generation) && snapshot.ok)
          this.store.setSnapshot(snapshot.value);
      }),
    );
  }

  private acceptEvent(event: TypedDomainEvent): void {
    if (!event.type.startsWith('game.')) return;
    const payload = event.payload as GameDomainEventPayload;
    this.store.applyEvent(payload);
    if (['game.remoteError', 'game.transportError'].includes(event.type))
      this.store.setError(payload.code || 'No fue posible sincronizar la partida.');
  }

  private sessionOperation(
    operation: 'accept' | 'reject' | 'cancel' | 'start' | 'resign' | 'resync' | 'rematch' | 'close',
    session: GameSessionDto,
    action: (request: GameSessionRequest) => Promise<Result<GameActionReceipt>>,
  ): Promise<boolean> {
    const accountId = this.accountIdState();
    const conversationId = this.conversationIdState();
    if (!accountId || !conversationId) return Promise.resolve(false);
    const request: GameSessionRequest = {
      version: 1,
      requestId: nextRequestId(operation),
      accountId,
      conversationId,
      sessionId: session.sessionId,
      sessionGeneration: session.sessionGeneration,
      connectionGeneration: session.connectionGeneration,
    };
    return this.run(
      operation,
      session.sessionId,
      () => action(request),
      request.requestId,
      accountId,
      conversationId,
    );
  }

  private async run<T>(
    operation: string,
    pendingId: string,
    action: () => Promise<Result<T>>,
    requestId: string,
    accountId: string,
    conversationId: string,
  ): Promise<boolean> {
    this.store.begin(pendingId, operation);
    this.store.setError(null);
    try {
      const result = await action();
      if (!result.ok && this.isCurrentContext(accountId, conversationId)) {
        this.store.setError(result.error.message);
        return false;
      }
      return result.ok;
    } catch {
      if (this.isCurrentContext(accountId, conversationId))
        this.store.setError(`No fue posible completar ${operation} (${requestId}).`);
      return false;
    } finally {
      if (this.isCurrentContext(accountId, conversationId)) this.store.end(pendingId, operation);
    }
  }

  private isCurrentContext(accountId: string, conversationId: string): boolean {
    return this.accountIdState() === accountId && this.conversationIdState() === conversationId;
  }
}
