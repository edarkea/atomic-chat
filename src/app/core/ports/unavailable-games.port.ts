import { Injectable } from '@angular/core';
import type {
  GameActionReceipt,
  GameCatalogRequest,
  GameConversationRequest,
  GameInviteRequest,
  GameMoveRequest,
  GameSessionRequest,
  GameSessionDto,
  GameSnapshotDto,
  GameSubscriptionRequest,
  OfficialGameCatalog,
  Result,
  TypedDomainEvent,
} from '../domain';
import type { GamesPort } from './games.port';

const unavailable = <T>(requestId: string): Result<T> => ({
  ok: false,
  version: 1,
  error: {
    code: 'UNSUPPORTED',
    retryable: false,
    requestId,
    message: 'La API de juegos no está disponible fuera de Electron.',
  },
});

@Injectable({ providedIn: 'root' })
export class UnavailableGamesPort implements GamesPort {
  catalog(input: GameCatalogRequest): Promise<Result<OfficialGameCatalog>> {
    return Promise.resolve(unavailable(input.requestId));
  }
  sessions(input: GameConversationRequest): Promise<Result<ReadonlyArray<GameSessionDto>>> {
    return Promise.resolve(unavailable(input.requestId));
  }
  snapshot(input: GameSessionRequest): Promise<Result<GameSnapshotDto>> {
    return Promise.resolve(unavailable(input.requestId));
  }
  invite(input: GameInviteRequest): Promise<Result<GameActionReceipt>> {
    return Promise.resolve(unavailable(input.requestId));
  }
  accept(input: GameSessionRequest): Promise<Result<GameActionReceipt>> {
    return Promise.resolve(unavailable(input.requestId));
  }
  reject(input: GameSessionRequest): Promise<Result<GameActionReceipt>> {
    return Promise.resolve(unavailable(input.requestId));
  }
  cancel(input: GameSessionRequest): Promise<Result<GameActionReceipt>> {
    return Promise.resolve(unavailable(input.requestId));
  }
  start(input: GameSessionRequest): Promise<Result<GameActionReceipt>> {
    return Promise.resolve(unavailable(input.requestId));
  }
  move(input: GameMoveRequest): Promise<Result<GameActionReceipt>> {
    return Promise.resolve(unavailable(input.requestId));
  }
  resign(input: GameSessionRequest): Promise<Result<GameActionReceipt>> {
    return Promise.resolve(unavailable(input.requestId));
  }
  resync(input: GameSessionRequest): Promise<Result<GameActionReceipt>> {
    return Promise.resolve(unavailable(input.requestId));
  }
  rematch(input: GameSessionRequest): Promise<Result<GameActionReceipt>> {
    return Promise.resolve(unavailable(input.requestId));
  }
  close(input: GameSessionRequest): Promise<Result<GameActionReceipt>> {
    return Promise.resolve(unavailable(input.requestId));
  }
  subscribe(
    _input: GameSubscriptionRequest,
    _listener: (event: TypedDomainEvent) => void,
  ): () => void {
    return () => undefined;
  }
}
