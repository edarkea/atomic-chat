import { GameSessionStore } from './game-session.store';
import type { GameDomainEventPayload, GameSessionDto } from '../../core/domain';

const session: GameSessionDto = {
  accountId: 'alice@example.invalid',
  conversationId: 'bob@example.invalid',
  peerBareJid: 'bob@example.invalid',
  sessionId: 'session-1',
  gameId: 'tictactoe',
  gameVersion: '1.0.0',
  apiVersion: 1,
  localRole: 'initiator',
  state: 'active',
  revision: 1,
  stateHash: 'hash-1',
  sessionGeneration: 1,
  connectionGeneration: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:01.000Z',
};

describe('GameSessionStore', () => {
  it('keeps sessions and snapshots scoped to the active direct conversation', () => {
    const store = new GameSessionStore();
    store.setContext(session.accountId, session.conversationId);
    store.setSessions([session]);
    store.setSnapshot({
      sessionId: session.sessionId,
      state: { board: ['x'] },
      revision: 1,
      stateHash: 'hash-1',
    });

    expect(store.currentSession()?.sessionId).toBe(session.sessionId);
    expect(store.currentSnapshot()?.state).toEqual({ board: ['x'] });

    store.setContext(session.accountId, 'carol@example.invalid');
    expect(store.sessions()).toEqual([]);
    expect(store.currentSnapshot()).toBeUndefined();
  });

  it('ignores events from another account or conversation', () => {
    const store = new GameSessionStore();
    store.setContext(session.accountId, session.conversationId);
    store.setSessions([session]);
    const foreign: GameDomainEventPayload = {
      accountId: 'mallory@example.invalid',
      conversationId: session.conversationId,
      sessionId: session.sessionId,
      connectionGeneration: 1,
      session: { ...session, accountId: 'mallory@example.invalid' },
    };

    store.applyEvent(foreign);
    expect(store.sessions()).toEqual([session]);
  });

  it('keeps a remote rejection visible when no live session is selected', () => {
    const store = new GameSessionStore();
    store.setContext(session.accountId, session.conversationId);
    const rejected = {
      ...session,
      state: 'rejected' as const,
      updatedAt: '2026-01-01T00:00:02.000Z',
    };

    store.applyEvent({
      accountId: session.accountId,
      conversationId: session.conversationId,
      sessionId: rejected.sessionId,
      connectionGeneration: 1,
      session: rejected,
    });

    expect(store.currentSession()?.state).toBe('rejected');
  });

  it('tracks operation pending state without duplicating entries', () => {
    const store = new GameSessionStore();
    store.begin(session.sessionId, 'move');
    store.begin(session.sessionId, 'move');
    expect(store.isPending(session.sessionId, 'move')).toBe(true);
    store.end(session.sessionId, 'move');
    expect(store.isPending(session.sessionId, 'move')).toBe(false);
  });
});
