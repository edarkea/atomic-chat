import { Injectable, computed, signal } from '@angular/core';
import type {
  GameDomainEventPayload,
  GameSessionDto,
  GameSnapshotDto,
  OfficialGameCatalog,
} from '../../core/domain';

interface GameContext {
  readonly accountId: string;
  readonly conversationId: string;
}

function keyFor(accountId: string, conversationId: string, sessionId: string): string {
  return `${accountId.toLowerCase()}|${conversationId.toLowerCase()}|${sessionId}`;
}

const LIVE_SESSION_STATES = new Set(['invited', 'accepted', 'active', 'paused', 'resync-required']);

function preferredSession(sessions: ReadonlyArray<GameSessionDto>): GameSessionDto | undefined {
  return [...sessions].sort((left, right) => {
    const liveDifference =
      Number(LIVE_SESSION_STATES.has(right.state)) - Number(LIVE_SESSION_STATES.has(left.state));
    if (liveDifference !== 0) return liveDifference;
    return right.updatedAt.localeCompare(left.updatedAt);
  })[0];
}

@Injectable({ providedIn: 'root' })
export class GameSessionStore {
  private readonly context = signal<GameContext | null>(null);
  private readonly catalogState = signal<OfficialGameCatalog>([]);
  private readonly sessionsState = signal<ReadonlyArray<GameSessionDto>>([]);
  private readonly snapshotsState = signal<ReadonlyMap<string, GameSnapshotDto>>(new Map());
  private readonly selectedSessionIdState = signal<string | undefined>(undefined);
  private readonly pendingState = signal<ReadonlySet<string>>(new Set());
  private readonly errorState = signal<string | null>(null);

  readonly catalog = this.catalogState.asReadonly();
  readonly sessions = this.sessionsState.asReadonly();
  readonly snapshots = this.snapshotsState.asReadonly();
  readonly selectedSessionId = this.selectedSessionIdState.asReadonly();
  readonly pending = this.pendingState.asReadonly();
  readonly error = this.errorState.asReadonly();
  readonly currentSession = computed(() => {
    const selected = this.selectedSessionIdState();
    return (
      this.sessionsState().find((session) => session.sessionId === selected) ||
      this.sessionsState().find((session) =>
        ['active', 'accepted', 'invited'].includes(session.state),
      ) ||
      this.sessionsState().find((session) =>
        [
          'paused',
          'resync-required',
          'rejected',
          'cancelled',
          'expired',
          'finished',
          'abandoned',
          'closed',
        ].includes(session.state),
      )
    );
  });
  readonly currentSnapshot = computed(() => {
    const session = this.currentSession();
    const context = this.context();
    return session && context
      ? this.snapshotsState().get(
          keyFor(context.accountId, context.conversationId, session.sessionId),
        )
      : undefined;
  });

  setContext(accountId: string, conversationId: string): void {
    const next = {
      accountId: accountId.trim(),
      conversationId: conversationId.trim().toLowerCase(),
    };
    const current = this.context();
    if (current?.accountId === next.accountId && current.conversationId === next.conversationId)
      return;
    this.context.set(next);
    this.sessionsState.set([]);
    this.snapshotsState.set(new Map());
    this.selectedSessionIdState.set(undefined);
    this.pendingState.set(new Set());
    this.errorState.set(null);
  }

  clearContext(): void {
    this.context.set(null);
    this.sessionsState.set([]);
    this.snapshotsState.set(new Map());
    this.selectedSessionIdState.set(undefined);
    this.pendingState.set(new Set());
    this.errorState.set(null);
  }

  setCatalog(catalog: OfficialGameCatalog): void {
    this.catalogState.set(catalog.filter((entry) => entry.distribution === 'official'));
  }

  setSessions(sessions: ReadonlyArray<GameSessionDto>): void {
    const context = this.context();
    if (!context) return;
    const scoped = sessions.filter(
      (session) =>
        session.accountId === context.accountId &&
        session.conversationId.toLowerCase() === context.conversationId,
    );
    this.sessionsState.set(scoped);
    const selected = this.selectedSessionIdState();
    const selectedSession = scoped.find((session) => session.sessionId === selected);
    if (!selectedSession || !LIVE_SESSION_STATES.has(selectedSession.state))
      this.selectedSessionIdState.set(preferredSession(scoped)?.sessionId);
  }

  setSnapshot(snapshot: GameSnapshotDto): void {
    const context = this.context();
    if (
      !context ||
      !this.sessionsState().some((session) => session.sessionId === snapshot.sessionId)
    )
      return;
    const next = new Map(this.snapshotsState());
    next.set(keyFor(context.accountId, context.conversationId, snapshot.sessionId), snapshot);
    this.snapshotsState.set(next);
  }

  selectSession(sessionId: string): void {
    if (this.sessionsState().some((session) => session.sessionId === sessionId))
      this.selectedSessionIdState.set(sessionId);
  }

  begin(sessionId: string, operation: string): void {
    const next = new Set(this.pendingState());
    next.add(`${sessionId}:${operation}`);
    this.pendingState.set(next);
  }

  end(sessionId: string, operation: string): void {
    const next = new Set(this.pendingState());
    next.delete(`${sessionId}:${operation}`);
    this.pendingState.set(next);
  }

  isPending(sessionId: string, operation: string): boolean {
    return this.pendingState().has(`${sessionId}:${operation}`);
  }

  setError(message: string | null): void {
    this.errorState.set(message);
  }

  applyEvent(payload: GameDomainEventPayload): void {
    const context = this.context();
    if (
      !context ||
      payload.accountId !== context.accountId ||
      payload.conversationId.toLowerCase() !== context.conversationId
    )
      return;
    if (payload.session) {
      const sessions = this.sessionsState().filter(
        (session) => session.sessionId !== payload.session?.sessionId,
      );
      this.sessionsState.set([...sessions, payload.session]);
      if (LIVE_SESSION_STATES.has(payload.session.state))
        this.selectedSessionIdState.set(payload.session.sessionId);
    }
    if (payload.snapshot) this.setSnapshot(payload.snapshot);
  }
}
