import type { GameSubscriptionRequest, TypedDomainEvent } from '../../core/domain';
import type { GamesPort } from '../../core/ports/games.port';
import { GameLifecycleCoordinator } from './game-lifecycle.coordinator';

function fakePort(): {
  port: GamesPort;
  emit: (event: TypedDomainEvent) => void;
  unsubscribed: () => number;
} {
  let listener: ((event: TypedDomainEvent) => void) | undefined;
  let unsubscribeCount = 0;
  const port = {
    subscribe: (_input: GameSubscriptionRequest, next: (event: TypedDomainEvent) => void) => {
      listener = next;
      return () => {
        listener = undefined;
        unsubscribeCount += 1;
      };
    },
  } as unknown as GamesPort;
  return {
    port,
    emit: (event) => listener?.(event),
    unsubscribed: () => unsubscribeCount,
  };
}

const event: TypedDomainEvent = {
  version: 1,
  eventId: 'event-1',
  type: 'game.sessionChanged',
  payload: {
    accountId: 'alice@example.invalid',
    conversationId: 'bob@example.invalid',
    sessionId: 'session-1',
    connectionGeneration: 1,
  },
};

describe('GameLifecycleCoordinator', () => {
  it('drops stale events after a new subscription or stop', () => {
    const fake = fakePort();
    const coordinator = new GameLifecycleCoordinator();
    const received: TypedDomainEvent[] = [];
    const input: GameSubscriptionRequest = {
      version: 1,
      requestId: 'request-1',
      accountId: 'alice@example.invalid',
    };

    coordinator.start(fake.port, input, (next) => received.push(next));
    coordinator.start(fake.port, input, (next) => received.push(next));
    fake.emit(event);
    coordinator.stop();
    fake.emit(event);

    expect(received).toHaveLength(1);
    expect(fake.unsubscribed()).toBe(2);
  });
});
