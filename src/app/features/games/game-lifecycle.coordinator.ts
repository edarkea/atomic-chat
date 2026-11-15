import type { GameSubscriptionRequest, TypedDomainEvent } from '../../core/domain';
import type { GamesPort } from '../../core/ports/games.port';

export class GameLifecycleCoordinator {
  private unsubscribeEvents: (() => void) | undefined;
  private generation = 0;

  start(
    port: GamesPort,
    input: GameSubscriptionRequest,
    listener: (event: TypedDomainEvent) => void,
  ): number {
    this.stop();
    const generation = ++this.generation;
    this.unsubscribeEvents = port.subscribe(input, (event) => {
      if (generation === this.generation) listener(event);
    });
    return generation;
  }

  isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  stop(): void {
    this.generation += 1;
    this.unsubscribeEvents?.();
    this.unsubscribeEvents = undefined;
  }
}
